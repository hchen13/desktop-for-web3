/**
 * 生命周期与异步操作的所有权（L1–L7）
 *
 * 这些场景的共同点：请求已经发出去了，中途 transport regime 变了或资产没人要了。
 * 请求本身可以自然结束，但它的结果一律不许再落地——既不能继续降层，也不能写
 * QuoteStore / snapshot / resolved / effectiveTier / unavailable / handoff /
 * candidate 节流 / catalog 缓存 / desired set / persist / 订阅回调 / WS / timer。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PriceService } from './PriceService';
import { exchangeCatalog, EXCHANGE_CATALOG_STORAGE_KEY } from './exchangeCatalog';
import { BLUR_GRACE_MS, HIDDEN_GRACE_MS, PASSIVE_VISIBLE_INTERVAL_MS } from './lifecycle';
import { __setReconnectJitterForTest, __setWebSocketFactoryForTest } from './socket';
import type { AssetKey, VenueInstrument } from './types';
import { makeInstrument } from './venues/shared';

const memoryStorage = () => (globalThis as any).__memoryStorage;

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 1;
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(): void {}
  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }
  static openCount(): number {
    return FakeSocket.instances.filter((s) => !s.closed).length;
  }
}

interface Recorded {
  at: number;
  method: string;
  url: string;
  body: string;
  assetKey: string;
  venue: string;
  tier: number;
}

let service: PriceService;
let records: Recorded[];
let gates: Array<() => void>;
let gateOn: boolean;
let visibility: DocumentVisibilityState;
let focused: boolean;

/** 从 URL/body 反推 venue / tier / assetKey，供请求明细断言使用 */
function classify(url: string, body: string): Omit<Recorded, 'at' | 'method' | 'url' | 'body'> {
  const symbolOf = (raw: string) => raw.replace(/^[XR]/, '').replace(/B?USDT.*$/, '');
  if (url.includes('okx.com')) {
    const instId = new URL(url).searchParams.get('instId') ?? '';
    const tier = url.includes('index-tickers') ? 2 : 1;
    return { assetKey: `stock:${symbolOf(instId.split('-')[0])}`, venue: 'okx', tier };
  }
  if (url.includes('bitget.com')) {
    const params = new URL(url).searchParams;
    const symbol = params.get('symbol') ?? '';
    const tier = params.get('category') === 'SPOT' ? 1 : 2;
    return { assetKey: `stock:${symbolOf(symbol)}`, venue: 'bitget', tier };
  }
  if (url.includes('binance')) {
    const params = new URL(url).searchParams;
    const single = params.get('symbol');
    const batch = params.get('symbols');
    const raw = single ?? (batch ? (JSON.parse(batch) as string[])[0] : '');
    return { assetKey: `stock:${symbolOf(raw)}`, venue: 'binance', tier: single ? 2 : 1 };
  }
  return { assetKey: '', venue: 'hyperliquid', tier: 3, ...(body ? {} : {}) };
}

interface MockOptions {
  /** 这一刻的请求是否要卡在 gate 上 */
  gated?: () => boolean;
  /** 返回可用报价的 instrument 片段；其余一律 503 */
  live?: () => string[];
  /** 本次响应使用的价格 */
  price?: () => string;
}

function mockVenues(options: MockOptions = {}): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const body = String((init as RequestInit)?.body ?? '');
    records.push({
      at: Date.now(),
      method: (init as RequestInit)?.method ?? 'GET',
      url,
      body,
      ...classify(url, body),
    });
    if (options.gated?.()) await new Promise<void>((resolve) => gates.push(resolve));

    const live = options.live?.() ?? [];
    const hit = live.find((id) => url.includes(id));
    if (!hit) return new Response('down', { status: 503 });
    const price = options.price?.() ?? '300';
    if (url.includes('okx.com')) {
      const instId = new URL(url).searchParams.get('instId')!;
      return new Response(
        JSON.stringify({
          code: '0',
          data: [
            {
              instId,
              last: price,
              idxPx: price,
              open24h: price,
              ts: String(Date.now()),
              bidPx: price,
              askPx: price,
            },
          ],
        }),
      );
    }
    if (url.includes('bitget.com')) {
      const symbol = new URL(url).searchParams.get('symbol')!;
      return new Response(
        JSON.stringify({
          code: '00000',
          data: [
            {
              symbol,
              lastPrice: price,
              indexPrice: price,
              price24hPcnt: '0',
              ts: String(Date.now()),
              bid1Price: price,
              ask1Price: price,
            },
          ],
        }),
      );
    }
    const batch = new URL(url).searchParams.get('symbols');
    const symbols = batch
      ? (JSON.parse(batch) as string[])
      : [new URL(url).searchParams.get('symbol')!];
    return new Response(
      JSON.stringify(
        symbols.map((symbol) => ({
          symbol,
          lastPrice: price,
          priceChangePercent: '0',
          quoteVolume: '1000',
          closeTime: Date.now(),
          bidPrice: price,
          askPrice: price,
        })),
      ),
    );
  });
}

