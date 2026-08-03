/**
 * Binance 公开行情适配器
 *
 * Catalog: data-api.binance.vision /api/v3/exchangeInfo（Spot）
 *          fapi.binance.com /fapi/v1/exchangeInfo（Futures）
 * Quote:   /api/v3/ticker/24hr?symbols=[…]（selected-symbol batch）
 *          /fapi/v1/premiumIndex?symbol=…、/fapi/v1/ticker/24hr?symbol=…（单 symbol）
 *
 * Spot exchangeInfo 没有可靠的 productType=bStock 字段，所以不能把所有 baseAsset 以 B
 * 结尾的对当成股票（BNB / SHIB / ARB / TRB / CKB 都会误伤）。这里采用保守确认：
 * 只有当剥掉尾部 B 的 canonical 已被 curated 或 OKX / Bitget 的明确股票产品 metadata
 * 确认过，并且 instrumentId 恰好等于 `${canonical}B${quote}` 时才收录。
 */

import type { VenueInstrument, VenueQuote } from '../types';
import {
  CATALOG_TIMEOUT_MS,
  canonicalSymbolFor,
  equityCategoryFor,
  fetchJson,
  makeInstrument,
  makeQuote,
  RECOGNIZED_COMMODITY_SYMBOLS,
  settleAll,
  SUPPORTED_QUOTE_CURRENCIES,
  toNumber,
  type CatalogContext,
} from './shared';

const SPOT_REST_BASE = 'https://data-api.binance.vision';
const FUTURES_REST_BASE = 'https://fapi.binance.com';
export const BINANCE_SPOT_WS_URL = 'wss://stream.binance.com:9443/ws';
export const BINANCE_FUTURES_WS_URL = 'wss://fstream.binance.com/ws';

const TRADFI_CONTRACT_TYPE = 'TRADIFI_PERPETUAL';
/** 明确的股票类 underlyingType；KR/HK/PREMARKET 不纳入本项目的美股资产模型 */
const EQUITY_UNDERLYING_TYPES = new Set(['EQUITY']);

interface BinanceSpotSymbol {
  symbol?: string;
  status?: string;
  baseAsset?: string;
  quoteAsset?: string;
}

interface BinanceFuturesSymbol {
  symbol?: string;
  status?: string;
  baseAsset?: string;
  quoteAsset?: string;
  contractType?: string;
  underlyingType?: string;
}

export interface BinanceRawCatalog {
  spot: BinanceSpotSymbol[];
  futures: BinanceFuturesSymbol[];
}

export async function fetchBinanceRawCatalog(): Promise<BinanceRawCatalog> {
  const [spot, futures] = await Promise.all([
    fetchJson<{ symbols?: BinanceSpotSymbol[] }>(`${SPOT_REST_BASE}/api/v3/exchangeInfo`, {
      timeoutMs: CATALOG_TIMEOUT_MS,
    }).then((j) => (Array.isArray(j.symbols) ? j.symbols : [])),
    fetchJson<{ symbols?: BinanceFuturesSymbol[] }>(`${FUTURES_REST_BASE}/fapi/v1/exchangeInfo`, {
      timeoutMs: CATALOG_TIMEOUT_MS,
    }).then((j) => (Array.isArray(j.symbols) ? j.symbols : [])),
  ]);
  return { spot, futures };
}

export function isBinanceEquityPerp(sym: BinanceFuturesSymbol): boolean {
  return (
    sym.contractType === TRADFI_CONTRACT_TYPE &&
    sym.status === 'TRADING' &&
    EQUITY_UNDERLYING_TYPES.has(sym.underlyingType ?? '')
  );
}

export function isBinanceCommodityPerp(sym: BinanceFuturesSymbol): boolean {
  return (
    sym.contractType === TRADFI_CONTRACT_TYPE &&
    sym.status === 'TRADING' &&
    sym.underlyingType === 'COMMODITY' &&
    RECOGNIZED_COMMODITY_SYMBOLS.has((sym.baseAsset ?? '').toUpperCase())
  );
}

export function collectBinanceEquitySymbols(raw: BinanceRawCatalog): string[] {
  const out: string[] = [];
  for (const sym of raw.futures) {
    if (isBinanceEquityPerp(sym) && sym.baseAsset) out.push(sym.baseAsset.toUpperCase());
  }
  return out;
}

/**
 * 判断一条 Spot 记录是否是已确认的 bStock，返回 canonical symbol；否则 null。
 * 导出供测试直接覆盖「普通以 B 结尾的 crypto 不被误判」。
 */
export function resolveBinanceStockSymbol(
  sym: BinanceSpotSymbol,
  confirmedEquitySymbols: Set<string>,
): string | null {
  if (sym.status !== 'TRADING' || !sym.symbol || !sym.baseAsset || !sym.quoteAsset) return null;
  const quote = sym.quoteAsset.toUpperCase();
  if (!SUPPORTED_QUOTE_CURRENCIES.has(quote)) return null;
  const base = sym.baseAsset.toUpperCase();
  if (base.length < 2 || !base.endsWith('B')) return null;
  const canonical = base.slice(0, -1);
  if (!confirmedEquitySymbols.has(canonical)) return null;
  if (sym.symbol.toUpperCase() !== `${canonical}B${quote}`) return null;
  return canonical;
}

