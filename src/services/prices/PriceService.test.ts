import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PriceService, PRICES_STORAGE_KEY } from './PriceService';
import { exchangeCatalog, EXCHANGE_CATALOG_STORAGE_KEY } from './exchangeCatalog';
import { __setWebSocketFactoryForTest } from './socket';
import type { AssetKey, PriceSnapshot, VenueInstrument } from './types';
import { makeInstrument } from './venues/shared';

const memoryStorage = () => (globalThis as any).__memoryStorage;

class SilentSocket {
  static instances: SilentSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    SilentSocket.instances.push(this);
  }
  send(): void {}
  close(): void {
    this.closed = true;
    this.readyState = 3;
  }
  static reset(): void {
    SilentSocket.instances = [];
  }
}

function spot(
  venue: VenueInstrument['venue'],
  instrumentId: string,
  symbol: string,
  category: VenueInstrument['category'] = 'stock',
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

function perp(
  venue: VenueInstrument['venue'],
  instrumentId: string,
  symbol: string,
): VenueInstrument {
  return makeInstrument({
    venue,
    instrumentId,
    symbol,
    base: symbol.replace(/\./g, ''),
    quote: 'USDT',
    category: 'stock',
    productKind: 'equity_perp',
    preferredPriceKind: 'index',
  });
}

async function seedCatalog(instruments: VenueInstrument[]): Promise<void> {
  await chrome.storage.local.set({
    [EXCHANGE_CATALOG_STORAGE_KEY]: {
      version: 'v1',
      timestamp: Date.now(),
      instruments,
    },
  });
}

interface FetchLog {
  urls: string[];
}

/** 覆盖四家 venue 的 targeted quote endpoint；未知 instrument 一律 404 */
function mockQuoteFetch(prices: Record<string, number>, log: FetchLog) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    log.urls.push(url);

    if (url.includes('okx.com/api/v5/market/ticker')) {
      const instId = new URL(url).searchParams.get('instId')!;
      const price = prices[`okx:${instId}`];
      if (price == null) return new Response(JSON.stringify({ code: '0', data: [] }));
      return new Response(
        JSON.stringify({
          code: '0',
          data: [{ instId, last: String(price), open24h: String(price * 0.99), volCcy24h: '100' }],
        }),
      );
    }
    if (url.includes('okx.com/api/v5/market/index-tickers')) {
      const instId = new URL(url).searchParams.get('instId')!;
      const price = prices[`okx-index:${instId}`];
      if (price == null) return new Response(JSON.stringify({ code: '0', data: [] }));
      return new Response(
        JSON.stringify({
          code: '0',
          data: [{ instId, idxPx: String(price), open24h: String(price * 0.99) }],
        }),
      );
    }
    if (url.includes('bitget.com/api/v3/market/tickers')) {
      const symbol = new URL(url).searchParams.get('symbol')!;
      const price = prices[`bitget:${symbol}`];
      if (price == null) return new Response(JSON.stringify({ code: '00000', data: [] }));
      const isFutures = url.includes('USDT-FUTURES');
      return new Response(
        JSON.stringify({
          code: '00000',
          data: [
            {
              symbol,
              lastPrice: String(price),
              price24hPcnt: '0.01',
              turnover24h: '1000',
              ...(isFutures ? { indexPrice: String(price) } : {}),
            },
          ],
        }),
      );
    }
    if (url.includes('binance.vision/api/v3/ticker/24hr')) {
      const symbols = JSON.parse(new URL(url).searchParams.get('symbols')!) as string[];
      const rows = symbols
        .filter((s) => prices[`binance:${s}`] != null)
        .map((s) => ({
          symbol: s,
          lastPrice: String(prices[`binance:${s}`]),
          priceChangePercent: '1',
          quoteVolume: '1000',
          closeTime: Date.now(),
        }));
      return new Response(JSON.stringify(rows));
    }
    if (url.includes('fapi.binance.com/fapi/v1/premiumIndex')) {
      const symbol = new URL(url).searchParams.get('symbol')!;
      const price = prices[`binance-perp:${symbol}`];
      if (price == null) return new Response('not found', { status: 404 });
      return new Response(
        JSON.stringify({ symbol, indexPrice: String(price), markPrice: String(price) }),
      );
    }
    if (url.includes('fapi.binance.com/fapi/v1/ticker/24hr')) {
      return new Response(JSON.stringify({ priceChangePercent: '1', quoteVolume: '10' }));
    }
    if (url.includes('hyperliquid.xyz')) {
      const body = JSON.parse(String((init as RequestInit)?.body ?? '{}'));
      const price = prices[`hyperliquid:${body.coin}`];
      if (price == null) return new Response('not found', { status: 404 });
      return new Response(
        JSON.stringify({
          coin: body.coin,
          time: Date.now(),
          levels: [[{ px: String(price) }], [{ px: String(price) }]],
        }),
      );
    }
    return new Response('not found', { status: 404 });
  });
}

