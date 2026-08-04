/**
 * 冷启动 / 恢复 的请求次数预算，以及 refresh 所有权（generation）与 OFF 契约。
 *
 * 这些都是「多打几轮也还是能出价，所以肉眼看不出来」的问题，只能靠确定性计数覆盖。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PriceService, TIER_RECOVERY_PROBE_MS } from './PriceService';
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

  it('旧 run 的 finally 不会删掉新 run 的在飞记录', async () => {
    await seedCatalog([spotInstrument('okx', 'BTC-USDT', 'BTC')]);
    gateOpen = false;
    mockAllVenues({ gate: true });

    const sub = service.subscribe(new Set<AssetKey>(['crypto:BTC']), () => {});
    await waitUntil(() => requests.some((r) => r.url.includes('BTC-USDT')), 'BTC 请求发出');

    // A 移除后立刻重新加入，旧 run 仍在飞
    sub.updateAssets(new Set<AssetKey>([]));
    await Promise.resolve();
    sub.updateAssets(new Set<AssetKey>(['crypto:BTC']));

    gateOpen = true;
    for (const release of deferred) release();
    await service.__settleForTest();

    // 不应出现第三轮并发刷新
    const btcRequests = tickerRequests().filter((r) => r.url.includes('BTC-USDT'));
    expect(btcRequests.length).toBeLessThanOrEqual(2);
    expect(service.getSnapshot('crypto:BTC')).not.toBeNull();
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
