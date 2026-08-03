import { describe, it, expect } from 'vitest';
import {
  binanceFuturesTickerUrl,
  binancePremiumIndexUrl,
  binanceSpotTickerUrl,
  buildBinanceInstruments,
  collectBinanceEquitySymbols,
  normalizeBinanceFuturesQuote,
  normalizeBinanceSpotTicker,
  resolveBinanceStockSymbol,
  type BinanceRawCatalog,
} from './binance';
import { makeInstrument, type CatalogContext } from './shared';

function raw(partial: Partial<BinanceRawCatalog>): BinanceRawCatalog {
  return { spot: partial.spot ?? [], futures: partial.futures ?? [] };
}

const spotSymbol = (baseAsset: string, quoteAsset = 'USDT', status = 'TRADING') => ({
  symbol: `${baseAsset}${quoteAsset}`,
  baseAsset,
  quoteAsset,
  status,
});

const tradfiPerp = (baseAsset: string, underlyingType = 'EQUITY', status = 'TRADING') => ({
  symbol: `${baseAsset}USDT`,
  baseAsset,
  quoteAsset: 'USDT',
  status,
  contractType: 'TRADIFI_PERPETUAL',
  underlyingType,
});

const ctx = (symbols: string[] = []): CatalogContext => ({
  confirmedEquitySymbols: new Set(symbols),
});

describe('Binance bStocks 保守确认', () => {
  const confirmed = ctx(['NVDA', 'AAPL', 'SPY', 'MU', 'BRKB']);

  it('已确认的股票 canonical 才收录', () => {
    const out = buildBinanceInstruments(
      raw({ spot: [spotSymbol('NVDAB'), spotSymbol('AAPLB'), spotSymbol('SPYB')] }),
      confirmed,
    );
    expect(out.map((i) => i.assetKey).sort()).toEqual(['etf:SPY', 'stock:AAPL', 'stock:NVDA']);
    expect(out.every((i) => i.productKind === 'tokenized_stock_spot')).toBe(true);
  });

  it.each(['BNB', 'SHIB', 'ARB', 'TRB', 'CKB', 'DGB', 'BB', 'YB'])(
    '普通以 B 结尾的 crypto %s 不被误判成 bStock',
    (base) => {
      expect(
        resolveBinanceStockSymbol(spotSymbol(base), confirmed.confirmedEquitySymbols),
      ).toBeNull();
      const out = buildBinanceInstruments(raw({ spot: [spotSymbol(base)] }), confirmed);
      expect(out[0]).toMatchObject({ assetKey: `crypto:${base}`, productKind: 'crypto_spot' });
    },
  );

  it('未被任何交易所 metadata 确认的 symbol 不加入股票 catalog', () => {
    expect(
      resolveBinanceStockSymbol(spotSymbol('FOOB'), confirmed.confirmedEquitySymbols),
    ).toBeNull();
  });

  it('instrumentId 与 bStock 命名不一致时拒绝', () => {
    const weird = {
      symbol: 'NVDA-BUSDT',
      baseAsset: 'NVDAB',
      quoteAsset: 'USDT',
      status: 'TRADING',
    };
    expect(resolveBinanceStockSymbol(weird, confirmed.confirmedEquitySymbols)).toBeNull();
  });

  it('非 TRADING 状态不收录', () => {
    expect(
      resolveBinanceStockSymbol(
        spotSymbol('NVDAB', 'USDT', 'BREAK'),
        confirmed.confirmedEquitySymbols,
      ),
    ).toBeNull();
  });

  it('不支持的计价货币不收录', () => {
    expect(
      resolveBinanceStockSymbol(spotSymbol('NVDAB', 'TRY'), confirmed.confirmedEquitySymbols),
    ).toBeNull();
  });

  it('MU 的 bStock 是 MUB，不会被当成同名 crypto', () => {
    expect(resolveBinanceStockSymbol(spotSymbol('MUB'), confirmed.confirmedEquitySymbols)).toBe(
      'MU',
    );
  });
});

