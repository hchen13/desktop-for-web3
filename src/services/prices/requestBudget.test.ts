/**
 * 冷启动 / 恢复 的请求次数预算，以及 refresh 所有权（generation）与 OFF 契约。
 *
 * 这些都是「多打几轮也还是能出价，所以肉眼看不出来」的问题，只能靠确定性计数覆盖。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CANDIDATE_RETRY_MS, PriceService, TIER_RECOVERY_PROBE_MS } from './PriceService';
import { exchangeCatalog, EXCHANGE_CATALOG_STORAGE_KEY } from './exchangeCatalog';
import { __setWebSocketFactoryForTest } from './socket';
import type { AssetKey, VenueInstrument } from './types';
import { makeInstrument } from './venues/shared';

const memoryStorage = () => (globalThis as any).__memoryStorage;

class SilentSocket {
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {}
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
}

interface Recorded {
  url: string;
  method: string;
  body: string;
}

let service: PriceService;
let requests: Recorded[];
let deferred: Array<() => void>;
let gateOpen: boolean;
let okxPrice: number;

function spotInstrument(
  venue: VenueInstrument['venue'],
  instrumentId: string,
  symbol: string,
  category: VenueInstrument['category'] = 'crypto',
): VenueInstrument {
  return makeInstrument({
    venue,
    instrumentId,
    symbol,
    base: symbol,
    quote: 'USDT',
    category,
    productKind: category === 'crypto' ? 'crypto_spot' : 'tokenized_stock_spot',
    preferredPriceKind: 'last',
  });
}

function perpInstrument(
  venue: VenueInstrument['venue'],
  instrumentId: string,
  symbol: string,
): VenueInstrument {
  return makeInstrument({
    venue,
    instrumentId,
    symbol,
    base: symbol,
    quote: 'USDT',
    category: 'stock',
    productKind: 'equity_perp',
    preferredPriceKind: 'index',
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

/** 对任何 instrument 都返回可用报价；同时记录 method / URL / body */
function mockAllVenues(options: { okxOk?: boolean; gate?: boolean } = {}) {
  const okxOk = options.okxOk !== false;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    requests.push({
      url,
      method: (init as RequestInit)?.method ?? 'GET',
      body: String((init as RequestInit)?.body ?? ''),
    });

    if (options.gate && !gateOpen) {
      await new Promise<void>((resolve) => deferred.push(resolve));
    }

    const ts = String(Date.now());
    if (url.includes('okx.com/api/v5/market/ticker')) {
      if (!okxOk) return new Response('down', { status: 503 });
      const instId = new URL(url).searchParams.get('instId')!;
      return new Response(
        JSON.stringify({
          code: '0',
          data: [{ instId, last: '100', open24h: '99', ts, bidPx: '99.9', askPx: '100.1' }],
        }),
      );
    }
    if (url.includes('bitget.com/api/v3/market/tickers')) {
      const symbol = new URL(url).searchParams.get('symbol')!;
      return new Response(
        JSON.stringify({
          code: '00000',
          data: [
            {
              symbol,
              lastPrice: '101',
              indexPrice: '101',
              price24hPcnt: '0.01',
              ts,
              bid1Price: '100.9',
              ask1Price: '101.1',
            },
          ],
        }),
      );
    }
    if (url.includes('binance.vision/api/v3/ticker/24hr')) {
      const symbols = JSON.parse(new URL(url).searchParams.get('symbols')!) as string[];
      return new Response(
        JSON.stringify(
          symbols.map((symbol) => ({
            symbol,
            lastPrice: '102',
            priceChangePercent: '1',
            quoteVolume: '1000',
            closeTime: Date.now(),
            bidPrice: '101.9',
            askPrice: '102.1',
          })),
        ),
      );
    }
    return new Response('not found', { status: 404 });
  });
}

/**
 * 只服务 OKX ticker，每个请求都卡在自己的 gate 上，逐个放行。
 * 用来区分「旧 owner 的响应」和「新 owner 的响应」。
 */
function mockGatedOkxPrice(price: () => number): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    requests.push({
      url,
      method: (init as RequestInit)?.method ?? 'GET',
      body: String((init as RequestInit)?.body ?? ''),
    });
    const last = String(price());
    await new Promise<void>((resolve) => deferred.push(resolve));
    if (!url.includes('okx.com/api/v5/market/ticker')) {
      return new Response('not found', { status: 404 });
    }
    const instId = new URL(url).searchParams.get('instId')!;
    return new Response(
      JSON.stringify({
        code: '0',
        data: [
          {
            instId,
            last,
            open24h: last,
            ts: String(Date.now()),
            bidPx: last,
            askPx: last,
          },
        ],
      }),
    );
  });
}