let service: PriceService;

beforeEach(() => {
  // REALTIME 需要 visible + focused；jsdom 默认 hasFocus() 为 false
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  memoryStorage()?.__reset?.();
  exchangeCatalog.__resetForTest();
  SilentSocket.reset();
  __setWebSocketFactoryForTest((url) => new SilentSocket(url) as unknown as WebSocket);
  service = new PriceService();
});

afterEach(() => {
  service.__resetForTest();
  exchangeCatalog.__resetForTest();
  __setWebSocketFactoryForTest(null);
  vi.restoreAllMocks();
});

describe('targeted REST', () => {
  it('周期报价不存在任何未限定 symbol 的全市场 ticker 请求', async () => {
    await seedCatalog([
      spot('okx', 'XNVDA-USDT', 'NVDA'),
      spot('bitget', 'RNVDAUSDT', 'NVDA'),
      spot('binance', 'NVDABUSDT', 'NVDA'),
    ]);
    const log: FetchLog = { urls: [] };
    mockQuoteFetch(
      { 'okx:XNVDA-USDT': 200, 'bitget:RNVDAUSDT': 200.5, 'binance:NVDABUSDT': 201 },
      log,
    );

    service.subscribe(new Set<AssetKey>(['stock:NVDA']), () => {});
    await service.__settleForTest();

    expect(log.urls.length).toBeGreaterThan(0);
    for (const url of log.urls) {
      expect(url).not.toMatch(/market\/tickers\?instType=/);
      expect(url).not.toMatch(/ticker\/24hr$/);
      expect(url).not.toMatch(/allMids|metaAndAssetCtxs/);
    }
    expect(log.urls.some((u) => u.includes('instId=XNVDA-USDT'))).toBe(true);
    expect(
      log.urls.some((u) => u.includes('category=SPOT') && u.includes('symbol=RNVDAUSDT')),
    ).toBe(true);
    expect(log.urls.some((u) => u.includes('symbols='))).toBe(true);
  });

  it('三家 tokenized spot 聚合成 consensus 快照', async () => {
    await seedCatalog([
      spot('okx', 'XNVDA-USDT', 'NVDA'),
      spot('bitget', 'RNVDAUSDT', 'NVDA'),
      spot('binance', 'NVDABUSDT', 'NVDA'),
    ]);
    mockQuoteFetch(
      { 'okx:XNVDA-USDT': 200, 'bitget:RNVDAUSDT': 200.5, 'binance:NVDABUSDT': 201 },
      { urls: [] },
    );

    service.subscribe(new Set<AssetKey>(['stock:NVDA']), () => {});
    await service.__settleForTest();

    const snap = service.getSnapshot('stock:NVDA')!;
    expect(snap.price).toBe(200.5);
    expect(snap.coverageTier).toBe('tokenized-spot-consensus');
    expect(snap.sources).toEqual(['okx', 'bitget', 'binance']);
  });

  it('选中新资产后立即请求，不等 timer', async () => {
    await seedCatalog([spot('okx', 'XNVDA-USDT', 'NVDA'), spot('okx', 'XAAPL-USDT', 'AAPL')]);
    const log: FetchLog = { urls: [] };
    mockQuoteFetch({ 'okx:XNVDA-USDT': 200, 'okx:XAAPL-USDT': 300 }, log);

    const sub = service.subscribe(new Set<AssetKey>(['stock:NVDA']), () => {});
    await service.__settleForTest();
    log.urls.length = 0;

    sub.updateAssets(new Set<AssetKey>(['stock:NVDA', 'stock:AAPL']));
    await service.__settleForTest();

    expect(log.urls.some((u) => u.includes('instId=XAAPL-USDT'))).toBe(true);
    expect(service.getSnapshot('stock:AAPL')!.price).toBe(300);
  });

  it('单个 venue 失败时其余 venue 继续更新', async () => {
    await seedCatalog([spot('okx', 'XNVDA-USDT', 'NVDA'), spot('bitget', 'RNVDAUSDT', 'NVDA')]);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('okx.com')) throw new Error('okx down');
      if (url.includes('bitget.com')) {
        return new Response(
          JSON.stringify({
            code: '00000',
            data: [{ symbol: 'RNVDAUSDT', lastPrice: '200', price24hPcnt: '0.01' }],
          }),
        );
      }
      return new Response('not found', { status: 404 });
    });

    service.subscribe(new Set<AssetKey>(['stock:NVDA']), () => {});
    await service.__settleForTest();

    const snap = service.getSnapshot('stock:NVDA')!;
    expect(snap.price).toBe(200);
    expect(snap.sources).toEqual(['bitget']);
  });
});

