import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CATALOG_TTL_MS, EXCHANGE_CATALOG_STORAGE_KEY, exchangeCatalog } from './exchangeCatalog';
import type { VenueInstrument } from './types';
import { makeInstrument } from './venues/shared';

const memoryStorage = () => (globalThis as any).__memoryStorage;

function instrument(
  overrides: Partial<Parameters<typeof makeInstrument>[0]> & {
    instrumentId: string;
    symbol: string;
  },
): VenueInstrument {
  return makeInstrument({
    venue: 'okx',
    base: overrides.symbol,
    quote: 'USDT',
    category: 'stock',
    productKind: 'tokenized_stock_spot',
    preferredPriceKind: 'last',
    ...overrides,
  });
}

async function seedCache(instruments: VenueInstrument[], timestamp: number): Promise<void> {
  await chrome.storage.local.set({
    [EXCHANGE_CATALOG_STORAGE_KEY]: { version: 'v1', timestamp, instruments },
  });
}

/** 返回一个能覆盖四家 venue metadata 端点的 fetch mock */
function mockVenueFetch(options: {
  okxSpot?: unknown[];
  okxSwap?: unknown[];
  bitgetSpot?: unknown[];
  bitgetFutures?: unknown[];
  binanceSpot?: unknown[];
  binanceFutures?: unknown[];
  hyperliquidUniverse?: unknown[];
  failVenue?: 'okx' | 'bitget' | 'binance' | 'hyperliquid';
}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const fail = (venue: string) =>
      options.failVenue === venue ? new Response('boom', { status: 503 }) : null;

    if (url.includes('okx.com')) {
      const failed = fail('okx');
      if (failed) return failed;
      const data = url.includes('instType=SPOT') ? options.okxSpot : options.okxSwap;
      return new Response(JSON.stringify({ code: '0', data: data ?? [] }), { status: 200 });
    }
    if (url.includes('bitget.com')) {
      const failed = fail('bitget');
      if (failed) return failed;
      const data = url.includes('category=SPOT') ? options.bitgetSpot : options.bitgetFutures;
      return new Response(JSON.stringify({ code: '00000', data: data ?? [] }), { status: 200 });
    }
    if (url.includes('binance.vision')) {
      const failed = fail('binance');
      if (failed) return failed;
      return new Response(JSON.stringify({ symbols: options.binanceSpot ?? [] }), { status: 200 });
    }
    if (url.includes('fapi.binance.com')) {
      const failed = fail('binance');
      if (failed) return failed;
      return new Response(JSON.stringify({ symbols: options.binanceFutures ?? [] }), {
        status: 200,
      });
    }
    if (url.includes('hyperliquid.xyz')) {
      const failed = fail('hyperliquid');
      if (failed) return failed;
      const body = JSON.parse(String((init as RequestInit)?.body ?? '{}'));
      if (body.type === 'perpDexs') {
        return new Response(
          JSON.stringify([{ name: 'xyz', deployer: '0x88806a71d74ad0a510b350545c9ae490912f0888' }]),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ universe: options.hyperliquidUniverse ?? [] }), {
        status: 200,
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

beforeEach(() => {
  exchangeCatalog.__resetForTest();
  memoryStorage()?.__reset?.();
});

afterEach(() => {
  exchangeCatalog.__resetForTest();
  vi.restoreAllMocks();
});

describe('catalog 请求时机', () => {
  it('应用启动只读本地缓存，不发任何远程请求', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await seedCache([instrument({ instrumentId: 'XNVDA-USDT', symbol: 'NVDA' })], Date.now());

    await exchangeCatalog.loadCachedOnly();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(exchangeCatalog.instrumentsFor('stock:NVDA')).toHaveLength(1);
  });

  it('24 小时内的 fresh 缓存不会触发刷新', async () => {
    await seedCache([instrument({ instrumentId: 'XNVDA-USDT', symbol: 'NVDA' })], Date.now());
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await exchangeCatalog.ensureFresh();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(exchangeCatalog.isFresh()).toBe(true);
  });

  it('stale 缓存先返回旧数据，再后台刷新', async () => {
    await seedCache(
      [instrument({ instrumentId: 'XNVDA-USDT', symbol: 'NVDA' })],
      Date.now() - CATALOG_TTL_MS - 1000,
    );
    const fetchSpy = mockVenueFetch({
      okxSpot: [
        {
          instType: 'SPOT',
          instId: 'XTSLA-USDT',
          instCategory: '3',
          baseCcy: 'XTSLA',
          quoteCcy: 'USDT',
          state: 'live',
        },
      ],
    });

    await exchangeCatalog.ensureFresh();

    // 立即可用的仍是 stale 缓存
    expect(exchangeCatalog.instrumentsFor('stock:NVDA')).toHaveLength(1);
    expect(exchangeCatalog.isFresh()).toBe(false);

    await exchangeCatalog.__pendingRefreshForTest();
    expect(fetchSpy).toHaveBeenCalled();
    expect(exchangeCatalog.instrumentsFor('stock:TSLA')).toHaveLength(1);
    expect(exchangeCatalog.isFresh()).toBe(true);
  });

  it('没有缓存时 ensureFresh 会等待刷新完成', async () => {
    mockVenueFetch({
      okxSpot: [
        {
          instType: 'SPOT',
          instId: 'XSPY-USDT',
          instCategory: '3',
          baseCcy: 'XSPY',
          quoteCcy: 'USDT',
          state: 'live',
        },
      ],
    });

    await exchangeCatalog.ensureFresh();

    expect(exchangeCatalog.instrumentsFor('etf:SPY')).toHaveLength(1);
  });

  it('catalog 刷新只拉 instruments / exchangeInfo，不拉全市场 ticker', async () => {
    const fetchSpy = mockVenueFetch({});
    await exchangeCatalog.ensureFresh().catch(() => {});

    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/market/tickers'))).toBe(false);
    expect(urls.some((u) => u.includes('/ticker/24hr'))).toBe(false);
    expect(urls.some((u) => u.includes('/market/ticker?'))).toBe(false);
    expect(urls.some((u) => u.includes('public/instruments'))).toBe(true);
    expect(urls.some((u) => u.includes('exchangeInfo'))).toBe(true);
  });

  it('search 是纯本地查询，不产生网络请求', async () => {
    await seedCache([instrument({ instrumentId: 'XNVDA-USDT', symbol: 'NVDA' })], Date.now());
    await exchangeCatalog.loadCachedOnly();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    for (const q of ['N', 'NV', 'NVD', 'NVDA']) {
      expect(exchangeCatalog.search(q, 'all').length).toBeGreaterThan(0);
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('冷启动 mapping 回写', () => {
  it('回写 candidate mapping 不会把 catalog 标成 fresh', async () => {
    await exchangeCatalog.loadCachedOnly();
    await exchangeCatalog.mergeResolvedInstruments([
      instrument({ instrumentId: 'XNVDA-USDT', symbol: 'NVDA' }),
    ]);

    expect(exchangeCatalog.instrumentsFor('stock:NVDA')).toHaveLength(1);
    expect(exchangeCatalog.hasData()).toBe(true);
    expect(exchangeCatalog.isFresh()).toBe(false);
  });

  it('随后打开弹窗仍会拉一次完整 catalog', async () => {
    await exchangeCatalog.loadCachedOnly();
    await exchangeCatalog.mergeResolvedInstruments([
      instrument({ instrumentId: 'XNVDA-USDT', symbol: 'NVDA' }),
    ]);
    const fetchSpy = mockVenueFetch({
      okxSpot: [
        {
          instType: 'SPOT',
          instId: 'XAAPL-USDT',
          instCategory: '3',
          baseCcy: 'XAAPL',
          quoteCcy: 'USDT',
          state: 'live',
        },
      ],
    });

    await exchangeCatalog.ensureFresh();
    await exchangeCatalog.__pendingRefreshForTest();

    expect(fetchSpy).toHaveBeenCalled();
    expect(exchangeCatalog.isSelectable('stock:AAPL')).toBe(true);
    expect(exchangeCatalog.isFresh()).toBe(true);
  });
});

describe('catalog 合并规则', () => {
  it('单个 venue 失败只降级该 venue，其余照常更新', async () => {
    await seedCache(
      [
        makeInstrument({
          venue: 'bitget',
          instrumentId: 'RNVDAUSDT',
          symbol: 'NVDA',
          base: 'RNVDA',
          quote: 'USDT',
          category: 'stock',
          productKind: 'tokenized_stock_spot',
          preferredPriceKind: 'last',
        }),
      ],
      Date.now() - CATALOG_TTL_MS - 1000,
    );
    mockVenueFetch({
      failVenue: 'bitget',
      okxSpot: [
        {
          instType: 'SPOT',
          instId: 'XTSLA-USDT',
          instCategory: '3',
          baseCcy: 'XTSLA',
          quoteCcy: 'USDT',
          state: 'live',
        },
      ],
    });

    await exchangeCatalog.ensureFresh();
    await exchangeCatalog.__pendingRefreshForTest();

    expect(exchangeCatalog.instrumentsFor('stock:TSLA').map((i) => i.venue)).toEqual(['okx']);
    // Bitget 失败，但它上一版的 mapping 仍然保留
    expect(exchangeCatalog.instrumentsFor('stock:NVDA').map((i) => i.venue)).toEqual(['bitget']);
  });

  it('一个 AssetKey 可以对应多个 venue instrument', async () => {
    mockVenueFetch({
      okxSpot: [
        {
          instType: 'SPOT',
          instId: 'XNVDA-USDT',
          instCategory: '3',
          baseCcy: 'XNVDA',
          quoteCcy: 'USDT',
          state: 'live',
        },
      ],
      bitgetSpot: [
        {
          symbol: 'RNVDAUSDT',
          category: 'SPOT',
          baseCoin: 'rNVDA',
          quoteCoin: 'USDT',
          symbolType: 'stock',
          isReality: 'yes',
          status: 'online',
        },
      ],
      binanceSpot: [
        { symbol: 'NVDABUSDT', baseAsset: 'NVDAB', quoteAsset: 'USDT', status: 'TRADING' },
      ],
    });

    await exchangeCatalog.ensureFresh();

    const venues = exchangeCatalog
      .instrumentsFor('stock:NVDA')
      .map((i) => i.venue)
      .sort();
    expect(venues).toEqual(['binance', 'bitget', 'okx']);
  });

  it('suspended / offline instrument 不可被选择', async () => {
    mockVenueFetch({
      okxSpot: [
        {
          instType: 'SPOT',
          instId: 'XNVDA-USDT',
          instCategory: '3',
          baseCcy: 'XNVDA',
          quoteCcy: 'USDT',
          state: 'suspend',
        },
      ],
    });

    await exchangeCatalog.ensureFresh();

    expect(exchangeCatalog.isSelectable('stock:NVDA')).toBe(false);
  });

  it('FBTC / XLF 没有精确 instrument 时不可选，也不会被同名或近似产品顶替', async () => {
    mockVenueFetch({
      okxSpot: [
        {
          instType: 'SPOT',
          instId: 'BTC-USDT',
          instCategory: '1',
          baseCcy: 'BTC',
          quoteCcy: 'USDT',
          state: 'live',
        },
        {
          instType: 'SPOT',
          instId: 'XXLE-USDT',
          instCategory: '3',
          baseCcy: 'XXLE',
          quoteCcy: 'USDT',
          state: 'live',
        },
      ],
      bitgetSpot: [
        {
          symbol: 'RIBITUSDT',
          category: 'SPOT',
          baseCoin: 'rIBIT',
          quoteCoin: 'USDT',
          symbolType: 'stock',
          isReality: 'yes',
          status: 'online',
        },
      ],
    });

    await exchangeCatalog.ensureFresh();

    expect(exchangeCatalog.isSelectable('etf:FBTC')).toBe(false);
    expect(exchangeCatalog.isSelectable('etf:XLF')).toBe(false);
    expect(exchangeCatalog.instrumentsFor('etf:FBTC')).toHaveLength(0);
    expect(exchangeCatalog.instrumentsFor('etf:XLF')).toHaveLength(0);
    // 相邻的 XLE / IBIT / BTC 依然各自成立，不会被借用
    expect(exchangeCatalog.isSelectable('etf:XLE')).toBe(true);
    expect(exchangeCatalog.isSelectable('etf:IBIT')).toBe(true);
    expect(exchangeCatalog.isSelectable('crypto:BTC')).toBe(true);
  });

  it('crypto:COIN 与 stock:COIN 各自独立', async () => {
    mockVenueFetch({
      okxSpot: [
        {
          instType: 'SPOT',
          instId: 'COIN-USDT',
          instCategory: '1',
          baseCcy: 'COIN',
          quoteCcy: 'USDT',
          state: 'live',
        },
        {
          instType: 'SPOT',
          instId: 'XCOIN-USDT',
          instCategory: '3',
          baseCcy: 'XCOIN',
          quoteCcy: 'USDT',
          state: 'live',
        },
      ],
    });

    await exchangeCatalog.ensureFresh();

    expect(exchangeCatalog.instrumentsFor('crypto:COIN')[0].instrumentId).toBe('COIN-USDT');
    expect(exchangeCatalog.instrumentsFor('stock:COIN')[0].instrumentId).toBe('XCOIN-USDT');
  });

  it('curated 元数据优先于动态条目', async () => {
    mockVenueFetch({
      okxSpot: [
        {
          instType: 'SPOT',
          instId: 'XNVDA-USDT',
          instCategory: '3',
          baseCcy: 'XNVDA',
          quoteCcy: 'USDT',
          state: 'live',
        },
        {
          instType: 'SPOT',
          instId: 'XLLY-USDT',
          instCategory: '3',
          baseCcy: 'XLLY',
          quoteCcy: 'USDT',
          state: 'live',
        },
      ],
    });

    await exchangeCatalog.ensureFresh();

    const entries = exchangeCatalog.entries('stock');
    const nvda = entries.find((e) => e.assetKey === 'stock:NVDA');
    const lly = entries.find((e) => e.assetKey === 'stock:LLY');
    expect(nvda?.meta.name).toBe('NVIDIA');
    expect(nvda?.selectable).toBe(true);
    expect(lly?.meta.name).toBe('LLY');
    expect(entries.filter((e) => e.assetKey === 'stock:NVDA')).toHaveLength(1);
  });
});
