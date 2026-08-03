import { describe, it, expect } from 'vitest';
import {
  bitgetCategoryFor,
  bitgetTickerUrl,
  buildBitgetInstruments,
  collectBitgetEquitySymbols,
  normalizeBitgetTicker,
  stripBitgetRealityPrefix,
  type BitgetRawCatalog,
} from './bitget';
import { makeInstrument, type CatalogContext } from './shared';

function raw(partial: Partial<BitgetRawCatalog>): BitgetRawCatalog {
  return { spot: partial.spot ?? [], futures: partial.futures ?? [] };
}

const reality = (baseCoin: string, extra: Record<string, unknown> = {}) => ({
  symbol: `${baseCoin.toUpperCase()}USDT`,
  category: 'SPOT',
  baseCoin,
  quoteCoin: 'USDT',
  symbolType: 'stock',
  isReality: 'yes',
  status: 'online',
  ...extra,
});

const stockPerp = (baseCoin: string, extra: Record<string, unknown> = {}) => ({
  symbol: `${baseCoin}USDT`,
  category: 'USDT-FUTURES',
  baseCoin,
  quoteCoin: 'USDT',
  symbolType: 'stock',
  isRwa: 'YES',
  type: 'perpetual',
  status: 'online',
  ...extra,
});

const ctx = (symbols: string[] = []): CatalogContext => ({
  confirmedEquitySymbols: new Set(symbols),
});

describe('Bitget Reality 代币化股票现货', () => {
  it('rAAPL → AAPL', () => {
    const out = buildBitgetInstruments(raw({ spot: [reality('rAAPL')] }), ctx());
    expect(out[0]).toMatchObject({
      assetKey: 'stock:AAPL',
      instrumentId: 'RAAPLUSDT',
      productKind: 'tokenized_stock_spot',
    });
  });

  it('rXYZ → XYZ（Block 迁移后的 canonical）', () => {
    const out = buildBitgetInstruments(raw({ spot: [reality('rXYZ')] }), ctx());
    expect(out[0]).toMatchObject({ assetKey: 'stock:XYZ', instrumentId: 'RXYZUSDT' });
  });

  it('isReality=no 的股票不算 Reality 现货', () => {
    const out = buildBitgetInstruments(
      raw({ spot: [reality('preSPCX', { isReality: 'no', symbol: 'PRESPCXUSDT' })] }),
      ctx(),
    );
    expect(out).toHaveLength(0);
  });

  it('symbolType=crypto 走普通现货，不剥 r 前缀', () => {
    const out = buildBitgetInstruments(
      raw({
        spot: [
          {
            symbol: 'RENDERUSDT',
            category: 'SPOT',
            baseCoin: 'RENDER',
            quoteCoin: 'USDT',
            symbolType: 'crypto',
            isReality: 'no',
            status: 'online',
          },
        ],
      }),
      ctx(),
    );
    expect(out[0]).toMatchObject({ assetKey: 'crypto:RENDER', productKind: 'crypto_spot' });
  });

  it('status 非 online 不进入 catalog', () => {
    const out = buildBitgetInstruments(
      raw({ spot: [reality('rAAPL', { status: 'offline' })] }),
      ctx(),
    );
    expect(out).toHaveLength(0);
  });

  it('大小写不敏感地比较 metadata 字段', () => {
    const out = buildBitgetInstruments(
      raw({
        spot: [reality('RAAPL', { isReality: 'YES', status: 'ONLINE', symbolType: 'STOCK' })],
      }),
      ctx(),
    );
    expect(out[0]?.assetKey).toBe('stock:AAPL');
  });

  it('前缀不满足条件时返回 null', () => {
    expect(stripBitgetRealityPrefix('AAPL')).toBeNull();
    expect(stripBitgetRealityPrefix('r')).toBeNull();
    expect(stripBitgetRealityPrefix(undefined)).toBeNull();
  });
});