describe('冷启动 candidate 验证', () => {
  it('没有 catalog 缓存时用保守 candidate 做 targeted 验证，不请求全市场 catalog', async () => {
    const log: FetchLog = { urls: [] };
    mockQuoteFetch(
      { 'okx:BTC-USDT': 70000, 'bitget:BTCUSDT': 70100, 'binance:BTCUSDT': 70050 },
      log,
    );

    service.subscribe(new Set<AssetKey>(['crypto:BTC']), () => {});
    await service.__settleForTest();

    expect(log.urls.some((u) => u.includes('public/instruments'))).toBe(false);
    expect(log.urls.some((u) => u.includes('exchangeInfo'))).toBe(false);
    expect(service.getSnapshot('crypto:BTC')!.price).toBe(70050);
  });

  it('验证成功后 mapping 写回 catalog 缓存', async () => {
    mockQuoteFetch({ 'okx:BTC-USDT': 70000 }, { urls: [] });

    service.subscribe(new Set<AssetKey>(['crypto:BTC']), () => {});
    await service.__settleForTest();
    await Promise.resolve();

    expect(exchangeCatalog.instrumentsFor('crypto:BTC').map((i) => i.instrumentId)).toEqual([
      'BTC-USDT',
    ]);
  });

  it('Tier 1 全部失败时才试 Tier 2，并标记 derivative-reference', async () => {
    const log: FetchLog = { urls: [] };
    mockQuoteFetch({ 'bitget:BRKBUSDT': 512.8, 'okx-index:BRKB-USDT': 512.9 }, log);

    service.subscribe(new Set<AssetKey>(['stock:BRK.B']), () => {});
    await service.__settleForTest();

    expect(log.urls.some((u) => u.includes('instId=XBRKB-USDT'))).toBe(true);
    const snap = service.getSnapshot('stock:BRK.B')!;
    expect(snap.coverageTier).toBe('derivative-reference');
    expect(snap.priceKind).toBe('index');
  });

  it('FBTC / XLF 没有精确 instrument 时标记 unavailable，不使用代理价', async () => {
    const log: FetchLog = { urls: [] };
    mockQuoteFetch({ 'okx:BTC-USDT': 70000, 'binance:IBITBUSDT': 60 }, log);

    service.subscribe(new Set<AssetKey>(['etf:FBTC', 'etf:XLF']), () => {});
    await service.__settleForTest();

    for (const key of ['etf:FBTC', 'etf:XLF'] as AssetKey[]) {
      const snap = service.getSnapshot(key)!;
      expect(snap.quality).toBe('unavailable');
      expect(snap.coverageTier).toBe('unavailable');
      expect(snap.sourceCount).toBe(0);
    }
    // 只请求过由 canonical 推导出来的 instrument，没有借用 BTC / IBIT 之类的代理
    expect(log.urls.some((u) => u.includes('instId=BTC-USDT'))).toBe(false);
    expect(log.urls.some((u) => u.includes('IBIT'))).toBe(false);
    expect(log.urls.some((u) => u.includes('XFBTC-USDT'))).toBe(true);
    expect(log.urls.some((u) => u.includes('RXLFUSDT'))).toBe(true);
  });

  it('FX 没有经过验证的公开产品，直接 unavailable 且零请求', async () => {
    const log: FetchLog = { urls: [] };
    mockQuoteFetch({}, log);

    service.subscribe(new Set<AssetKey>(['fx:EURUSD']), () => {});
    await service.__settleForTest();

    expect(log.urls).toHaveLength(0);
    expect(service.getSnapshot('fx:EURUSD')!.quality).toBe('unavailable');
  });
});