function okxRequests(): Recorded[] {
  return requests.filter((r) => r.url.includes('okx.com/api/v5/market/ticker'));
}

/** 按发出顺序放行下一个还卡着的请求 */
function releaseNext(): void {
  const release = deferred.shift();
  if (!release) throw new Error('没有待放行的请求');
  release();
}

/** 轮询等待某个条件成立；用于「请求已发出但还卡在 gate 上」这类中间状态 */
async function waitUntil(predicate: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`waitUntil 超时: ${label}`);
}

function tickerRequests(): Recorded[] {
  return requests.filter(
    (r) =>
      r.url.includes('/market/ticker') ||
      r.url.includes('/market/tickers') ||
      r.url.includes('/ticker/24hr'),
  );
}

beforeEach(() => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  memoryStorage()?.__reset?.();
  exchangeCatalog.__resetForTest();
  __setWebSocketFactoryForTest((url) => new SilentSocket(url) as unknown as WebSocket);
  requests = [];
  deferred = [];
  gateOpen = true;
  okxPrice = 111;
  service = new PriceService();
});

afterEach(() => {
  service.__resetForTest();
  exchangeCatalog.__resetForTest();
  __setWebSocketFactoryForTest(null);
  vi.restoreAllMocks();
});

describe('冷启动请求预算', () => {
  it('无 catalog 首次订阅：每个候选 instrument 最多请求一次', async () => {
    mockAllVenues();

    service.subscribe(new Set<AssetKey>(['crypto:BTC']), () => {});
    await service.__settleForTest();

    const counts = new Map<string, number>();
    for (const r of tickerRequests()) counts.set(r.url, (counts.get(r.url) ?? 0) + 1);
    for (const [url, n] of counts) {
      expect(n, `${url} 被请求了 ${n} 次`).toBe(1);
    }
    // BTC 的 Tier 1 候选就是 okx / bitget / binance 三家
    expect(tickerRequests()).toHaveLength(3);
    expect(service.getSnapshot('crypto:BTC')!.price).toBeGreaterThan(0);
  });

  it('有 catalog 但没有报价：只跑一轮 targeted refresh', async () => {
    await seedCatalog([
      spotInstrument('okx', 'BTC-USDT', 'BTC'),
      spotInstrument('bitget', 'BTCUSDT', 'BTC'),
      spotInstrument('binance', 'BTCUSDT', 'BTC'),
    ]);
    mockAllVenues();

    service.subscribe(new Set<AssetKey>(['crypto:BTC']), () => {});
    await service.__settleForTest();

    expect(tickerRequests()).toHaveLength(3);
  });

  it('默认 6 个标的的冷启动不超过 Tier 1 所需的一轮', async () => {
    mockAllVenues();

    service.subscribe(
      new Set<AssetKey>([
        'crypto:BTC',
        'crypto:ETH',
        'crypto:SOL',
        'stock:NVDA',
        'stock:TSLA',
        'etf:SPY',
      ]),
      () => {},
    );
    await service.__settleForTest();

    // 6 个标的 × 3 家 venue = 18；Binance 是 selected-symbol batch，实际更少
    expect(tickerRequests().length).toBeLessThanOrEqual(18);
    expect(tickerRequests().length).toBeGreaterThan(0);
    const counts = new Map<string, number>();
    for (const r of tickerRequests()) counts.set(r.url, (counts.get(r.url) ?? 0) + 1);
    for (const [url, n] of counts) {
      expect(n, `${url} 被请求了 ${n} 次`).toBe(1);
    }
  });

  it('Tier 1 全失败、Tier 2 成功：首轮只请求必要的 7 次，不重复 Tier 1', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      requests.push({ url, method: 'GET', body: '' });
      // Tier 2 只有 Bitget 的股票永续能出价，其余一律不可用
      if (url.includes('symbol=AAPLUSDT') && url.includes('USDT-FUTURES')) {
        const price = '305';
        return new Response(
          JSON.stringify({
            code: '00000',
            data: [
              {
                symbol: 'AAPLUSDT',
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
      return new Response('down', { status: 503 });
    });

    service.subscribe(new Set<AssetKey>(['stock:AAPL']), () => {});
    await service.__settleForTest();

    // Tier 1 三个候选各一次 + Tier 2（OKX 指数 1、Bitget 1、Binance premiumIndex + ticker 2）
    const detail = requests.map((r) => r.url);
    expect(detail, detail.join('\n')).toHaveLength(7);
    expect(detail.filter((u) => u.includes('XAAPL-USDT'))).toHaveLength(1);
    expect(detail.filter((u) => u.includes('RAAPLUSDT'))).toHaveLength(1);
    expect(detail.filter((u) => u.includes('AAPLBUSDT'))).toHaveLength(1);
    expect(service.getSnapshot('stock:AAPL')!.price).toBe(305);
  });

  it('resolution 期间跨过节流窗口，紧随其后的首刷仍不得重打已尝试过的 Tier', async () => {
    // 只靠 5 分钟节流是不够的：venue 响应慢的时候节流窗口会在解析途中就过期，
    // 必须由 owner scoped 的「本轮已尝试」记录兜住
    vi.useFakeTimers();
    let releaseTier2: () => void = () => {};
    const tier2Gate = new Promise<void>((resolve) => {
      releaseTier2 = resolve;
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      requests.push({ url, method: 'GET', body: '' });
      const isTier2 =
        url.includes('index-tickers') ||
        url.includes('USDT-FUTURES') ||
        url.includes('premiumIndex') ||
        url.includes('fapi');
      if (!isTier2) return new Response('down', { status: 503 });
      await tier2Gate;
      if (!url.includes('USDT-FUTURES')) return new Response('down', { status: 503 });
      const price = '305';
      return new Response(
        JSON.stringify({
          code: '00000',
          data: [
            {
              symbol: 'AAPLUSDT',
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
    });

    service.subscribe(new Set<AssetKey>(['stock:AAPL']), () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(requests.some((r) => r.url.includes('USDT-FUTURES'))).toBe(true);

    // Tier 2 还卡着的时候，Tier 1 的节流窗口已经过期
    await vi.advanceTimersByTimeAsync(CANDIDATE_RETRY_MS + 1000);
    releaseTier2();
    await service.__settleForTest();

    const detail = requests.map((r) => r.url);
    expect(
      detail.filter((u) => u.includes('XAAPL-USDT')),
      detail.join('\n'),
    ).toHaveLength(1);
    expect(detail.filter((u) => u.includes('RAAPLUSDT'))).toHaveLength(1);
    expect(detail.filter((u) => u.includes('AAPLBUSDT'))).toHaveLength(1);
    expect(service.getSnapshot('stock:AAPL')!.price).toBe(305);
    vi.useRealTimers();
  });

  it('初次加载的 pageshow 不增加请求', async () => {
    mockAllVenues();
    service.subscribe(new Set<AssetKey>(['crypto:BTC']), () => {});
    await service.__settleForTest();
    const before = tickerRequests().length;

    window.dispatchEvent(new Event('pageshow'));
    await service.__settleForTest();

    expect(tickerRequests()).toHaveLength(before);
  });

  it('真正的恢复序列只增加一轮', async () => {
    mockAllVenues();
    service.subscribe(new Set<AssetKey>(['crypto:BTC']), () => {});
    await service.__settleForTest();
    const before = tickerRequests().length;

    window.dispatchEvent(new Event('pagehide'));
    document.dispatchEvent(new Event('freeze'));
    document.dispatchEvent(new Event('resume'));
    window.dispatchEvent(new Event('pageshow'));
    await service.__settleForTest();

    expect(tickerRequests().length - before).toBe(3);
  });
});

describe('refresh 所有权与 OFF 契约', () => {
  it('Tier 1 在飞时资产被移除：Tier 1 失败后不得再请求 Tier 2', async () => {
    await seedCatalog([
      spotInstrument('okx', 'XAAPL-USDT', 'AAPL', 'stock'),
      perpInstrument('bitget', 'AAPLUSDT', 'AAPL'),
    ]);
    gateOpen = false;
    mockAllVenues({ okxOk: false, gate: true });

    const sub = service.subscribe(new Set<AssetKey>(['stock:AAPL']), () => {});
    // 等 Tier 1 请求发出去并卡在 gate 上
    await waitUntil(() => requests.some((r) => r.url.includes('XAAPL-USDT')), 'Tier 1 请求发出');

    // 请求还在飞的时候把资产移除
    sub.updateAssets(new Set<AssetKey>([]));
    await service.__settleForTest();

    gateOpen = true;
    for (const release of deferred) release();
    await service.__settleForTest();

    expect(requests.some((r) => r.url.includes('symbol=AAPLUSDT'))).toBe(false);
    expect(service.__transportModeForTest()).toBe('off');
    expect(service.__connectionCountForTest()).toBe(0);
  });

  it('冷启动 resolver 在飞时进入 OFF：Tier 1 失败后不得继续请求 Tier 2 或写状态', async () => {
    // 没有 catalog，冷启动会走 candidate 验证——这条路径以前完全没有 owner 检查
    gateOpen = false;
    mockAllVenues({ okxOk: false, gate: true });

    const sub = service.subscribe(new Set<AssetKey>(['stock:AAPL']), () => {});
    await waitUntil(
      () => requests.some((r) => r.url.includes('XAAPL-USDT')),
      'Tier 1 candidate 请求发出',
    );
    const tier1Count = requests.length;

    // 解析还没落地，资产就被清空：此时它根本没进过 currentUnion
    sub.updateAssets(new Set<AssetKey>([]));
    await waitUntil(() => service.__transportModeForTest() === 'off', '进入 OFF');

    gateOpen = true;
    for (const release of deferred) release();
    await service.__settleForTest();

    // 失效的 resolver 不得再往下探 Tier 2
    const after = requests.slice(tier1Count).map((r) => r.url);
    const detail = after.join('\n');
    expect(
      after.filter((u) => u.includes('index-tickers')),
      detail,
    ).toHaveLength(0);
    expect(
      after.filter((u) => u.includes('USDT-FUTURES')),
      detail,
    ).toHaveLength(0);
    expect(
      after.filter((u) => u.includes('premiumIndex')),
      detail,
    ).toHaveLength(0);
    expect(
      after.filter((u) => u.includes('fapi')),
      detail,
    ).toHaveLength(0);

    // 也不得写任何状态
    expect(service.getSnapshot('stock:AAPL')).toBeNull();
    expect(service.__desiredInstrumentsForTest()).toEqual([]);
    expect(exchangeCatalog.instrumentsFor('stock:AAPL')).toEqual([]);
    expect(service.__transportModeForTest()).toBe('off');
    expect(service.__connectionCountForTest()).toBe(0);
  });

  it('A → OFF → A：旧 owner 不覆盖新 owner，也不产生第三个并发 run', async () => {
    await seedCatalog([spotInstrument('okx', 'BTC-USDT', 'BTC')]);
    gateOpen = false;
    // 旧 owner 的请求返回 111，新 owner 返回 222，最终快照必须来自新 owner
    mockGatedOkxPrice(() => okxPrice);

    const sub = service.subscribe(new Set<AssetKey>(['crypto:BTC']), () => {});
    await waitUntil(() => okxRequests().length === 1, '第一个 owner 的请求已发出');

    // 移除资产并等到服务真的进入 OFF——不能只等一个 microtask
    sub.updateAssets(new Set<AssetKey>([]));
    await waitUntil(() => service.__transportModeForTest() === 'off', '进入 OFF');
    expect(service.__connectionCountForTest()).toBe(0);
    expect(okxRequests()).toHaveLength(1);

    // 重新加入，等第二个 owner 的请求确实发出并卡住
    okxPrice = 222;
    sub.updateAssets(new Set<AssetKey>(['crypto:BTC']));
    await waitUntil(() => okxRequests().length === 2, '第二个 owner 的请求已发出');

    // 先只放行旧请求：它已经失去所有权，不得写快照、不得删掉新 owner 的在飞记录
    releaseNext();
    await Promise.resolve();
    await Promise.resolve();
    expect(service.getSnapshot('crypto:BTC')).toBeNull();

    // 新 owner 仍在被追踪，这时再刷一次只能合并进去，不能开第三个 run
    void service.refreshAssets(new Set<AssetKey>(['crypto:BTC']));
    await Promise.resolve();
    expect(okxRequests()).toHaveLength(2);

    releaseNext();
    await service.__settleForTest();

    expect(okxRequests()).toHaveLength(2);
    expect(service.getSnapshot('crypto:BTC')!.price).toBe(222);
  });

  it('进入 OFF 后 timer / WS / 新请求全部归零', async () => {
    vi.useFakeTimers();
    await seedCatalog([spotInstrument('okx', 'BTC-USDT', 'BTC')]);
    mockAllVenues();

    const sub = service.subscribe(new Set<AssetKey>(['crypto:BTC']), () => {});
    await service.__settleForTest();
    expect(service.__connectionCountForTest()).toBe(1);

    sub.setActive(false);
    await service.__settleForTest();
    const before = requests.length;

    vi.advanceTimersByTime(TIER_RECOVERY_PROBE_MS * 3);
    await service.__settleForTest();

    expect(service.__transportModeForTest()).toBe('off');
    expect(service.__connectionCountForTest()).toBe(0);
    expect(requests).toHaveLength(before);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
