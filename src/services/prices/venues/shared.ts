/**
 * Venue adapter 共用工具
 *
 * 每个 venue 模块拆成三段，方便 catalog 合并时统一编排：
 *  - fetchRaw()            拉 instruments / exchangeInfo 等 metadata（绝不拉全市场 ticker）
 *  - collectEquitySymbols() 从 raw 中提取「被交易所产品 metadata 明确认定为股票」的 canonical symbol
 *  - buildInstruments()    在拿到全局 confirmed 集合后产出 VenueInstrument
 */

import type {
  AssetCategory,
  AssetKey,
  InstrumentStatus,
  PriceKind,
  ProductKind,
  Venue,
  VenueInstrument,
  VenueQuote,
} from '../types';
import { makeAssetKey } from '../assetKey';

export const HTTP_TIMEOUT_MS = 8000;
export const CATALOG_TIMEOUT_MS = 15000;

/** 支持的稳定币计价（USDT 报价不等于真实 USD，quoteCurrency 会原样保留） */
export const SUPPORTED_QUOTE_CURRENCIES = new Set(['USDT', 'USDC', 'FDUSD']);

/** crypto 现货只收这两种计价，避免同一资产在 catalog 里堆出四五个等价 instrument */
export const CRYPTO_QUOTE_CURRENCIES = new Set(['USDT', 'USDC']);

/** 同一 venue 同一资产存在多个等价现货对时的取舍顺序 */
export const CRYPTO_QUOTE_PRIORITY = ['USDT', 'USDC'];

/**
 * 交易所 metadata 明确分类的商品 base symbol 白名单。
 *
 * 没有这个白名单，Bitget 的 symbolType='metal' 会把 XAUT / PAXG（本质是加密代币）
 * 当成贵金属现货。
 */
export const RECOGNIZED_COMMODITY_SYMBOLS = new Set([
  'XAU',
  'XAG',
  'XPT',
  'XPD',
  'COPPER',
  'NATGAS',
  'BZ',
  'CL',
]);

/**
 * venue 侧 symbol → canonical symbol 的逐条反向映射。
 * 与 assetKey.ts 的正向 alias 成对存在，按 category 隔离——CL 在商品语境是 WTI，
 * 在股票语境是 Colgate-Palmolive，不能共用一张表。
 */
const CANONICAL_BY_VENUE_SYMBOL: Partial<Record<AssetCategory, Record<string, string>>> = {
  stock: { BRKB: 'BRK.B' },
  commodity: { BZ: 'BRENT', CL: 'WTI' },
};

export function canonicalSymbolFor(category: AssetCategory, symbol: string): string {
  return CANONICAL_BY_VENUE_SYMBOL[category]?.[symbol.toUpperCase()] ?? symbol.toUpperCase();
}

/**
 * 已知 ETF ticker —— 只影响 selector 分类 tab 与详情页链接，不参与任何价格语义。
 * curated ASSETS 里已有的条目优先，这里补的是 venue catalog 带来的动态条目。
 */
const KNOWN_ETF_SYMBOLS = new Set([
  'SPY',
  'QQQ',
  'IWM',
  'VTI',
  'VOO',
  'GLD',
  'SLV',
  'IBIT',
  'FBTC',
  'ARKK',
  'TLT',
  'HYG',
  'EEM',
  'XLF',
  'XLE',
  'XLK',
  'XBI',
  'SMH',
  'SOXL',
  'SOXS',
  'TQQQ',
  'SQQQ',
  'TZA',
  'TMF',
  'TBT',
  'UVXY',
  'URNM',
  'KWEB',
  'BITO',
  'EWY',
  'EWJ',
  'EWT',
  'EWZ',
]);

export function equityCategoryFor(symbol: string): AssetCategory {
  return KNOWN_ETF_SYMBOLS.has(symbol.toUpperCase()) ? 'etf' : 'stock';
}

export interface CatalogContext {
  /** 被 curated 或某家交易所的明确股票产品 metadata 确认过的 canonical symbol */
  confirmedEquitySymbols: Set<string>;
}

export function makeInstrument(params: {
  venue: Venue;
  instrumentId: string;
  symbol: string;
  base: string;
  quote: string;
  category: AssetCategory;
  productKind: ProductKind;
  preferredPriceKind: PriceKind;
  status?: InstrumentStatus;
}): VenueInstrument {
  const symbol = params.symbol.toUpperCase();
  const assetKey: AssetKey = makeAssetKey(params.category, symbol);
  return {
    venue: params.venue,
    instrumentId: params.instrumentId,
    assetKey,
    symbol,
    base: params.base.toUpperCase(),
    quote: params.quote.toUpperCase(),
    category: params.category,
    productKind: params.productKind,
    preferredPriceKind: params.preferredPriceKind,
    status: params.status ?? 'live',
  };
}

export function makeQuote(
  instrument: VenueInstrument,
  params: {
    price: number;
    priceKind: PriceKind;
    change24h?: number | null;
    volume24h?: number | null;
    sourceTimestamp: number;
    receivedAt?: number;
    tradable?: boolean;
  },
): VenueQuote | null {
  if (!Number.isFinite(params.price) || params.price <= 0) return null;
  const now = params.receivedAt ?? Date.now();
  const ts =
    Number.isFinite(params.sourceTimestamp) && params.sourceTimestamp > 0
      ? params.sourceTimestamp
      : now;
  return {
    assetKey: instrument.assetKey,
    venue: instrument.venue,
    instrumentId: instrument.instrumentId,
    productKind: instrument.productKind,
    priceKind: params.priceKind,
    quoteCurrency: instrument.quote,
    price: params.price,
    change24h: normalizeNumber(params.change24h),
    volume24h: normalizeNumber(params.volume24h),
    sourceTimestamp: ts,
    receivedAt: now,
    tradable: params.tradable,
  };
}

/**
 * 已退市的 symbol 往往仍然返回 HTTP 200 和旧的 lastPrice，只是行情时间戳早已停住、
 * 盘口归零。所以 candidate 验证不能只看「价格是正数」。
 */
export function isUsableQuote(quote: VenueQuote, now: number, maxAgeMs: number): boolean {
  if (quote.tradable === false) return false;
  return now - quote.sourceTimestamp <= maxAgeMs;
}

/** 交易所自身把 instrument 标成停牌 / 下架时用的最大行情年龄 */
export const TRADABLE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export function bestQuoteIsTradable(bid: number, ask: number): boolean | undefined {
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) return undefined;
  return bid > 0 && ask > 0;
}

export function normalizeNumber(value: number | null | undefined): number | null {
  if (value == null) return null;
  return Number.isFinite(value) ? value : null;
}

export function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

/** 大小写不敏感的 metadata 字段比较（Bitget 的 isReality/isRwa 大小写不统一） */
export function eqi(value: unknown, expected: string): boolean {
  return typeof value === 'string' && value.toLowerCase() === expected.toLowerCase();
}

export async function fetchJson<T>(
  url: string,
  options: { timeoutMs?: number; method?: string; body?: string } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? HTTP_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: options.method ?? 'GET',
      body: options.body,
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`${url} http ${resp.status}`);
    return (await resp.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** 逐条并发拉取并忽略单条失败——单个 instrument 报价失败不能拖垮整个 venue */
export async function settleAll<T>(tasks: Array<Promise<T | null>>): Promise<T[]> {
  const results = await Promise.allSettled(tasks);
  const out: T[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value != null) out.push(r.value);
  }
  return out;
}
