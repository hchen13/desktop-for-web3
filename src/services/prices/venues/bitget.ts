/**
 * Bitget 公开行情适配器（UTA v3）
 *
 * Catalog: /api/v3/market/instruments?category=SPOT | USDT-FUTURES
 * Quote:   /api/v3/market/tickers?category=…&symbol=…（每次必须带 symbol）
 *
 * Reality 代币化股票现货判定：category=SPOT + status=online + symbolType=stock
 * + isReality=yes + baseCoin 以 r 开头；全部满足后才剥掉 r（rXYZ → XYZ）。
 * Reality 的 orderbook / 交易接口需要白名单，本项目只用公开 ticker。
 */

import type { AssetCategory, VenueInstrument, VenueQuote } from '../types';
import type { SocketEndpoint } from '../socket';
import {
  bestQuoteIsTradable,
  CATALOG_TIMEOUT_MS,
  canonicalSymbolFor,
  CRYPTO_QUOTE_CURRENCIES,
  equityCategoryFor,
  eqi,
  fetchJson,
  makeInstrument,
  makeQuote,
  RECOGNIZED_COMMODITY_SYMBOLS,
  settleAll,
  toNumber,
  type CatalogContext,
} from './shared';

const REST_BASE = 'https://api.bitget.com';
export const BITGET_WS_URL = 'wss://ws.bitget.com/v3/ws/public';

export const BITGET_SPOT_CATEGORY = 'SPOT';
export const BITGET_FUTURES_CATEGORY = 'USDT-FUTURES';

interface BitgetInstrument {
  symbol?: string;
  category?: string;
  baseCoin?: string;
  quoteCoin?: string;
  symbolType?: string;
  status?: string;
  isReality?: string;
  isRwa?: string;
  type?: string;
}

interface BitgetResponse<T> {
  code: string;
  msg?: string;
  data?: T[];
}

export interface BitgetRawCatalog {
  spot: BitgetInstrument[];
  futures: BitgetInstrument[];
}

export async function fetchBitgetRawCatalog(): Promise<BitgetRawCatalog> {
  const [spot, futures] = await Promise.all([
    fetchInstruments(BITGET_SPOT_CATEGORY),
    fetchInstruments(BITGET_FUTURES_CATEGORY),
  ]);
  return { spot, futures };
}

async function fetchInstruments(category: string): Promise<BitgetInstrument[]> {
  const json = await fetchJson<BitgetResponse<BitgetInstrument>>(
    `${REST_BASE}/api/v3/market/instruments?category=${encodeURIComponent(category)}`,
    { timeoutMs: CATALOG_TIMEOUT_MS },
  );
  if (json.code !== '00000') throw new Error(`Bitget instruments ${category} code ${json.code}`);
  return Array.isArray(json.data) ? json.data : [];
}

/** 剥离 Reality 的 r 前缀；前置条件不满足时返回 null */
export function stripBitgetRealityPrefix(baseCoin: string | undefined): string | null {
  if (!baseCoin || baseCoin.length < 2) return null;
  if (baseCoin[0] !== 'r' && baseCoin[0] !== 'R') return null;
  return baseCoin.slice(1).toUpperCase();
}

export function isBitgetRealityStockSpot(inst: BitgetInstrument): boolean {
  return (
    eqi(inst.category, BITGET_SPOT_CATEGORY) &&
    eqi(inst.status, 'online') &&
    eqi(inst.symbolType, 'stock') &&
    eqi(inst.isReality, 'yes') &&
    !!stripBitgetRealityPrefix(inst.baseCoin)
  );
}

export function isBitgetEquityPerp(inst: BitgetInstrument): boolean {
  return (
    eqi(inst.category, BITGET_FUTURES_CATEGORY) &&
    eqi(inst.status, 'online') &&
    eqi(inst.symbolType, 'stock') &&
    eqi(inst.isRwa, 'yes') &&
    eqi(inst.type, 'perpetual')
  );
}

