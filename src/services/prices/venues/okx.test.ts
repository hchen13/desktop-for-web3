import { describe, it, expect } from 'vitest';
import {
  buildOkxInstruments,
  collectOkxEquitySymbols,
  normalizeOkxIndexTicker,
  normalizeOkxSpotTicker,
  okxIndexInstId,
  okxIndexTickerUrl,
  okxTickerUrl,
  stripOkxTokenizedPrefix,
  type OkxRawCatalog,
} from './okx';
import { makeInstrument, type CatalogContext } from './shared';

function raw(partial: Partial<OkxRawCatalog>): OkxRawCatalog {
  return { spot: partial.spot ?? [], swap: partial.swap ?? [] };
}

const tokenized = (baseCcy: string, state = 'live') => ({
  instType: 'SPOT',
  instId: `${baseCcy}-USDT`,
  instCategory: '3',
  baseCcy,
  quoteCcy: 'USDT',
  state,
});

const ctx = (symbols: string[] = []): CatalogContext => ({
  confirmedEquitySymbols: new Set(symbols),
});

describe('OKX Unified Tokenized Stocks 解析', () => {
  it('XAAPL → AAPL', () => {
    const out = buildOkxInstruments(raw({ spot: [tokenized('XAAPL')] }), ctx());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      assetKey: 'stock:AAPL',
      instrumentId: 'XAAPL-USDT',
      productKind: 'tokenized_stock_spot',
      preferredPriceKind: 'last',
    });
  });

  it('XXLE → XLE，不能解析成 LE', () => {
    expect(stripOkxTokenizedPrefix('XXLE')).toBe('XLE');
    const out = buildOkxInstruments(raw({ spot: [tokenized('XXLE')] }), ctx());
    expect(out[0].symbol).toBe('XLE');
    expect(out[0].assetKey).toBe('etf:XLE');
  });

  it('XSPY / XQQQ 归类为 ETF', () => {
    const out = buildOkxInstruments(raw({ spot: [tokenized('XSPY'), tokenized('XQQQ')] }), ctx());
    expect(out.map((i) => i.assetKey).sort()).toEqual(['etf:QQQ', 'etf:SPY']);
  });

  it('instCategory 不是 3 时不算 tokenized stock', () => {
    const out = buildOkxInstruments(
      raw({
        spot: [
          {
            instType: 'SPOT',
            instId: 'XRP-USDT',
            instCategory: '1',
            baseCcy: 'XRP',
            quoteCcy: 'USDT',
            state: 'live',
          },
        ],
      }),
      ctx(),
    );
    expect(out[0]).toMatchObject({ assetKey: 'crypto:XRP', productKind: 'crypto_spot' });
  });

  it('baseCcy 不以 X 开头时不剥前缀', () => {
    expect(stripOkxTokenizedPrefix('AAPL')).toBeNull();
    expect(stripOkxTokenizedPrefix('X')).toBeNull();
    expect(stripOkxTokenizedPrefix(undefined)).toBeNull();
  });

  it('state 非 live 的 instrument 不进入 catalog', () => {
    const out = buildOkxInstruments(raw({ spot: [tokenized('XAAPL', 'suspend')] }), ctx());
    expect(out).toHaveLength(0);
  });
});

describe('OKX 股票永续', () => {
  const perp = (ctValCcy: string, extra: Record<string, unknown> = {}) => ({
    instType: 'SWAP',
    instId: `${ctValCcy}-USDT-SWAP`,
    instCategory: '3',
    ctValCcy,
    uly: `${ctValCcy}-USDT`,
    settleCcy: 'USDT',
    state: 'live',
    ...extra,
  });

  it('canonical 取官方 ctValCcy 而不是切字符串', () => {
    const out = buildOkxInstruments(raw({ swap: [perp('AAPL')] }), ctx(['AAPL']));
    expect(out[0]).toMatchObject({
      assetKey: 'stock:AAPL',
      instrumentId: 'AAPL-USDT-SWAP',
      productKind: 'equity_perp',
      preferredPriceKind: 'index',
    });
  });

  it('未被确认为股票的标的不收录（pre-IPO 名不会混进来）', () => {
    const out = buildOkxInstruments(
      raw({ swap: [perp('ANTHROPIC', { ruleType: 'pre_market' }), perp('OPENAI')] }),
      ctx(['AAPL']),
    );
    expect(out).toHaveLength(0);
  });

  it('pre_market 合约不参与股票确认集合', () => {
    const symbols = collectOkxEquitySymbols(
      raw({ swap: [perp('ANTHROPIC', { ruleType: 'pre_market' }), perp('AAPL')] }),
    );
    expect(symbols).toEqual(['AAPL']);
  });

  it('tokenized spot 也进入股票确认集合', () => {
    expect(collectOkxEquitySymbols(raw({ spot: [tokenized('XNVDA')] }))).toEqual(['NVDA']);
  });
});

describe('OKX targeted REST', () => {
  const spotInstrument = makeInstrument({
    venue: 'okx',
    instrumentId: 'XAAPL-USDT',
    symbol: 'AAPL',
    base: 'XAAPL',
    quote: 'USDT',
    category: 'stock',
    productKind: 'tokenized_stock_spot',
    preferredPriceKind: 'last',
  });

  const perpInstrument = makeInstrument({
    venue: 'okx',
    instrumentId: 'BRKB-USDT-SWAP',
    symbol: 'BRK.B',
    base: 'BRKB',
    quote: 'USDT',
    category: 'stock',
    productKind: 'equity_perp',
    preferredPriceKind: 'index',
  });

  it('ticker URL 必须带 instId', () => {
    expect(okxTickerUrl('XAAPL-USDT')).toContain('instId=XAAPL-USDT');
    expect(okxTickerUrl('XAAPL-USDT')).not.toContain('instType=SPOT');
  });

  it('永续走 index-tickers，instId 去掉 -SWAP 后缀', () => {
    expect(okxIndexInstId('BRKB-USDT-SWAP')).toBe('BRKB-USDT');
    expect(okxIndexTickerUrl('BRKB-USDT')).toContain('index-tickers?instId=BRKB-USDT');
  });

  it('spot ticker normalize 成 last 报价并按 open24h 算涨跌', () => {
    const quote = normalizeOkxSpotTicker(spotInstrument, {
      last: '309.44',
      open24h: '310.01',
      volCcy24h: '182878.5',
      ts: '1785739288088',
    });
    expect(quote).toMatchObject({
      assetKey: 'stock:AAPL',
      venue: 'okx',
      priceKind: 'last',
      price: 309.44,
      quoteCurrency: 'USDT',
      sourceTimestamp: 1785739288088,
    });
    expect(quote!.change24h).toBeCloseTo((309.44 / 310.01 - 1) * 100, 6);
  });

  it('index ticker normalize 成 index 报价', () => {
    const quote = normalizeOkxIndexTicker(perpInstrument, {
      idxPx: '512.81',
      open24h: '512.24',
      ts: '1785739288088',
    });
    expect(quote).toMatchObject({ priceKind: 'index', price: 512.81, assetKey: 'stock:BRK.B' });
    expect(quote!.volume24h).toBeNull();
  });

  it('非法价格返回 null', () => {
    expect(normalizeOkxSpotTicker(spotInstrument, { last: '0' })).toBeNull();
    expect(normalizeOkxSpotTicker(spotInstrument, { last: 'oops' })).toBeNull();
  });
});