describe('稳定订阅与 union', () => {
  it('多个 subscriber 的 AssetKey 取并集且去重', async () => {
    await seedCatalog([
      spot('okx', 'BTC-USDT', 'BTC', 'crypto'),
      spot('okx', 'ETH-USDT', 'ETH', 'crypto'),
      spot('okx', 'SOL-USDT', 'SOL', 'crypto'),
    ]);
    mockQuoteFetch(
      { 'okx:BTC-USDT': 70000, 'okx:ETH-USDT': 3500, 'okx:SOL-USDT': 200 },
      { urls: [] },
    );

    service.subscribe(new Set<AssetKey>(['crypto:BTC', 'crypto:ETH']), () => {});
    service.subscribe(new Set<AssetKey>(['crypto:ETH', 'crypto:SOL']), () => {});
    await service.__settleForTest();

    const ids = service
      .__desiredInstrumentsForTest()
      .map((i) => i.instrumentId)
      .sort();
    expect(ids).toEqual(['BTC-USDT', 'ETH-USDT', 'SOL-USDT']);
  });

  it('subscriber 只收到自己关注的 AssetKey', async () => {
    await seedCatalog([
      spot('okx', 'BTC-USDT', 'BTC', 'crypto'),
      spot('okx', 'ETH-USDT', 'ETH', 'crypto'),
    ]);
    mockQuoteFetch({ 'okx:BTC-USDT': 70000, 'okx:ETH-USDT': 3500 }, { urls: [] });

    let latest = new Map<AssetKey, PriceSnapshot>();
    service.subscribe(new Set<AssetKey>(['crypto:BTC']), (snap) => {
      latest = snap;
    });
    service.subscribe(new Set<AssetKey>(['crypto:ETH']), () => {});
    await service.__settleForTest();

    expect([...latest.keys()]).toEqual(['crypto:BTC']);
  });

  it('setActive(false) 的订阅不进入 union，价格网络活动归零', async () => {
    await seedCatalog([spot('okx', 'BTC-USDT', 'BTC', 'crypto')]);
    const log: FetchLog = { urls: [] };
    mockQuoteFetch({ 'okx:BTC-USDT': 70000 }, log);

    const sub = service.subscribe(new Set<AssetKey>(['crypto:BTC']), () => {});
    await service.__settleForTest();
    expect(service.__connectionCountForTest()).toBeGreaterThan(0);
    log.urls.length = 0;

    sub.setActive(false);
    await service.__settleForTest();

    expect(service.__desiredInstrumentsForTest()).toHaveLength(0);
    expect(service.__connectionCountForTest()).toBe(0);
    expect(log.urls).toHaveLength(0);
  });

  it('快速切换 layout（旧的先失活、新的再激活）不会产生瞬时断连', async () => {
    await seedCatalog([spot('okx', 'BTC-USDT', 'BTC', 'crypto')]);
    mockQuoteFetch({ 'okx:BTC-USDT': 70000 }, { urls: [] });

    const oldLayout = service.subscribe(new Set<AssetKey>(['crypto:BTC']), () => {});
    await service.__settleForTest();
    const socketBefore = SilentSocket.instances.length;

    // 同一个 microtask 里失活旧的、激活新的
    oldLayout.setActive(false);
    service.subscribe(new Set<AssetKey>(['crypto:BTC']), () => {});
    await service.__settleForTest();

    expect(SilentSocket.instances).toHaveLength(socketBefore);
    expect(SilentSocket.instances.every((s) => !s.closed)).toBe(true);
  });

  it('unsubscribe 后不再收到通知', async () => {
    await seedCatalog([spot('okx', 'BTC-USDT', 'BTC', 'crypto')]);
    mockQuoteFetch({ 'okx:BTC-USDT': 70000 }, { urls: [] });

    const cb = vi.fn();
    const sub = service.subscribe(new Set<AssetKey>(['crypto:BTC']), cb);
    await service.__settleForTest();
    sub.unsubscribe();
    cb.mockClear();

    await service.refreshAssets(new Set<AssetKey>(['crypto:BTC']));
    expect(cb).not.toHaveBeenCalled();
  });

  it('subscriber 抛错被捕获，不影响其他 subscriber', async () => {
    await seedCatalog([spot('okx', 'BTC-USDT', 'BTC', 'crypto')]);
    mockQuoteFetch({ 'okx:BTC-USDT': 70000 }, { urls: [] });

    const good = vi.fn();
    service.subscribe(new Set<AssetKey>(['crypto:BTC']), () => {
      throw new Error('boom');
    });
    service.subscribe(new Set<AssetKey>(['crypto:BTC']), good);
    await service.__settleForTest();

    expect(good).toHaveBeenCalled();
  });
});

