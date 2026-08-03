/**
 * OKX 公开行情适配器
 *
 * Catalog: /api/v5/public/instruments（SPOT + SWAP），只读 metadata，不拉全市场 ticker。
 * Quote:   /api/v5/market/ticker?instId=…（单 instrument）
 *          /api/v5/market/index-tickers?instId=…（股票永续走官方指数，不用 last 冒充 index）
 *
 * Unified Tokenized Stocks 的判定条件是 instType=SPOT + instCategory='3' + state='live'
 * + baseCcy 以 X 开头；四个条件全满足才允许剥掉第一个 X（XXLE → XLE，不是 LE）。
 */

import type { VenueInstrument, VenueQuote } from '../types';
import {
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

const REST_BASE = 'https://www.okx.com';
export const OKX_WS_URL = 'wss://ws.okx.com:8443/ws/v5/public';

/** OKX instCategory='3' 标记 RWA / 股票关联产品 */
const EQUITY_INST_CATEGORY = '3';

interface OkxInstrument {
  instType?: string;
  instId?: string;
  instCategory?: string;
  baseCcy?: string;
  quoteCcy?: string;
  settleCcy?: string;
  ctValCcy?: string;
  uly?: string;
  ruleType?: string;
  state?: string;
}

interface OkxResponse<T> {
  code: string;
  msg?: string;
  data?: T[];
}

export interface OkxRawCatalog {
  spot: OkxInstrument[];
  swap: OkxInstrument[];
}

export async function fetchOkxRawCatalog(): Promise<OkxRawCatalog> {
  const [spot, swap] = await Promise.all([
    fetchInstruments('SPOT'),
    fetchInstruments('SWAP'),
  ]);
  return { spot, swap };
}

async function fetchInstruments(instType: 'SPOT' | 'SWAP'): Promise<OkxInstrument[]> {
  const json = await fetchJson<OkxResponse<OkxInstrument>>(
    `${REST_BASE}/api/v5/public/instruments?instType=${instType}`,
    { timeoutMs: CATALOG_TIMEOUT_MS },
  );
  if (json.code !== '0') throw new Error(`OKX instruments ${instType} code ${json.code}`);
  return Array.isArray(json.data) ? json.data : [];
}

/** 剥离 tokenized stock 的 X 前缀；前置条件不满足时返回 null */
export function stripOkxTokenizedPrefix(baseCcy: string | undefined): string | null {
  if (!baseCcy) return null;
  const upper = baseCcy.toUpperCase();
  if (!upper.startsWith('X') || upper.length < 2) return null;
  return upper.slice(1);
}

export function isOkxTokenizedStockSpot(inst: OkxInstrument): boolean {
  return (
    eqi(inst.instType, 'SPOT') &&
    inst.instCategory === EQUITY_INST_CATEGORY &&
    eqi(inst.state, 'live') &&
    !!stripOkxTokenizedPrefix(inst.baseCcy)
  );
}

export function isOkxEquityPerp(inst: OkxInstrument): boolean {
  return (
    eqi(inst.instType, 'SWAP') &&
    inst.instCategory === EQUITY_INST_CATEGORY &&
    eqi(inst.state, 'live') &&
    inst.ruleType !== 'pre_market'
  );
}

/** OKX 永续的标的 canonical 来自官方 ctValCcy，退化时才用 uly 前半段 */
export function okxPerpUnderlying(inst: OkxInstrument): string | null {
  const ctVal = inst.ctValCcy?.toUpperCase();
  if (ctVal) return ctVal;
  const uly = inst.uly?.toUpperCase();
  if (uly && uly.includes('-')) return uly.split('-')[0];
  return null;
}

export function collectOkxEquitySymbols(raw: OkxRawCatalog): string[] {
  const out: string[] = [];
  for (const inst of raw.spot) {
    if (!isOkxTokenizedStockSpot(inst)) continue;
    const stripped = stripOkxTokenizedPrefix(inst.baseCcy);
    if (stripped) out.push(stripped);
  }
  for (const inst of raw.swap) {
    if (!isOkxEquityPerp(inst)) continue;
    const underlying = okxPerpUnderlying(inst);
    if (underlying) out.push(underlying);
  }
  return out;
}

export function buildOkxInstruments(raw: OkxRawCatalog, ctx: CatalogContext): VenueInstrument[] {
  const out: VenueInstrument[] = [];

  for (const inst of raw.spot) {
    if (!inst.instId || !eqi(inst.state, 'live')) continue;

    if (isOkxTokenizedStockSpot(inst)) {
      const stripped = stripOkxTokenizedPrefix(inst.baseCcy)!;
      const category = equityCategoryFor(stripped);
      out.push(
        makeInstrument({
          venue: 'okx',
          instrumentId: inst.instId,
          symbol: canonicalSymbolFor(category, stripped),
          base: inst.baseCcy ?? stripped,
          quote: inst.quoteCcy ?? 'USDT',
          category,
          productKind: 'tokenized_stock_spot',
          preferredPriceKind: 'last',
        }),
      );
      continue;
    }

    if (
      inst.instCategory === EQUITY_INST_CATEGORY ||
      !inst.baseCcy ||
      !CRYPTO_QUOTE_CURRENCIES.has((inst.quoteCcy ?? '').toUpperCase())
    ) {
      continue;
    }
    out.push(
      makeInstrument({
        venue: 'okx',
        instrumentId: inst.instId,
        symbol: inst.baseCcy,
        base: inst.baseCcy,
        quote: inst.quoteCcy!,
        category: 'crypto',
        productKind: 'crypto_spot',
        preferredPriceKind: 'last',
      }),
    );
  }

  for (const inst of raw.swap) {
    if (!inst.instId || !isOkxEquityPerp(inst)) continue;
    const underlying = okxPerpUnderlying(inst);
    if (!underlying) continue;

    if (RECOGNIZED_COMMODITY_SYMBOLS.has(underlying)) {
      out.push(
        makeInstrument({
          venue: 'okx',
          instrumentId: inst.instId,
          symbol: canonicalSymbolFor('commodity', underlying),
          base: underlying,
          quote: inst.settleCcy ?? 'USDT',
          category: 'commodity',
          productKind: 'commodity_perp',
          preferredPriceKind: 'index',
        }),
      );
      continue;
    }

    if (!ctx.confirmedEquitySymbols.has(underlying)) continue;
    const category = equityCategoryFor(underlying);
    out.push(
      makeInstrument({
        venue: 'okx',
        instrumentId: inst.instId,
        symbol: canonicalSymbolFor(category, underlying),
        base: underlying,
        quote: inst.settleCcy ?? 'USDT',
        category,
        productKind: 'equity_perp',
        preferredPriceKind: 'index',
      }),
    );
  }

  return out;
}

// ============ Targeted REST ============

interface OkxTicker {
  instId?: string;
  last?: string;
  open24h?: string;
  volCcy24h?: string;
  ts?: string;
}

interface OkxIndexTicker {
  instId?: string;
  idxPx?: string;
  open24h?: string;
  ts?: string;
}

export function okxTickerUrl(instId: string): string {
  return `${REST_BASE}/api/v5/market/ticker?instId=${encodeURIComponent(instId)}`;
}

export function okxIndexTickerUrl(instId: string): string {
  return `${REST_BASE}/api/v5/market/index-tickers?instId=${encodeURIComponent(instId)}`;
}

/** SWAP instId 'AAPL-USDT-SWAP' 对应的指数 instId 是 'AAPL-USDT' */
export function okxIndexInstId(swapInstId: string): string {
  return swapInstId.replace(/-SWAP$/, '');
}

export function percentChangeFromOpen(price: number, open: number): number | null {
  if (!Number.isFinite(open) || open <= 0) return null;
  return (price / open - 1) * 100;
}

export function normalizeOkxSpotTicker(
  instrument: VenueInstrument,
  raw: OkxTicker,
): VenueQuote | null {
  const price = toNumber(raw.last);
  return makeQuote(instrument, {
    price,
    priceKind: 'last',
    change24h: percentChangeFromOpen(price, toNumber(raw.open24h)),
    volume24h: toNumber(raw.volCcy24h),
    sourceTimestamp: toNumber(raw.ts),
  });
}

export function normalizeOkxIndexTicker(
  instrument: VenueInstrument,
  raw: OkxIndexTicker,
): VenueQuote | null {
  const price = toNumber(raw.idxPx);
  return makeQuote(instrument, {
    price,
    priceKind: 'index',
    change24h: percentChangeFromOpen(price, toNumber(raw.open24h)),
    volume24h: null,
    sourceTimestamp: toNumber(raw.ts),
  });
}

export async function fetchOkxQuotes(instruments: VenueInstrument[]): Promise<VenueQuote[]> {
  return settleAll(
    instruments.map(async (instrument) => {
      const isPerp = instrument.productKind !== 'crypto_spot' &&
        instrument.productKind !== 'tokenized_stock_spot';
      if (isPerp) {
        const json = await fetchJson<OkxResponse<OkxIndexTicker>>(
          okxIndexTickerUrl(okxIndexInstId(instrument.instrumentId)),
        );
        const row = json.data?.[0];
        return row ? normalizeOkxIndexTicker(instrument, row) : null;
      }
      const json = await fetchJson<OkxResponse<OkxTicker>>(okxTickerUrl(instrument.instrumentId));
      const row = json.data?.[0];
      return row ? normalizeOkxSpotTicker(instrument, row) : null;
    }),
  );
}
