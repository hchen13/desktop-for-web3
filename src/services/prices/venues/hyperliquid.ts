/**
 * Hyperliquid HIP-3 builder-deployed 永续适配器
 *
 * Catalog: POST /info {"type":"perpDexs"} + {"type":"meta","dex":"…"}
 * Quote:   POST /info {"type":"l2Book","coin":"xyz:AAPL"}（仅 selected coin 的初始快照）
 *          WS activeAssetCtx 提供 oraclePx / markPx / midPx / prevDayPx
 *
 * 只接入显式 allowlist 的 perp DEX，且必须 deployer 校验通过。"trusted" 仅表示本项目
 * 主动 allowlist，不代表 Hyperliquid 为 builder oracle 背书。
 *
 * Hyperliquid Spot 上存在同名的 permissionless token（AAPL / TSLA / SPY 都真实存在），
 * ticker 名称不能证明身份，因此本模块完全不碰 spotMeta。
 */

import type { VenueInstrument, VenueQuote } from '../types';
import type { SocketEndpoint } from '../socket';
import {
  CATALOG_TIMEOUT_MS,
  canonicalSymbolFor,
  equityCategoryFor,
  fetchJson,
  makeInstrument,
  makeQuote,
  settleAll,
  toNumber,
  type CatalogContext,
} from './shared';

const REST_URL = 'https://api.hyperliquid.xyz/info';
export const HYPERLIQUID_WS_URL = 'wss://api.hyperliquid.xyz/ws';

/** HIP-3 collateral 是 USDC */
const HL_QUOTE_CURRENCY = 'USDC';

export interface TrustedPerpDex {
  name: string;
  expectedDeployer: string;
}

/** 显式 allowlist —— 新增 DEX 必须人工核验 deployer 后写进来 */
export const TRUSTED_PERP_DEXS: readonly TrustedPerpDex[] = [
  { name: 'xyz', expectedDeployer: '0x88806a71d74ad0a510b350545c9ae490912f0888' },
];

interface PerpDexEntry {
  name?: string;
  fullName?: string;
  deployer?: string;
}

interface UniverseEntry {
  name?: string;
  isDelisted?: boolean;
}

export interface HyperliquidRawCatalog {
  dexes: Array<{ name: string; universe: UniverseEntry[] }>;
}

export function isTrustedPerpDex(entry: PerpDexEntry | null | undefined): boolean {
  if (!entry?.name || !entry.deployer) return false;
  const name = entry.name.toLowerCase();
  const deployer = entry.deployer.toLowerCase();
  return TRUSTED_PERP_DEXS.some(
    (t) => t.name === name && t.expectedDeployer.toLowerCase() === deployer,
  );
}

export async function fetchHyperliquidRawCatalog(): Promise<HyperliquidRawCatalog> {
  const dexList = await fetchJson<Array<PerpDexEntry | null>>(REST_URL, {
    method: 'POST',
    body: JSON.stringify({ type: 'perpDexs' }),
    timeoutMs: CATALOG_TIMEOUT_MS,
  });
  const trusted = (Array.isArray(dexList) ? dexList : []).filter(isTrustedPerpDex);

  const dexes = await settleAll(
    trusted.map(async (entry) => {
      const meta = await fetchJson<{ universe?: UniverseEntry[] }>(REST_URL, {
        method: 'POST',
        body: JSON.stringify({ type: 'meta', dex: entry!.name }),
        timeoutMs: CATALOG_TIMEOUT_MS,
      });
      return {
        name: entry!.name!.toLowerCase(),
        universe: Array.isArray(meta.universe) ? meta.universe : [],
      };
    }),
  );

  return { dexes };
}

/** 'xyz:AAPL' → 'AAPL'；保留完整 instrument name 作为 instrumentId，不能盲目去前缀 */
export function stripDexPrefix(dexName: string, instrumentName: string): string | null {
  const prefix = `${dexName.toLowerCase()}:`;
  const lower = instrumentName.toLowerCase();
  if (!lower.startsWith(prefix)) return null;
  const rest = instrumentName.slice(prefix.length);
  return rest ? rest.toUpperCase() : null;
}

export function buildHyperliquidInstruments(
  raw: HyperliquidRawCatalog,
  ctx: CatalogContext,
): VenueInstrument[] {
  const out: VenueInstrument[] = [];
  for (const dex of raw.dexes) {
    for (const entry of dex.universe) {
      if (!entry.name || entry.isDelisted === true) continue;
      const canonicalRaw = stripDexPrefix(dex.name, entry.name);
      if (!canonicalRaw) continue;
      // HIP-3 上还挂着 SP500 / GOLD / EUR / XYZ100 这类指数与宏观合约，
      // 它们与 SPY / XAU / EURUSD 不是等价关系，只有被明确认定为股票的 canonical 才收录
      if (!ctx.confirmedEquitySymbols.has(canonicalRaw)) continue;
      const category = equityCategoryFor(canonicalRaw);
      out.push(
        makeInstrument({
          venue: 'hyperliquid',
          instrumentId: entry.name,
          symbol: canonicalSymbolFor(category, canonicalRaw),
          base: canonicalRaw,
          quote: HL_QUOTE_CURRENCY,
          category,
          productKind: 'hip3_perp',
          preferredPriceKind: 'oracle',
        }),
      );
    }
  }
  return out;
}