export function isBitgetCommodityPerp(inst: BitgetInstrument): boolean {
  return (
    eqi(inst.category, BITGET_FUTURES_CATEGORY) &&
    eqi(inst.status, 'online') &&
    (eqi(inst.symbolType, 'metal') || eqi(inst.symbolType, 'commodity')) &&
    eqi(inst.isRwa, 'yes') &&
    eqi(inst.type, 'perpetual') &&
    RECOGNIZED_COMMODITY_SYMBOLS.has((inst.baseCoin ?? '').toUpperCase())
  );
}

export function collectBitgetEquitySymbols(raw: BitgetRawCatalog): string[] {
  const out: string[] = [];
  for (const inst of raw.spot) {
    if (!isBitgetRealityStockSpot(inst)) continue;
    const stripped = stripBitgetRealityPrefix(inst.baseCoin);
    if (stripped) out.push(stripped);
  }
  for (const inst of raw.futures) {
    if (!isBitgetEquityPerp(inst)) continue;
    if (inst.baseCoin) out.push(inst.baseCoin.toUpperCase());
  }
  return out;
}

export function buildBitgetInstruments(
  raw: BitgetRawCatalog,
  ctx: CatalogContext,
): VenueInstrument[] {
  const out: VenueInstrument[] = [];

  for (const inst of raw.spot) {
    if (!inst.symbol || !eqi(inst.status, 'online')) continue;

    if (isBitgetRealityStockSpot(inst)) {
      const stripped = stripBitgetRealityPrefix(inst.baseCoin)!;
      const category = equityCategoryFor(stripped);
      out.push(
        makeInstrument({
          venue: 'bitget',
          instrumentId: inst.symbol,
          symbol: canonicalSymbolFor(category, stripped),
          base: inst.baseCoin ?? stripped,
          quote: inst.quoteCoin ?? 'USDT',
          category,
          productKind: 'tokenized_stock_spot',
          preferredPriceKind: 'last',
        }),
      );
      continue;
    }

    if (
      !eqi(inst.symbolType, 'crypto') ||
      !inst.baseCoin ||
      !CRYPTO_QUOTE_CURRENCIES.has((inst.quoteCoin ?? '').toUpperCase())
    ) {
      continue;
    }
    out.push(
      makeInstrument({
        venue: 'bitget',
        instrumentId: inst.symbol,
        symbol: inst.baseCoin,
        base: inst.baseCoin,
        quote: inst.quoteCoin!,
        category: 'crypto',
        productKind: 'crypto_spot',
        preferredPriceKind: 'last',
      }),
    );
  }

  for (const inst of raw.futures) {
    if (!inst.symbol || !inst.baseCoin) continue;

    if (isBitgetCommodityPerp(inst)) {
      const base = inst.baseCoin.toUpperCase();
      out.push(
        makeInstrument({
          venue: 'bitget',
          instrumentId: inst.symbol,
          symbol: canonicalSymbolFor('commodity', base),
          base,
          quote: inst.quoteCoin ?? 'USDT',
          category: 'commodity',
          productKind: 'commodity_perp',
          preferredPriceKind: 'index',
        }),
      );
      continue;
    }

    if (!isBitgetEquityPerp(inst)) continue;
    const base = inst.baseCoin.toUpperCase();
    if (!ctx.confirmedEquitySymbols.has(base)) continue;
    const canonical = canonicalSymbolFor('stock', base);
    const category: AssetCategory = equityCategoryFor(canonical);
    out.push(
      makeInstrument({
        venue: 'bitget',
        instrumentId: inst.symbol,
        symbol: canonicalSymbolFor(category, base),
        base,
        quote: inst.quoteCoin ?? 'USDT',
        category,
        productKind: 'equity_perp',
        preferredPriceKind: 'index',
      }),
    );
  }

  return out;
}

// ============ Targeted REST ============

interface BitgetTicker {
  symbol?: string;
  lastPrice?: string;
  openPrice24h?: string;
  price24hPcnt?: string;
  turnover24h?: string;
  indexPrice?: string;
  markPrice?: string;
  ts?: string;
  bid1Price?: string;
  ask1Price?: string;
}