export function buildBinanceInstruments(
  raw: BinanceRawCatalog,
  ctx: CatalogContext,
): VenueInstrument[] {
  const out: VenueInstrument[] = [];

  for (const sym of raw.spot) {
    if (sym.status !== 'TRADING' || !sym.symbol || !sym.baseAsset || !sym.quoteAsset) continue;

    const stockSymbol = resolveBinanceStockSymbol(sym, ctx.confirmedEquitySymbols);
    if (stockSymbol) {
      const category = equityCategoryFor(stockSymbol);
      out.push(
        makeInstrument({
          venue: 'binance',
          instrumentId: sym.symbol,
          symbol: canonicalSymbolFor(category, stockSymbol),
          base: sym.baseAsset,
          quote: sym.quoteAsset,
          category,
          productKind: 'tokenized_stock_spot',
          preferredPriceKind: 'last',
        }),
      );
      continue;
    }

    if (sym.quoteAsset.toUpperCase() !== 'USDT') continue;
    out.push(
      makeInstrument({
        venue: 'binance',
        instrumentId: sym.symbol,
        symbol: sym.baseAsset,
        base: sym.baseAsset,
        quote: sym.quoteAsset,
        category: 'crypto',
        productKind: 'crypto_spot',
        preferredPriceKind: 'last',
      }),
    );
  }

  for (const sym of raw.futures) {
    if (!sym.symbol || !sym.baseAsset) continue;

    if (isBinanceCommodityPerp(sym)) {
      const base = sym.baseAsset.toUpperCase();
      out.push(
        makeInstrument({
          venue: 'binance',
          instrumentId: sym.symbol,
          symbol: canonicalSymbolFor('commodity', base),
          base,
          quote: sym.quoteAsset ?? 'USDT',
          category: 'commodity',
          productKind: 'commodity_perp',
          preferredPriceKind: 'index',
        }),
      );
      continue;
    }

    if (!isBinanceEquityPerp(sym)) continue;
    const base = sym.baseAsset.toUpperCase();
    if (!ctx.confirmedEquitySymbols.has(base)) continue;
    const canonical = canonicalSymbolFor('stock', base);
    const category = equityCategoryFor(canonical);
    out.push(
      makeInstrument({
        venue: 'binance',
        instrumentId: sym.symbol,
        symbol: canonicalSymbolFor(category, base),
        base,
        quote: sym.quoteAsset ?? 'USDT',
        category,
        productKind: 'equity_perp',
        preferredPriceKind: 'index',
      }),
    );
  }

  return out;
}

// ============ Targeted REST ============

interface BinanceSpotTicker {
  symbol?: string;
  lastPrice?: string;
  priceChangePercent?: string;
  quoteVolume?: string;
  closeTime?: number;
}

interface BinancePremiumIndex {
  symbol?: string;
  markPrice?: string;
  indexPrice?: string;
  time?: number;
}

export function binanceSpotTickerUrl(symbols: string[]): string {
  const payload = JSON.stringify(symbols);
  return `${SPOT_REST_BASE}/api/v3/ticker/24hr?symbols=${encodeURIComponent(payload)}`;
}

export function binanceFuturesTickerUrl(symbol: string): string {
  return `${FUTURES_REST_BASE}/fapi/v1/ticker/24hr?symbol=${encodeURIComponent(symbol)}`;
}

export function binancePremiumIndexUrl(symbol: string): string {
  return `${FUTURES_REST_BASE}/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`;
}

export function normalizeBinanceSpotTicker(
  instrument: VenueInstrument,
  raw: BinanceSpotTicker,
): VenueQuote | null {
  return makeQuote(instrument, {
    price: toNumber(raw.lastPrice),
    priceKind: 'last',
    change24h: toNumber(raw.priceChangePercent),
    volume24h: toNumber(raw.quoteVolume),
    sourceTimestamp: toNumber(raw.closeTime),
  });
}

export function normalizeBinanceFuturesQuote(
  instrument: VenueInstrument,
  premium: BinancePremiumIndex,
  ticker: BinanceSpotTicker | null,
): VenueQuote | null {
  const index = toNumber(premium.indexPrice);
  const mark = toNumber(premium.markPrice);
  const usesIndex = Number.isFinite(index) && index > 0;
  return makeQuote(instrument, {
    price: usesIndex ? index : mark,
    priceKind: usesIndex ? 'index' : 'mark',
    change24h: ticker ? toNumber(ticker.priceChangePercent) : null,
    volume24h: ticker ? toNumber(ticker.quoteVolume) : null,
    sourceTimestamp: toNumber(premium.time),
  });
}

export async function fetchBinanceQuotes(instruments: VenueInstrument[]): Promise<VenueQuote[]> {
  const spot = instruments.filter(
    (i) => i.productKind === 'crypto_spot' || i.productKind === 'tokenized_stock_spot',
  );
  const perps = instruments.filter((i) => !spot.includes(i));

  const tasks: Array<Promise<VenueQuote[] | null>> = [];

  if (spot.length > 0) {
    tasks.push(
      (async () => {
        const rows = await fetchJson<BinanceSpotTicker[]>(
          binanceSpotTickerUrl(spot.map((i) => i.instrumentId)),
        );
        const byId = new Map(spot.map((i) => [i.instrumentId, i]));
        const out: VenueQuote[] = [];
        for (const row of Array.isArray(rows) ? rows : []) {
          const instrument = row.symbol ? byId.get(row.symbol) : undefined;
          if (!instrument) continue;
          const quote = normalizeBinanceSpotTicker(instrument, row);
          if (quote) out.push(quote);
        }
        return out;
      })(),
    );
  }

  for (const instrument of perps) {
    tasks.push(
      (async () => {
        const [premium, ticker] = await Promise.all([
          fetchJson<BinancePremiumIndex>(binancePremiumIndexUrl(instrument.instrumentId)),
          fetchJson<BinanceSpotTicker>(binanceFuturesTickerUrl(instrument.instrumentId)).catch(
            () => null,
          ),
        ]);
        const quote = normalizeBinanceFuturesQuote(instrument, premium, ticker);
        return quote ? [quote] : [];
      })(),
    );
  }

  const settled = await settleAll(tasks);
  return settled.flat();
}
