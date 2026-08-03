/**
 * PriceService 单元测试
 *
 * 覆盖：
 *  - probe 选最快源
 *  - 多 subscriber union 合并
 *  - unsubscribe 后停止通知
 *  - source 失败 fallback 到下一个
 *  - chrome.storage 持久化往返
 *  - Pyth 覆盖 REST price 字段（保留 24h%）
 *  - getSnapshot / refresh API
 *  - subscriber 抛错被 catch 不影响其他
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PriceService } from './PriceService';
import type { AssetMeta } from './types';
import type { LegacyPriceSnapshot as PriceSnapshot, SourceAdapter } from './legacyTypes';

function makeAdapter(
  name: string,
  opts: {
    latency?: number;
    failProbe?: boolean;
    failFetch?: boolean;
    fetchResult?: Map<string, PriceSnapshot>;
  } = {},
): SourceAdapter {
  return {
    name,
    probe: vi.fn(async () => {
      if (opts.failProbe) throw new Error('probe failed');
      return opts.latency ?? 50;
    }),
    fetchPrices: vi.fn(async () => {
      if (opts.failFetch) throw new Error('fetch failed');
      return opts.fetchResult ?? new Map();
    }),
  };
}

function snap(symbol: string, price: number, source = 'okx'): PriceSnapshot {
  return {
    symbol,
    price,
    change24h: 1.23,
    volume24h: 1000,
    lastUpdate: 1700000000000,
    source,
  };
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/v2/price_feeds')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    return new Response(JSON.stringify({ parsed: [] }), { status: 200 });
  });
});

describe('PriceService — probe & ranked adapters', () => {
  let svc: PriceService;
  beforeEach(() => {
    svc = new PriceService();
  });
  afterEach(() => {
    svc.__resetForTest();
    vi.restoreAllMocks();
  });

  it('选取最快 adapter 排在最前', async () => {
    const a = makeAdapter('a', { latency: 200 });
    const b = makeAdapter('b', { latency: 50 });
    const c = makeAdapter('c', { latency: 100 });
    svc.__setAdaptersForTest([a, b, c]);

    svc.subscribe(new Set(['BTC']), () => {});
    await svc.__waitForStartupForTest();

    const ranked = svc.__getRankedAdapters();
    expect(ranked.slice(0, 3)).toEqual(['b', 'c', 'a']);
  });

  it('probe 失败的 adapter 被排到末尾，仍参与 fetch fallback', async () => {
    const a = makeAdapter('a', { latency: 100 });
    const b = makeAdapter('b', { failProbe: true });
    svc.__setAdaptersForTest([a, b]);

    svc.subscribe(new Set(['BTC']), () => {});
    await svc.__waitForStartupForTest();
    await svc.refresh(new Set(['BTC']));
    const ranked = svc.__getRankedAdapters();
    expect(ranked[0]).toBe('a');
    expect(ranked).toContain('b');
  });
});

describe('PriceService — subscribe pool & union', () => {
  let svc: PriceService;
  beforeEach(() => {
    svc = new PriceService();
  });
  afterEach(() => {
    svc.__resetForTest();
    vi.restoreAllMocks();
  });

  it('多 subscriber 的 symbols 取并集，仅 fetch 一次', async () => {
    const result = new Map<string, PriceSnapshot>([
      ['BTC', snap('BTC', 70000)],
      ['ETH', snap('ETH', 3500)],
      ['SOL', snap('SOL', 200)],
    ]);
    const okx = makeAdapter('okx', { fetchResult: result });
    svc.__setAdaptersForTest([okx]);

    const cbA = vi.fn();
    const cbB = vi.fn();
    svc.subscribe(new Set(['BTC', 'ETH']), cbA);
    svc.subscribe(new Set(['ETH', 'SOL']), cbB);

    await svc.refresh();

    // OKX fetchPrices 应只被叫过一次
    expect(okx.fetchPrices).toHaveBeenCalledTimes(1);
    // 第一次实参中的 assets 应包含 BTC/ETH/SOL
    const passed = (okx.fetchPrices as any).mock.calls[0][0] as AssetMeta[];
    const symbols = passed.map((a) => a.symbol).sort();
    expect(symbols).toEqual(['BTC', 'ETH', 'SOL']);
  });

  it('并发刷新不同 symbols 时，后发请求会进入下一批刷新', async () => {
    let releaseFirstFetch!: () => void;
    const firstFetchGate = new Promise<void>((resolve) => {
      releaseFirstFetch = resolve;
    });
    let fetchCount = 0;
    const okx: SourceAdapter = {
      name: 'okx',
      probe: vi.fn(async () => 1),
      fetchPrices: vi.fn(async (assets: AssetMeta[]) => {
        fetchCount += 1;
        if (fetchCount === 1) {
          await firstFetchGate;
        }
        return new Map(assets.map((asset) => [asset.symbol, snap(asset.symbol, 100)]));
      }),
    };
    svc.__setAdaptersForTest([okx]);

    const first = svc.refresh(new Set(['BTC']));
    await Promise.resolve();
    const second = svc.refresh(new Set(['ETH']));

    releaseFirstFetch();
    await Promise.all([first, second]);

    expect(okx.fetchPrices).toHaveBeenCalledTimes(2);
    expect(svc.getSnapshot('BTC')).not.toBeNull();
    expect(svc.getSnapshot('ETH')).not.toBeNull();
  });

  it('subscriber 收到的 snapshot 仅含自己 watch 的 symbol', async () => {
    const result = new Map<string, PriceSnapshot>([
      ['BTC', snap('BTC', 70000)],
      ['ETH', snap('ETH', 3500)],
      ['SOL', snap('SOL', 200)],
    ]);
    svc.__setAdaptersForTest([makeAdapter('okx', { fetchResult: result })]);

    const cbA = vi.fn();
    svc.subscribe(new Set(['BTC']), cbA);
    await svc.refresh();
    const lastCall = cbA.mock.calls[cbA.mock.calls.length - 1][0] as Map<string, PriceSnapshot>;
    expect(Array.from(lastCall.keys())).toEqual(['BTC']);
  });

  it('unsubscribe 后该 callback 不再被通知', async () => {
    const result = new Map<string, PriceSnapshot>([['BTC', snap('BTC', 70000)]]);
    svc.__setAdaptersForTest([makeAdapter('okx', { fetchResult: result })]);

    const cbA = vi.fn();
    const cbB = vi.fn();
    const unsubA = svc.subscribe(new Set(['BTC']), cbA);
    svc.subscribe(new Set(['BTC']), cbB);
    await svc.refresh();
    expect(cbA).toHaveBeenCalled();
    expect(cbB).toHaveBeenCalled();

    cbA.mockClear();
    cbB.mockClear();
    unsubA();
    await svc.refresh();
    expect(cbA).not.toHaveBeenCalled();
    expect(cbB).toHaveBeenCalled();
  });

  it('subscriber callback 抛错被 catch，不影响其它', async () => {
    const result = new Map<string, PriceSnapshot>([['BTC', snap('BTC', 70000)]]);
    svc.__setAdaptersForTest([makeAdapter('okx', { fetchResult: result })]);

    const cbA = vi.fn(() => {
      throw new Error('oops');
    });
    const cbB = vi.fn();
    svc.subscribe(new Set(['BTC']), cbA);
    svc.subscribe(new Set(['BTC']), cbB);
    await svc.refresh();
    expect(cbB).toHaveBeenCalled();
  });
});

describe('PriceService — fallback & error handling', () => {
  let svc: PriceService;
  beforeEach(() => {
    svc = new PriceService();
  });
  afterEach(() => {
    svc.__resetForTest();
    vi.restoreAllMocks();
  });

  it('primary adapter 失败时 fallback 到下一个', async () => {
    const ok = makeAdapter('ok', {
      fetchResult: new Map([['BTC', snap('BTC', 70000, 'ok')]]),
    });
    const bad = makeAdapter('bad', { failFetch: true, latency: 10 }); // 最快但失败
    svc.__setAdaptersForTest([bad, ok]);

    svc.subscribe(new Set(['BTC']), () => {});
    await svc.refresh();

    const got = svc.getSnapshot('BTC');
    expect(got).not.toBeNull();
    expect(got!.price).toBe(70000);
    expect(bad.fetchPrices).toHaveBeenCalled();
    expect(ok.fetchPrices).toHaveBeenCalled();
  });

  it('primary adapter 只返回部分 symbols 时，用后续 adapter 补齐缺失项', async () => {
    const partial = makeAdapter('partial', {
      fetchResult: new Map([['BTC', snap('BTC', 70000, 'partial')]]),
    });
    const fallback = makeAdapter('fallback', {
      fetchResult: new Map([['ETH', snap('ETH', 3500, 'fallback')]]),
    });
    svc.__setAdaptersForTest([partial, fallback]);

    await svc.refresh(new Set(['BTC', 'ETH']));

    expect(svc.getSnapshot('BTC')!.source).toBe('partial');
    expect(svc.getSnapshot('ETH')!.source).toBe('fallback');
    const fallbackAssets = (fallback.fetchPrices as any).mock.calls[0][0] as AssetMeta[];
    expect(fallbackAssets.map((asset) => asset.symbol)).toEqual(['ETH']);
  });

  it('全部 adapter 失败时不写 snapshot 但不抛错', async () => {
    const a = makeAdapter('a', { failFetch: true });
    const b = makeAdapter('b', { failFetch: true });
    svc.__setAdaptersForTest([a, b]);

    svc.subscribe(new Set(['BTC']), () => {});
    await expect(svc.refresh()).resolves.not.toThrow();
    expect(svc.getSnapshot('BTC')).toBeNull();
  });
});

describe('PriceService — Pyth integration', () => {
  let svc: PriceService;
  beforeEach(() => {
    svc = new PriceService();
  });
  afterEach(() => {
    svc.__resetForTest();
    vi.restoreAllMocks();
  });

  it('Pyth latest 覆盖 REST price 字段，保留 24h%', async () => {
    const cexResult = new Map<string, PriceSnapshot>([
      [
        'BTC',
        {
          symbol: 'BTC',
          price: 70000,
          change24h: 2.5,
          volume24h: 999,
          lastUpdate: 1700000000000,
          source: 'okx',
        },
      ],
    ]);
    svc.__setAdaptersForTest([makeAdapter('okx', { fetchResult: cexResult })]);

    // mock fetch 用于 Pyth latest（globalThis.fetch）
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/v2/price_feeds')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          parsed: [
            {
              id: 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
              price: { price: '7050000000000', expo: -8, publish_time: 1700000010 },
            },
          ],
        }),
        { status: 200 },
      );
    });

    svc.subscribe(new Set(['BTC']), () => {});
    await svc.refresh();

    const final = svc.getSnapshot('BTC');
    expect(final).not.toBeNull();
    expect(final!.price).toBeCloseTo(70500, 0); // 来自 Pyth
    expect(final!.change24h).toBeCloseTo(2.5, 5); // 来自 OKX
    expect(final!.source).toBe('pyth');
  });
});

describe('PriceService — chrome.storage 持久化', () => {
  let svc: PriceService;
  beforeEach(() => {
    svc = new PriceService();
    (globalThis as any).__memoryStorage?.__reset?.();
  });
  afterEach(() => {
    svc.__resetForTest();
    vi.restoreAllMocks();
  });

  it('fetch 后写入 storage，新实例可恢复', async () => {
    const result = new Map<string, PriceSnapshot>([['BTC', snap('BTC', 70000)]]);
    svc.__setAdaptersForTest([makeAdapter('okx', { fetchResult: result })]);

    svc.subscribe(new Set(['BTC']), () => {});
    await svc.refresh();
    // 让 persist promise 完成
    await new Promise((r) => setTimeout(r, 0));

    // 用一个新实例验证恢复
    const svc2 = new PriceService();
    const cb = vi.fn();
    // 不发起任何 adapter 请求；恢复后第一次 callback 应已带数据
    svc2.__setAdaptersForTest([makeAdapter('okx', { failFetch: true })]);
    svc2.subscribe(new Set(['BTC']), cb);
    // 等异步 restore 完成
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // restore 后 snapshots 应包含 BTC（由 storage 注入）
    const found = svc2.getSnapshot('BTC');
    expect(found).not.toBeNull();
    expect(found!.price).toBe(70000);
    svc2.__resetForTest();
  });
});

describe('PriceService — getSnapshot & refresh', () => {
  let svc: PriceService;
  beforeEach(() => {
    svc = new PriceService();
  });
  afterEach(() => {
    svc.__resetForTest();
    vi.restoreAllMocks();
  });

  it('未订阅前 getSnapshot 返回 null', () => {
    expect(svc.getSnapshot('BTC')).toBeNull();
  });

  it('refresh 不带 symbol 时刷新当前 union', async () => {
    const result = new Map<string, PriceSnapshot>([['BTC', snap('BTC', 70000)]]);
    const okx = makeAdapter('okx', { fetchResult: result });
    svc.__setAdaptersForTest([okx]);

    svc.subscribe(new Set(['BTC']), () => {});
    await svc.refresh();
    expect(okx.fetchPrices).toHaveBeenCalled();
  });

  it('refresh 空 union 时直接返回', async () => {
    const okx = makeAdapter('okx');
    svc.__setAdaptersForTest([okx]);
    await svc.refresh(new Set());
    expect(okx.fetchPrices).not.toHaveBeenCalled();
  });

  it('subscribe 时立即推一次（即使 snapshots 为空）', () => {
    svc.__setAdaptersForTest([makeAdapter('okx', { failFetch: true })]);
    const cb = vi.fn();
    svc.subscribe(new Set(['BTC']), cb);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].size).toBe(0);
  });
});