describe('Bitget 股票 / 商品永续', () => {
  it('BRKB 永续映射回 canonical stock:BRK.B', () => {
    const out = buildBitgetInstruments(raw({ futures: [stockPerp('BRKB')] }), ctx(['BRKB']));
    expect(out[0]).toMatchObject({
      assetKey: 'stock:BRK.B',
      symbol: 'BRK.B',
      instrumentId: 'BRKBUSDT',
      productKind: 'equity_perp',
      preferredPriceKind: 'index',
    });
  });

  it('isRwa 非 YES 的永续不收录', () => {
    const out = buildBitgetInstruments(
      raw({ futures: [stockPerp('BRKB', { isRwa: 'NO' })] }),
      ctx(['BRKB']),
    );
    expect(out).toHaveLength(0);
  });

  it('未被确认为股票的标的不收录', () => {
    const out = buildBitgetInstruments(raw({ futures: [stockPerp('NEWCO')] }), ctx([]));
    expect(out).toHaveLength(0);
  });

  it('XAUT / PAXG 虽然 symbolType=metal 但不是贵金属现货，不收录', () => {
    const out = buildBitgetInstruments(
      raw({
        futures: [
          {
            symbol: 'XAUTUSDT',
            category: 'USDT-FUTURES',
            baseCoin: 'XAUT',
            quoteCoin: 'USDT',
            symbolType: 'metal',
            isRwa: 'YES',
            type: 'perpetual',
            status: 'online',
          },
        ],
      }),
      ctx(),
    );
    expect(out).toHaveLength(0);
  });

  it('白名单内的商品永续被收录', () => {
    const out = buildBitgetInstruments(
      raw({
        futures: [
          {
            symbol: 'XAUUSDT',
            category: 'USDT-FUTURES',
            baseCoin: 'XAU',
            quoteCoin: 'USDT',
            symbolType: 'metal',
            isRwa: 'YES',
            type: 'perpetual',
            status: 'online',
          },
        ],
      }),
      ctx(),
    );
    expect(out[0]).toMatchObject({ assetKey: 'commodity:XAU', productKind: 'commodity_perp' });
  });

  it('Reality 现货与股票永续都进入确认集合', () => {
    const symbols = collectBitgetEquitySymbols(
      raw({ spot: [reality('rNVDA')], futures: [stockPerp('BRKB')] }),
    );
    expect(symbols.sort()).toEqual(['BRKB', 'NVDA']);
  });
});

describe('Bitget targeted REST', () => {
  const spotInstrument = makeInstrument({
    venue: 'bitget',
    instrumentId: 'RAAPLUSDT',
    symbol: 'AAPL',
    base: 'RAAPL',
    quote: 'USDT',
    category: 'stock',
    productKind: 'tokenized_stock_spot',
    preferredPriceKind: 'last',
  });

  const perpInstrument = makeInstrument({
    venue: 'bitget',
    instrumentId: 'BRKBUSDT',
    symbol: 'BRK.B',
    base: 'BRKB',
    quote: 'USDT',
    category: 'stock',
    productKind: 'equity_perp',
    preferredPriceKind: 'index',
  });

  it('URL 必须同时带 category 和 symbol', () => {
    const url = bitgetTickerUrl(bitgetCategoryFor(spotInstrument), spotInstrument.instrumentId);
    expect(url).toContain('category=SPOT');
    expect(url).toContain('symbol=RAAPLUSDT');
  });

  it('永续走 USDT-FUTURES category', () => {
    expect(bitgetCategoryFor(perpInstrument)).toBe('USDT-FUTURES');
  });

  it('现货 normalize 成 last，24h 变化由 price24hPcnt 换算成百分比', () => {
    const quote = normalizeBitgetTicker(spotInstrument, {
      lastPrice: '308.8',
      price24hPcnt: '0.00576',
      turnover24h: '47919639.7',
      ts: '1785738685997',
    });
    expect(quote).toMatchObject({ priceKind: 'last', price: 308.8 });
    expect(quote!.change24h).toBeCloseTo(0.576, 6);
    expect(quote!.volume24h).toBeCloseTo(47919639.7, 1);
  });

  it('永续优先 indexPrice', () => {
    const quote = normalizeBitgetTicker(perpInstrument, {
      lastPrice: '512.94',
      markPrice: '512.94',
      indexPrice: '512.81',
      price24hPcnt: '0.00137',
      ts: '1785738687509',
    });
    expect(quote).toMatchObject({ priceKind: 'index', price: 512.81 });
  });

  it('没有 indexPrice 时退到 markPrice', () => {
    const quote = normalizeBitgetTicker(perpInstrument, {
      lastPrice: '512.94',
      markPrice: '512.9',
      ts: '1',
    });
    expect(quote).toMatchObject({ priceKind: 'mark', price: 512.9 });
  });

  it('index / mark 都缺失时才用 last', () => {
    const quote = normalizeBitgetTicker(perpInstrument, { lastPrice: '512.94', ts: '1' });
    expect(quote).toMatchObject({ priceKind: 'last', price: 512.94 });
  });
});