// ============ Quote ============

export interface HyperliquidAssetCtx {
  oraclePx?: string;
  markPx?: string;
  midPx?: string;
  prevDayPx?: string;
  dayNtlVlm?: string;
}

export function normalizeHyperliquidCtx(
  instrument: VenueInstrument,
  ctx: HyperliquidAssetCtx,
  receivedAt?: number,
): VenueQuote | null {
  const oracle = toNumber(ctx.oraclePx);
  const mark = toNumber(ctx.markPx);
  const mid = toNumber(ctx.midPx);

  let price = NaN;
  let priceKind: VenueQuote['priceKind'] = 'oracle';
  if (Number.isFinite(oracle) && oracle > 0) {
    price = oracle;
    priceKind = 'oracle';
  } else if (Number.isFinite(mark) && mark > 0) {
    price = mark;
    priceKind = 'mark';
  } else if (Number.isFinite(mid) && mid > 0) {
    price = mid;
    priceKind = 'mid';
  }

  const prev = toNumber(ctx.prevDayPx);
  const change24h =
    Number.isFinite(prev) && prev > 0 && Number.isFinite(price) ? (price / prev - 1) * 100 : null;

  const now = receivedAt ?? Date.now();
  return makeQuote(instrument, {
    price,
    priceKind,
    change24h,
    volume24h: toNumber(ctx.dayNtlVlm),
    sourceTimestamp: now,
    receivedAt: now,
  });
}

interface L2BookResponse {
  coin?: string;
  time?: number;
  levels?: Array<Array<{ px?: string }>>;
}

export function normalizeHyperliquidL2Book(
  instrument: VenueInstrument,
  book: L2BookResponse,
): VenueQuote | null {
  const bid = toNumber(book.levels?.[0]?.[0]?.px);
  const ask = toNumber(book.levels?.[1]?.[0]?.px);
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) return null;
  // activeAssetCtx 不带服务端时间戳，WS 那条路径只能用本地时钟；这里若用 book.time
  // 就会让同一个 instrument 的两条路径落在不同时钟域，QuoteStore 的单调性会静默丢弃其中一路
  const now = Date.now();
  return makeQuote(instrument, {
    price: (bid + ask) / 2,
    priceKind: 'mid',
    change24h: null,
    volume24h: null,
    sourceTimestamp: now,
    receivedAt: now,
    tradable: true,
  });
}

export async function fetchHyperliquidQuotes(
  instruments: VenueInstrument[],
): Promise<VenueQuote[]> {
  return settleAll(
    instruments.map(async (instrument) => {
      const book = await fetchJson<L2BookResponse>(REST_URL, {
        method: 'POST',
        body: JSON.stringify({ type: 'l2Book', coin: instrument.instrumentId }),
      });
      return normalizeHyperliquidL2Book(instrument, book);
    }),
  );
}

// ============ WebSocket ============

function subscription(instrument: VenueInstrument) {
  return { type: 'activeAssetCtx', coin: instrument.instrumentId };
}

export const hyperliquidSocketEndpoint: SocketEndpoint = {
  key: 'hyperliquid',
  venue: 'hyperliquid',
  url: HYPERLIQUID_WS_URL,
  supports: () => true,
  buildSubscribe: (instruments) =>
    instruments.map((i) => ({ method: 'subscribe', subscription: subscription(i) })),
  buildUnsubscribe: (instruments) =>
    instruments.map((i) => ({ method: 'unsubscribe', subscription: subscription(i) })),
  parseMessage: (data, instruments) => {
    if (!data || data[0] !== '{') return [];
    const json = JSON.parse(data) as {
      channel?: string;
      data?: { coin?: string; ctx?: HyperliquidAssetCtx };
    };
    if (json.channel !== 'activeAssetCtx' || !json.data?.coin || !json.data.ctx) return [];
    const instrument = instruments.find((i) => i.instrumentId === json.data!.coin);
    if (!instrument) return [];
    const quote = normalizeHyperliquidCtx(instrument, json.data.ctx);
    return quote ? [quote] : [];
  },
  heartbeat: { intervalMs: 30_000, payload: () => ({ method: 'ping' }) },
};