async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i += 1) await vi.advanceTimersByTimeAsync(0);
}

function releaseAll(): void {
  const pending = gates.splice(0, gates.length);
  for (const release of pending) release();
}

function tokenizedSpot(venue: VenueInstrument['venue'], id: string): VenueInstrument {
  return makeInstrument({
    venue,
    instrumentId: id,
    symbol: 'AAPL',
    base: 'AAPL',
    quote: 'USDT',
    category: 'stock',
    productKind: 'tokenized_stock_spot',
    preferredPriceKind: 'last',
  });
}

async function seedCatalog(instruments: VenueInstrument[]): Promise<void> {
  const now = Date.now();
  await chrome.storage.local.set({
    [EXCHANGE_CATALOG_STORAGE_KEY]: {
      version: 'v2',
      venueTimestamps: { okx: now, bitget: now, binance: now, hyperliquid: now },
      instruments,
    },
  });
}

/** 冻结前的完整可观测状态，用于逐项断言「什么都没写」 */
function stateFingerprint() {
  return JSON.stringify({
    snapshot: service.getSnapshot('stock:AAPL'),
    desired: service.__desiredInstrumentsForTest().map((i) => i.instrumentId),
    catalog: exchangeCatalog.instrumentsFor('stock:AAPL').map((i) => i.instrumentId),
    mode: service.__transportModeForTest(),
    connections: service.__connectionCountForTest(),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  focused = true;
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  memoryStorage()?.__reset?.();
  exchangeCatalog.__resetForTest();
  FakeSocket.instances = [];
  __setWebSocketFactoryForTest((url) => new FakeSocket(url) as unknown as WebSocket);
  __setReconnectJitterForTest(0);
  records = [];
  gates = [];
  gateOn = false;
  service = new PriceService();
});

afterEach(() => {
  service.__resetForTest();
  exchangeCatalog.__resetForTest();
  __setWebSocketFactoryForTest(null);
  __setReconnectJitterForTest(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('L1 冷启动 resolver 在飞时 pagehide/freeze', () => {
  it('lifecycle 在事件之前就已经装好监听并读过 visibility/focus', async () => {
    gateOn = true;
    mockVenues({ gated: () => gateOn });
    service.subscribe(new Set<AssetKey>(['stock:AAPL']), () => {});
    await flush();

    // 第一个 candidate 请求已经发出，此时 lifecycle 必须已经就位
    expect(records.length).toBeGreaterThan(0);
    expect(service.__transportModeForTest()).toBe('realtime');
  });

  it('失败结果放行后不得继续请求 Tier 2', async () => {
    gateOn = true;
    mockVenues({ gated: () => gateOn });
    service.subscribe(new Set<AssetKey>(['stock:AAPL']), () => {});
    await flush();
    const tier1 = records.length;
    expect(records.every((r) => r.tier === 1)).toBe(true);

    window.dispatchEvent(new Event('pagehide'));
    document.dispatchEvent(new Event('freeze'));
    expect(service.__transportModeForTest()).toBe('off');
    expect(service.__connectionCountForTest()).toBe(0);
    expect(service.__recoveryTimerActiveForTest()).toBe(false);

    gateOn = false;
    releaseAll();
    await flush();

    expect(records.slice(tier1).filter((r) => r.tier === 2)).toEqual([]);
    expect(records).toHaveLength(tier1);
    // 在飞请求自带 abort timer，只有等它们真的结束之后 timer 才该归零
    expect(vi.getTimerCount()).toBe(0);
  });

  it('成功结果放行后也不得写任何状态或复活 REALTIME', async () => {
    gateOn = true;
    mockVenues({ gated: () => gateOn, live: () => ['XAAPL-USDT', 'RAAPLUSDT', 'AAPLBUSDT'] });
    service.subscribe(new Set<AssetKey>(['stock:AAPL']), () => {});
    await flush();
    const before = records.length;

    window.dispatchEvent(new Event('pagehide'));
    document.dispatchEvent(new Event('freeze'));
    const frozen = stateFingerprint();

    gateOn = false;
    releaseAll();
    await flush();

    expect(records).toHaveLength(before);
    expect(stateFingerprint()).toBe(frozen);
    expect(service.__transportModeForTest()).toBe('off');
    expect(exchangeCatalog.instrumentsFor('stock:AAPL')).toEqual([]);
    expect(FakeSocket.openCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('L2 普通 refresh 在飞时 freeze', () => {
  it('放行失败结果后不降层，状态保持冻结前的样子', async () => {
    await seedCatalog([tokenizedSpot('okx', 'XAAPL-USDT')]);
    let up = true;
    mockVenues({ gated: () => gateOn, live: () => (up ? ['XAAPL-USDT'] : []) });

    service.subscribe(new Set<AssetKey>(['stock:AAPL']), () => {});
    await service.__settleForTest();
    expect(service.getSnapshot('stock:AAPL')!.price).toBe(300);
    const healthy = stateFingerprint();

    // 手动发起一次 refresh，让 Tier 1 请求卡住
    up = false;
    gateOn = true;
    const refresh = service.refreshAssets(new Set<AssetKey>(['stock:AAPL']));
    await flush();
    const before = records.length;
    expect(before).toBeGreaterThan(0);

    window.dispatchEvent(new Event('pagehide'));
    document.dispatchEvent(new Event('freeze'));

    gateOn = false;
    releaseAll();
    await refresh.catch(() => {});
    await flush();

    expect(records.slice(before)).toEqual([]);
    expect(service.getSnapshot('stock:AAPL')!.price).toBe(300);
    expect(JSON.parse(stateFingerprint()).desired).toEqual(JSON.parse(healthy).desired);
    expect(service.__transportModeForTest()).toBe('off');
    expect(FakeSocket.openCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('L3 普通 refresh 在飞时转 passive', () => {
  /** 转换之后放行的那次请求会返回一个**新的、可用的**报价，用来证明它确实没被采纳 */
  async function refreshPendingThen(transition: () => void, expectedMode: string): Promise<void> {
    await seedCatalog([tokenizedSpot('okx', 'XAAPL-USDT')]);
    let price = '300';
    mockVenues({ gated: () => gateOn, live: () => ['XAAPL-USDT'], price: () => price });
    service.subscribe(new Set<AssetKey>(['stock:AAPL']), () => {});
    await service.__settleForTest();
    expect(service.getSnapshot('stock:AAPL')!.price).toBe(300);

    gateOn = true;
    price = '301';
    const refresh = service.refreshAssets(new Set<AssetKey>(['stock:AAPL']));
    await flush();
    const before = records.length;
    expect(before).toBeGreaterThan(0);

    transition();
    expect(service.__transportModeForTest()).toBe(expectedMode);

    gateOn = false;
    releaseAll();
    await refresh.catch(() => {});
    await flush();

    // 已发请求可以结束，但旧 REALTIME operation 既不降层也不写状态
    expect(records.slice(before).filter((r) => r.tier === 2)).toEqual([]);
    expect(service.getSnapshot('stock:AAPL')!.price).toBe(300);
    expect(FakeSocket.openCount()).toBe(0);
    expect(service.__recoveryTimerActiveForTest()).toBe(false);
  }

  it('blur 满 5 分钟进入 PASSIVE_VISIBLE：首轮 tick 在完整 interval 之后', async () => {
    await refreshPendingThen(() => {
      focused = false;
      window.dispatchEvent(new Event('blur'));
      vi.advanceTimersByTime(BLUR_GRACE_MS);
    }, 'passive-visible');

    const atTransition = records.length;
    await vi.advanceTimersByTimeAsync(PASSIVE_VISIBLE_INTERVAL_MS - 1);
    expect(records).toHaveLength(atTransition);
    await vi.advanceTimersByTimeAsync(1);
    await service.__settleForTest();
    expect(records.length).toBeGreaterThan(atTransition);
  });

  it('hidden 满 30 秒进入 PASSIVE_HIDDEN：转换瞬间不补发 tick', async () => {
    await refreshPendingThen(() => {
      visibility = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(HIDDEN_GRACE_MS);
    }, 'passive-hidden');

    const atTransition = records.length;
    await flush();
    expect(records).toHaveLength(atTransition);
  });
});

describe('L1b 旧 resolver 仍 pending 时的 suspend → resume', () => {
  it('resume 只创建一个新 owner，3 → 6 次请求，最终只认新 owner 的报价', async () => {
    gateOn = true;
    // 旧 owner 的三条请求报 100，新 owner 报 200；先放行新的，再放行旧的
    let price = '100';
    mockVenues({ gated: () => gateOn, live: () => ['XAAPL-USDT'], price: () => price });

    service.subscribe(new Set<AssetKey>(['stock:AAPL']), () => {});
    await flush();

    // 旧 owner：OKX / Bitget / Binance 各一条 Tier 1 请求，全部 pending
    expect(records).toHaveLength(3);
    expect(records.every((r) => r.tier === 1)).toBe(true);
    expect(records.map((r) => r.venue).sort()).toEqual(['binance', 'bitget', 'okx']);
    expect(service.__resolveRunCountForTest()).toBe(1);

    price = '200';
    window.dispatchEvent(new Event('pagehide'));
    document.dispatchEvent(new Event('freeze'));
    document.dispatchEvent(new Event('resume'));
    window.dispatchEvent(new Event('pageshow'));
    await flush();

    // 旧请求还挂着，但它属于已失效的 lifecycle，不算作 resume 这一轮
    expect(service.__resolveRunCountForTest()).toBe(2);
    expect(records).toHaveLength(6);
    expect(
      records
        .slice(3)
        .map((r) => r.venue)
        .sort(),
    ).toEqual(['binance', 'bitget', 'okx']);
    expect(records.filter((r) => r.tier === 2)).toEqual([]);

    // 重复恢复事件 + 连续两次 refresh 都不得再开一轮
    document.dispatchEvent(new Event('resume'));
    window.dispatchEvent(new Event('pageshow'));
    void service.refreshAssets(new Set<AssetKey>(['stock:AAPL']));
    await flush(2);
    void service.refreshAssets(new Set<AssetKey>(['stock:AAPL']));
    await flush(2);
    expect(records).toHaveLength(6);
    expect(service.__resolveRunCountForTest()).toBe(2);

    // 最苛刻的顺序：先放行新 owner，再放行旧 owner（且旧报价时间戳更新）
    gateOn = false;
    const fresh = gates.splice(3, 3);
    for (const release of fresh) release();
    await flush();
    expect(service.getSnapshot('stock:AAPL')!.price).toBe(200);

    price = '100';
    await vi.advanceTimersByTimeAsync(1000);
    const stale = gates.splice(0, gates.length);
    for (const release of stale) release();
    await service.__settleForTest();

    expect(service.getSnapshot('stock:AAPL')!.price).toBe(200);
    expect(service.__desiredInstrumentsForTest().map((i) => i.instrumentId)).toEqual([
      'XAAPL-USDT',
    ]);
    expect(records).toHaveLength(6);
    expect(records.filter((r) => r.tier === 2)).toEqual([]);
    expect(service.__resolveRunCountForTest()).toBe(2);
    expect(FakeSocket.openCount()).toBe(1);
    expect(new Set(FakeSocket.instances.map((s) => s.url)).size).toBe(FakeSocket.instances.length);
  });
});

describe('L1d 作废的 reconcile 必须有人接管', () => {
  it('冷启动 reconcile 跨过 REALTIME → PASSIVE_VISIBLE 后，资产不能被搁在半路', async () => {
    gateOn = true;
    mockVenues({ gated: () => gateOn, live: () => ['XAAPL-USDT'] });

    service.subscribe(new Set<AssetKey>(['stock:AAPL']), () => {});
    await flush();
    expect(records).toHaveLength(3);

    // 解析还没落地就掉进 PASSIVE_VISIBLE：这一轮 reconcile 跨过了 regime 变化
    focused = false;
    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(BLUR_GRACE_MS);
    expect(service.__transportModeForTest()).toBe('passive-visible');

    gateOn = false;
    releaseAll();
    await service.__settleForTest();
    await vi.advanceTimersByTimeAsync(PASSIVE_VISIBLE_INTERVAL_MS);
    await service.__settleForTest();

    // 作废的那一轮不能把资产留在「已解析但没有 desired」的半成品状态
    expect(service.getSnapshot('stock:AAPL')!.price).toBe(300);
    expect(service.__desiredInstrumentsForTest().map((i) => i.instrumentId)).toEqual([
      'XAAPL-USDT',
    ]);

    focused = true;
    window.dispatchEvent(new Event('focus'));
    await service.__settleForTest();
    expect(service.__transportModeForTest()).toBe('realtime');
    expect(FakeSocket.openCount()).toBe(1);
  });
});

describe('L1c resolution handoff 必须绑定完整 owner', () => {
  it('跨 regime 的旧 handoff 不得让 resume 的 targeted refresh 被跳过', async () => {
    mockVenues({ gated: () => gateOn, live: () => ['XAAPL-USDT'] });

    service.subscribe(new Set<AssetKey>(['stock:AAPL']), () => {});
    // 停在「handoff 已生成、自动首刷还没消费」这一刻
    for (let i = 0; i < 50 && !service.__hasResolutionHandoffForTest('stock:AAPL'); i += 1) {
      await Promise.resolve();
    }
    expect(service.__hasResolutionHandoffForTest('stock:AAPL')).toBe(true);
    const resolved = records.length;
    expect(resolved).toBe(3);

    // 自动首刷还没跑就 suspend：mode 变 off，首刷被拦下，handoff 留在原地
    window.dispatchEvent(new Event('pagehide'));
    document.dispatchEvent(new Event('freeze'));
    await flush();
    expect(records).toHaveLength(resolved);
    expect(service.__hasResolutionHandoffForTest('stock:AAPL')).toBe(true);

    document.dispatchEvent(new Event('resume'));
    window.dispatchEvent(new Event('pageshow'));
    await service.__settleForTest();

    // 旧 regime 的 handoff 不能被新 regime 消费，也不能让这一轮被跳过
    const afterResume = records.slice(resolved);
    expect(afterResume, afterResume.map((r) => r.url).join('\n')).toHaveLength(1);
    expect(afterResume[0].url).toContain('XAAPL-USDT');
    expect(service.getSnapshot('stock:AAPL')!.price).toBe(300);
    expect(service.__desiredInstrumentsForTest().map((i) => i.instrumentId)).toEqual([
      'XAAPL-USDT',
    ]);
    expect(service.__transportModeForTest()).toBe('realtime');
  });
});

describe('L5 真实无 catalog 的 A → OFF → A', () => {
  it('旧 owner 不覆盖新 owner，全程恰好两个 refresh run', async () => {
    gateOn = true;
    mockVenues({ gated: () => gateOn, live: () => ['XAAPL-USDT'] });

    const sub = service.subscribe(new Set<AssetKey>(['stock:AAPL']), () => {});
    await flush();
    const firstRequests = records.length;
    expect(firstRequests).toBeGreaterThan(0);
    expect(service.__resolveRunCountForTest()).toBe(1);

    sub.updateAssets(new Set<AssetKey>([]));
    await flush();
    expect(service.__transportModeForTest()).toBe('off');

    sub.updateAssets(new Set<AssetKey>(['stock:AAPL']));
    await flush();
    expect(service.__resolveRunCountForTest()).toBe(2);
    expect(records.length).toBeGreaterThan(firstRequests);
    const secondRequests = records.length;

    // 只放行旧 resolver：它已经失去所有权，不得写快照，也不得删掉新 owner 的记录
    const stale = gates.splice(0, firstRequests);
    for (const release of stale) release();
    await flush();
    expect(service.getSnapshot('stock:AAPL')).toBeNull();

    // 新 owner 仍被追踪：连着刷两次也只合并成一个 run，且解析没落地前不发新请求
    expect(service.__refreshRunCountForTest()).toBe(0);
    void service.refreshAssets(new Set<AssetKey>(['stock:AAPL']));
    await flush(2);
    void service.refreshAssets(new Set<AssetKey>(['stock:AAPL']));
    await flush(2);
    expect(service.__refreshRunCountForTest()).toBe(1);
    expect(records).toHaveLength(secondRequests);

    gateOn = false;
    releaseAll();
    await service.__settleForTest();

    // 全程只有两个 resolver（旧 owner 一个、新 owner 一个）和一个 refresh run
    expect(service.getSnapshot('stock:AAPL')!.price).toBe(300);
    expect(service.__resolveRunCountForTest()).toBe(2);
    expect(service.__refreshRunCountForTest()).toBe(1);
    expect(service.__desiredInstrumentsForTest().map((i) => i.instrumentId)).toEqual([
      'XAAPL-USDT',
    ]);
  });
});

describe('L6 多 subscriber', () => {
  it('两个 subscriber 都要 A 时，移除其中一个不得使 resolver 失效', async () => {
    gateOn = true;
    mockVenues({ gated: () => gateOn, live: () => ['XAAPL-USDT'] });

    const first = service.subscribe(new Set<AssetKey>(['stock:AAPL']), () => {});
    service.subscribe(new Set<AssetKey>(['stock:AAPL']), () => {});
    await flush();
    const pending = records.length;
    expect(pending).toBeGreaterThan(0);

    first.unsubscribe();
    await flush();
    expect(service.__transportModeForTest()).toBe('realtime');

    gateOn = false;
    releaseAll();
    await service.__settleForTest();

    expect(service.getSnapshot('stock:AAPL')!.price).toBe(300);
    expect(service.__desiredInstrumentsForTest().map((i) => i.instrumentId)).toEqual([
      'XAAPL-USDT',
    ]);
    expect(FakeSocket.openCount()).toBe(1);
    expect(service.__resolveRunCountForTest()).toBe(1);
  });
});

describe('L7 真实恢复事件顺序', () => {
  async function subscribeHealthy(): Promise<void> {
    await seedCatalog([tokenizedSpot('okx', 'XAAPL-USDT')]);
    mockVenues({ live: () => ['XAAPL-USDT'] });
    service.subscribe(new Set<AssetKey>(['stock:AAPL']), () => {});
    await service.__settleForTest();
  }

  it('初始 pageshow 没有先 suspend，必须是 no-op', async () => {
    await subscribeHealthy();
    const before = records.length;

    window.dispatchEvent(new Event('pageshow'));
    await service.__settleForTest();

    expect(records).toHaveLength(before);
  });

  it('pagehide → freeze → resume → pageshow 只恢复一次', async () => {
    await subscribeHealthy();
    const before = records.length;
    const socketsBefore = FakeSocket.instances.length;

    window.dispatchEvent(new Event('pagehide'));
    document.dispatchEvent(new Event('freeze'));
    document.dispatchEvent(new Event('resume'));
    window.dispatchEvent(new Event('pageshow'));
    await service.__settleForTest();

    expect(records.length - before).toBe(1);
    expect(service.__transportModeForTest()).toBe('realtime');
    expect(FakeSocket.openCount()).toBe(1);
    expect(FakeSocket.instances.length - socketsBefore).toBe(1);
  });

  it('freeze → pagehide → pageshow → resume 也只恢复一次', async () => {
    await subscribeHealthy();
    const before = records.length;
    const socketsBefore = FakeSocket.instances.length;

    document.dispatchEvent(new Event('freeze'));
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pageshow'));
    document.dispatchEvent(new Event('resume'));
    await service.__settleForTest();

    expect(records.length - before).toBe(1);
    expect(service.__transportModeForTest()).toBe('realtime');
    expect(FakeSocket.openCount()).toBe(1);
    expect(FakeSocket.instances.length - socketsBefore).toBe(1);
  });
});