describe('Binance TradFi 永续', () => {
  it('只接受 contractType=TRADIFI_PERPETUAL 且 underlyingType=EQUITY', () => {
    const out = buildBinanceInstruments(
      raw({
        futures: [
          tradfiPerp('BRKB'),
          tradfiPerp('HK0700', 'HK_EQUITY'),
          tradfiPerp('OPENAI', 'PREMARKET'),
        ],
      }),
      ctx(['BRKB']),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      assetKey: 'stock:BRK.B',
      symbol: 'BRK.B',
      instrumentId: 'BRKBUSDT',
      productKind: 'equity_perp',
    });
  });

  it('普通 crypto 永续不会被纳入股票价格', () => {
    const out = buildBinanceInstruments(
      raw({
        futures: [
          {
            symbol: 'BTCUSDT',
            baseAsset: 'BTC',
            quoteAsset: 'USDT',
            status: 'TRADING',
            contractType: 'PERPETUAL',
            underlyingType: 'COIN',
          },
        ],
      }),
      ctx(['BTC']),
    );
    expect(out).toHaveLength(0);
  });

  it('白名单内的商品永续按 commodity_perp 收录', () => {
    const out = buildBinanceInstruments(raw({ futures: [tradfiPerp('XAU', 'COMMODITY')] }), ctx());
    expect(out[0]).toMatchObject({ assetKey: 'commodity:XAU', productKind: 'commodity_perp' });
  });

  it('BZ / CL 映射回 canonical BRENT / WTI', () => {
    const out = buildBinanceInstruments(
      raw({ futures: [tradfiPerp('BZ', 'COMMODITY'), tradfiPerp('CL', 'COMMODITY')] }),
      ctx(),
    );
    expect(out.map((i) => i.assetKey).sort()).toEqual(['commodity:BRENT', 'commodity:WTI']);
  });

  it('EQUITY 永续贡献股票确认集合', () => {
    expect(
      collectBinanceEquitySymbols(
        raw({ futures: [tradfiPerp('BRKB'), tradfiPerp('XAU', 'COMMODITY')] }),
      ),
    ).toEqual(['BRKB']);
  });
});

describe('Binance targeted REST', () => {
  const spot = makeInstrument({
    venue: 'binance',
    instrumentId: 'NVDABUSDT',
    symbol: 'NVDA',
    base: 'NVDAB',
    quote: 'USDT',
    category: 'stock',
    productKind: 'tokenized_stock_spot',
    preferredPriceKind: 'last',
  });

  const perp = makeInstrument({
    venue: 'binance',
    instrumentId: 'BRKBUSDT',
    symbol: 'BRK.B',
    base: 'BRKB',
    quote: 'USDT',
    category: 'stock',
    productKind: 'equity_perp',
    preferredPriceKind: 'index',
  });

  it('现货 URL 是 selected-symbol batch，不是全市场', () => {
    const url = binanceSpotTickerUrl(['NVDABUSDT', 'BTCUSDT']);
    expect(url).toContain('symbols=');
    expect(decodeURIComponent(url)).toContain('["NVDABUSDT","BTCUSDT"]');
    expect(url).toContain('/api/v3/ticker/24hr');
  });

  it('永续 index / mark 使用单 symbol endpoint', () => {
    expect(binancePremiumIndexUrl('BRKBUSDT')).toContain('premiumIndex?symbol=BRKBUSDT');
    expect(binanceFuturesTickerUrl('BRKBUSDT')).toContain('ticker/24hr?symbol=BRKBUSDT');
  });

  it('现货 normalize 直接取 priceChangePercent', () => {
    const quote = normalizeBinanceSpotTicker(spot, {
      symbol: 'NVDABUSDT',
      lastPrice: '202.17',
      priceChangePercent: '0.908',
      quoteVolume: '1902612.3',
      closeTime: 1785738624600,
    });
    expect(quote).toMatchObject({
      assetKey: 'stock:NVDA',
      priceKind: 'last',
      price: 202.17,
      change24h: 0.908,
      sourceTimestamp: 1785738624600,
    });
  });

  it('永续优先 indexPrice，change/volume 取自同一 instrument 的 24h ticker', () => {
    const quote = normalizeBinanceFuturesQuote(
      perp,
      { indexPrice: '513.2', markPrice: '513.01', time: 1785738688143 },
      { priceChangePercent: '0.078', quoteVolume: '208772.8' },
    );
    expect(quote).toMatchObject({ priceKind: 'index', price: 513.2, change24h: 0.078 });
  });

  it('没有 indexPrice 时退到 markPrice', () => {
    const quote = normalizeBinanceFuturesQuote(perp, { markPrice: '513.01', time: 1 }, null);
    expect(quote).toMatchObject({ priceKind: 'mark', price: 513.01, change24h: null });
  });
});
