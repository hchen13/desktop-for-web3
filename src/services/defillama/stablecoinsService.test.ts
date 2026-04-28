/**
 * StablecoinsService 单元测试
 *
 * 覆盖：
 *  - normalize / 排序 / 过滤
 *  - peg delta 计算 + 颜色阈值分级
 *  - fetch 成功 → state 更新 + subscriber 通知
 *  - fetch 失败 → 保留 stale + 状态切换为 error
 *  - 多订阅者通知 + unsubscribe 后不再被通知
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  normalizeStablecoins,
  computePegDelta,
  classifyPegDelta,
  PEG_DELTA_THRESHOLDS,
} from './stablecoinsService';

// Helper: 构造 raw response
function rawAsset(overrides: Record<string, unknown>) {
  return {
    id: 'a',
    name: 'Asset',
    symbol: 'A',
    pegType: 'peggedUSD',
    pegMechanism: 'fiat-backed',
    circulating: { peggedUSD: 1_000_000 },
    circulatingPrevDay: { peggedUSD: 990_000 },
    price: 1.0,
    chains: ['Ethereum'],
    ...overrides,
  };
}

describe('normalizeStablecoins', () => {
  it('过滤 mcap = 0 / 缺 symbol 的条目', () => {
    const raw = {
      peggedAssets: [
        rawAsset({ symbol: 'USDT', circulating: { peggedUSD: 100 } }),
        rawAsset({ symbol: '', circulating: { peggedUSD: 50 } }),
        rawAsset({ symbol: 'ZERO', circulating: { peggedUSD: 0 } }),
      ],
    };
    const out = normalizeStablecoins(raw);
    expect(out).toHaveLength(1);
    expect(out[0].symbol).toBe('USDT');
  });

  it('按 mcap 倒序排序', () => {
    const raw = {
      peggedAssets: [
        rawAsset({ symbol: 'A', circulating: { peggedUSD: 10 } }),
        rawAsset({ symbol: 'B', circulating: { peggedUSD: 1000 } }),
        rawAsset({ symbol: 'C', circulating: { peggedUSD: 100 } }),
      ],
    };
    const out = normalizeStablecoins(raw);
    expect(out.map((a) => a.symbol)).toEqual(['B', 'C', 'A']);
  });

  it('计算 24h delta 百分比', () => {
    const raw = {
      peggedAssets: [
        rawAsset({
          symbol: 'X',
          circulating: { peggedUSD: 1100 },
          circulatingPrevDay: { peggedUSD: 1000 },
        }),
      ],
    };
    const out = normalizeStablecoins(raw);
    expect(out[0].change24h).toBeCloseTo(10, 5);
  });

  it('当 prev=0 时 change24h 为 null', () => {
    const raw = {
      peggedAssets: [
        rawAsset({
          symbol: 'X',
          circulating: { peggedUSD: 100 },
          circulatingPrevDay: 0,
        }),
      ],
    };
    const out = normalizeStablecoins(raw);
    expect(out[0].change24h).toBeNull();
  });

  it('容忍 circulating 为 number 形式', () => {
    const raw = {
      peggedAssets: [rawAsset({ symbol: 'NUM', circulating: 5000 })],
    };
    const out = normalizeStablecoins(raw);
    expect(out[0].mcap).toBe(5000);
  });

  it('容忍空 / 异常 input', () => {
    expect(normalizeStablecoins({} as never)).toEqual([]);
    expect(normalizeStablecoins({ peggedAssets: null } as never)).toEqual([]);
  });
});

describe('peg delta 阈值分级', () => {
  it('1.000 => level 0 (neutral)', () => {
    expect(classifyPegDelta(0)).toBe(0);
  });

  it('0.999 (delta 0.1%) => level 0 (neutral)', () => {
    const delta = computePegDelta({
      id: 'x',
      symbol: 'X',
      name: 'X',
      pegType: 'peggedUSD',
      mcap: 1,
      mcapPrev: null,
      change24h: null,
      price: 0.999,
      chains: [],
    });
    expect(delta).toBeCloseTo(0.1, 5);
    expect(classifyPegDelta(delta)).toBe(0);
  });

  it('1.003 (delta 0.3%) => level 1 (warn)', () => {
    const delta = computePegDelta({
      id: 'x',
      symbol: 'X',
      name: 'X',
      pegType: 'peggedUSD',
      mcap: 1,
      mcapPrev: null,
      change24h: null,
      price: 1.003,
      chains: [],
    });
    expect(classifyPegDelta(delta)).toBe(1);
  });

  it('0.992 (delta 0.8%) => level 2 (alert)', () => {
    const delta = computePegDelta({
      id: 'x',
      symbol: 'X',
      name: 'X',
      pegType: 'peggedUSD',
      mcap: 1,
      mcapPrev: null,
      change24h: null,
      price: 0.992,
      chains: [],
    });
    // delta = 0.8 → > ALERT(0.5), ≤ DANGER(1.0) ⇒ 2
    expect(delta).toBeCloseTo(0.8, 5);
    expect(classifyPegDelta(delta)).toBe(2);
  });

  it('0.95 (delta 5%) => level 3 (danger)', () => {
    const delta = computePegDelta({
      id: 'x',
      symbol: 'X',
      name: 'X',
      pegType: 'peggedUSD',
      mcap: 1,
      mcapPrev: null,
      change24h: null,
      price: 0.95,
      chains: [],
    });
    expect(delta).toBeCloseTo(5, 5);
    expect(classifyPegDelta(delta)).toBe(3);
  });

  it('null price → delta=null → level 0', () => {
    const delta = computePegDelta({
      id: 'x',
      symbol: 'X',
      name: 'X',
      pegType: 'peggedUSD',
      mcap: 1,
      mcapPrev: null,
      change24h: null,
      price: null,
      chains: [],
    });
    expect(delta).toBeNull();
    expect(classifyPegDelta(delta)).toBe(0);
  });

  it('阈值常量已导出，UI 可引用', () => {
    expect(PEG_DELTA_THRESHOLDS.WARN).toBe(0.2);
    expect(PEG_DELTA_THRESHOLDS.ALERT).toBe(0.5);
    expect(PEG_DELTA_THRESHOLDS.DANGER).toBe(1.0);
  });
});

describe('StablecoinsService — fetch + subscribe', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetch 成功后 state 转 success，subscriber 收到数据', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          peggedAssets: [
            {
              id: 1,
              symbol: 'USDT',
              name: 'Tether',
              pegType: 'peggedUSD',
              circulating: { peggedUSD: 100 },
              circulatingPrevDay: { peggedUSD: 90 },
              price: 1.0,
              chains: ['Ethereum'],
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const { stablecoinsService } = await import('./stablecoinsService');
    stablecoinsService.__resetForTest();

    const cb = vi.fn();
    stablecoinsService.subscribe(cb);
    // 第一次为初始 state（idle / 空）
    await stablecoinsService.refresh(true);

    expect(cb).toHaveBeenCalled();
    const final = stablecoinsService.getData();
    expect(final.status).toBe('success');
    expect(final.assets).toHaveLength(1);
    expect(final.assets[0].symbol).toBe('USDT');
  });

  it('fetch 失败时保留 stale 数据，状态切换为 error', async () => {
    // 第一次成功
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            peggedAssets: [{ id: 1, symbol: 'USDC', circulating: { peggedUSD: 1 }, price: 1 }],
          }),
          { status: 200 },
        ),
      )
      .mockRejectedValueOnce(new Error('network down'));

    const { stablecoinsService } = await import('./stablecoinsService');
    stablecoinsService.__resetForTest();

    await stablecoinsService.refresh(true);
    expect(stablecoinsService.getData().assets).toHaveLength(1);

    // 第二次 fetch 失败
    await stablecoinsService.refresh(true);
    const after = stablecoinsService.getData();
    expect(after.status).toBe('error');
    expect(after.assets).toHaveLength(1); // stale 保留
    expect(after.error).toMatch(/network/i);

    fetchSpy.mockRestore();
  });

  it('多订阅者均被通知；unsubscribe 后不再被通知', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          peggedAssets: [{ id: 'a', symbol: 'A', circulating: { peggedUSD: 1 }, price: 1 }],
        }),
        { status: 200 },
      ),
    );

    const { stablecoinsService } = await import('./stablecoinsService');
    stablecoinsService.__resetForTest();

    const a = vi.fn();
    const b = vi.fn();
    const unsubA = stablecoinsService.subscribe(a);
    stablecoinsService.subscribe(b);
    a.mockClear();
    b.mockClear();

    await stablecoinsService.refresh(true);
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();

    unsubA();
    a.mockClear();
    b.mockClear();

    await stablecoinsService.refresh(true);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });

  it('HTTP 非 2xx 响应视为失败', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    const { stablecoinsService } = await import('./stablecoinsService');
    stablecoinsService.__resetForTest();
    await stablecoinsService.refresh(true);
    expect(stablecoinsService.getData().status).toBe('error');
  });
});