describe('缓存迁移', () => {
  it('旧的 stock:SQ 缓存迁移到 stock:XYZ 且标记 stale', async () => {
    await chrome.storage.local.set({
      [PRICES_STORAGE_KEY]: {
        version: 'v2',
        snapshots: {
          'stock:SQ': {
            assetKey: 'stock:SQ',
            symbol: 'SQ',
            price: 60,
            change24h: 1,
            volume24h: null,
            lastUpdate: 1000,
            source: 'okx',
            sources: ['okx'],
            sourceCount: 1,
            quality: 'live',
            coverageTier: 'single-source',
            quoteCurrency: 'USDT',
            productKind: 'tokenized_stock_spot',
            priceKind: 'last',
          },
        },
      },
    });
    mockQuoteFetch({}, { urls: [] });

    service.subscribe(new Set<AssetKey>(['stock:XYZ']), () => {});
    await service.__settleForTest();

    // 缓存价被保留下来，但明确标记为暂无可用市场，不会伪装成 live
    const snap = service.getSnapshot('stock:XYZ')!;
    expect(snap.symbol).toBe('XYZ');
    expect(snap.assetKey).toBe('stock:XYZ');
    expect(snap.price).toBe(60);
    expect(snap.quality).toBe('unavailable');
  });

  it('旧缓存永远不作为 fresh 来源参与聚合', async () => {
    await chrome.storage.local.set({
      [PRICES_STORAGE_KEY]: {
        version: 'v2',
        snapshots: { 'stock:NVDA': makeCached('stock:NVDA', 'NVDA', 60, 1000) },
      },
    });
    await seedCatalog([spot('okx', 'XNVDA-USDT', 'NVDA')]);
    mockQuoteFetch({ 'okx:XNVDA-USDT': 200 }, { urls: [] });

    service.subscribe(new Set<AssetKey>(['stock:NVDA']), () => {});
    await service.__settleForTest();

    const snap = service.getSnapshot('stock:NVDA')!;
    expect(snap.price).toBe(200);
    expect(snap.sourceCount).toBe(1);
    expect(snap.sources).toEqual(['okx']);
    expect(snap.quality).toBe('live');
  });

  it('旧 SQ 缓存不会覆盖更新的 XYZ 报价', async () => {
    await chrome.storage.local.set({
      [PRICES_STORAGE_KEY]: {
        version: 'v2',
        snapshots: {
          'stock:XYZ': makeCached('stock:XYZ', 'XYZ', 80, 5000),
          'stock:SQ': makeCached('stock:SQ', 'SQ', 60, 1000),
        },
      },
    });
    mockQuoteFetch({}, { urls: [] });

    service.subscribe(new Set<AssetKey>(['stock:XYZ']), () => {});
    await service.__settleForTest();

    expect(service.getSnapshot('stock:XYZ')!.price).toBe(80);
  });

  it('启动时清理旧 Pyth 缓存 key', async () => {
    await chrome.storage.local.set({ prices_cache_v1: { x: 1 }, pyth_catalog_v1: { y: 2 } });
    mockQuoteFetch({}, { urls: [] });

    service.subscribe(new Set<AssetKey>(['fx:EURUSD']), () => {});
    await service.__settleForTest();

    const store = memoryStorage().__getStore();
    expect(store.prices_cache_v1).toBeUndefined();
    expect(store.pyth_catalog_v1).toBeUndefined();
  });
});