export function bitgetCategoryFor(instrument: VenueInstrument): string {
  return instrument.productKind === 'crypto_spot' ||
    instrument.productKind === 'tokenized_stock_spot'
    ? BITGET_SPOT_CATEGORY
    : BITGET_FUTURES_CATEGORY;
}

export function bitgetTickerUrl(category: string, symbol: string): string {
  return `${REST_BASE}/api/v3/market/tickers?category=${encodeURIComponent(
    category,
  )}&symbol=${encodeURIComponent(symbol)}`;
}

export function normalizeBitgetTicker(
  instrument: VenueInstrument,
  raw: BitgetTicker,
): VenueQuote | null {
  const pct = toNumber(raw.price24hPcnt);
  const change24h = Number.isFinite(pct) ? pct * 100 : null;
  const ts = toNumber(raw.ts);
  const tradable = bestQuoteIsTradable(toNumber(raw.bid1Price), toNumber(raw.ask1Price));

  if (instrument.productKind === 'equity_perp' || instrument.productKind === 'commodity_perp') {
    const index = toNumber(raw.indexPrice);
    if (Number.isFinite(index) && index > 0) {
      return makeQuote(instrument, {
        price: index,
        priceKind: 'index',
        change24h,
        volume24h: null,
        sourceTimestamp: ts,
        tradable,
      });
    }
    const mark = toNumber(raw.markPrice);
    if (Number.isFinite(mark) && mark > 0) {
      return makeQuote(instrument, {
        price: mark,
        priceKind: 'mark',
        change24h,
        volume24h: null,
        sourceTimestamp: ts,
        tradable,
      });
    }
  }

  return makeQuote(instrument, {
    price: toNumber(raw.lastPrice),
    priceKind: 'last',
    change24h,
    volume24h: toNumber(raw.turnover24h),
    sourceTimestamp: ts,
    tradable,
  });
}

export async function fetchBitgetQuotes(instruments: VenueInstrument[]): Promise<VenueQuote[]> {
  return settleAll(
    instruments.map(async (instrument) => {
      const json = await fetchJson<BitgetResponse<BitgetTicker>>(
        bitgetTickerUrl(bitgetCategoryFor(instrument), instrument.instrumentId),
      );
      const row = json.data?.[0];
      return row ? normalizeBitgetTicker(instrument, row) : null;
    }),
  );
}

// ============ WebSocket ============

/** WS 的 instType 用小写，与 REST 的 category 不是同一套写法 */
export function bitgetWsInstType(instrument: VenueInstrument): string {
  return bitgetCategoryFor(instrument) === BITGET_SPOT_CATEGORY ? 'spot' : 'usdt-futures';
}

function subscriptionArg(instrument: VenueInstrument) {
  return {
    instType: bitgetWsInstType(instrument),
    topic: 'ticker',
    symbol: instrument.instrumentId,
  };
}

export const bitgetSocketEndpoint: SocketEndpoint = {
  key: 'bitget',
  venue: 'bitget',
  url: BITGET_WS_URL,
  supports: () => true,
  buildSubscribe: (instruments) => [{ op: 'subscribe', args: instruments.map(subscriptionArg) }],
  buildUnsubscribe: (instruments) => [
    { op: 'unsubscribe', args: instruments.map(subscriptionArg) },
  ],
  parseMessage: (data, instruments) => {
    if (!data || data[0] !== '{') return [];
    const json = JSON.parse(data) as {
      event?: string;
      arg?: { instType?: string; topic?: string; symbol?: string };
      data?: BitgetTicker[];
      ts?: number;
    };
    if (json.event || json.arg?.topic !== 'ticker' || !Array.isArray(json.data)) return [];
    const symbol = json.arg.symbol;
    const instType = json.arg.instType;
    const out: VenueQuote[] = [];
    for (const instrument of instruments) {
      if (instrument.instrumentId !== symbol) continue;
      if (bitgetWsInstType(instrument) !== instType) continue;
      for (const row of json.data) {
        const quote = normalizeBitgetTicker(instrument, { ts: String(json.ts ?? ''), ...row });
        if (quote) out.push(quote);
      }
    }
    return out;
  },
  heartbeat: { intervalMs: 25_000, payload: () => 'ping' },
};