describe('crypto:COIN 与 stock:COIN 不冲突', () => {
  it('两个资产各自解析到自己的 instrument', async () => {
    await seedCatalog([
      spot('okx', 'COIN-USDT', 'COIN', 'crypto'),
      spot('okx', 'XCOIN-USDT', 'COIN', 'stock'),
    ]);
    mockQuoteFetch({ 'okx:COIN-USDT': 1.5, 'okx:XCOIN-USDT': 320 }, { urls: [] });

    service.subscribe(new Set<AssetKey>(['crypto:COIN', 'stock:COIN']), () => {});
    await service.__settleForTest();

    expect(service.getSnapshot('crypto:COIN')!.price).toBe(1.5);
    expect(service.getSnapshot('stock:COIN')!.price).toBe(320);
  });
});

describe('perp fallback 与 BRK.B', () => {
  it('BRK.B 命中 equity perp 并使用 index 价格', async () => {
    await seedCatalog([
      perp('bitget', 'BRKBUSDT', 'BRK.B'),
      perp('okx', 'BRKB-USDT-SWAP', 'BRK.B'),
    ]);
    mockQuoteFetch({ 'bitget:BRKBUSDT': 512.8, 'okx-index:BRKB-USDT': 512.9 }, { urls: [] });

    service.subscribe(new Set<AssetKey>(['stock:BRK.B']), () => {});
    await service.__settleForTest();

    const snap = service.getSnapshot('stock:BRK.B')!;
    expect(snap.coverageTier).toBe('derivative-reference');
    expect(snap.quality).toBe('degraded');
    expect(snap.priceKind).toBe('index');
    expect(snap.price).toBeCloseTo(512.85, 4);
  });
});

function makeCached(
  assetKey: AssetKey,
  symbol: string,
  price: number,
  lastUpdate: number,
): PriceSnapshot {
  return {
    assetKey,
    symbol,
    price,
    change24h: null,
    volume24h: null,
    lastUpdate,
    source: 'okx',
    sources: ['okx'],
    sourceCount: 1,
    quality: 'live',
    coverageTier: 'single-source',
    quoteCurrency: 'USDT',
    productKind: 'tokenized_stock_spot',
    priceKind: 'last',
  };
}
