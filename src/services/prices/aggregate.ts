/**
 * 同 Tier 报价聚合
 *
 * 硬约束：tokenized spot / perp index / mark / last / HIP-3 oracle 绝不混进同一个平均值。
 * 先按 Tier 取最高可用层，再在层内取同一个 PriceKind 的分组，最后才做确定性合并。
 */

import type {
  AssetCategory,
  AssetKey,
  CoverageTier,
  PriceKind,
  PriceSnapshot,
  QuoteQuality,
  Venue,
  VenueQuote,
} from './types';
import { productTier, type SourceTier } from './instrumentResolver';

/** 三个及以上来源时，偏离中位数超过这个比例的来源会被剔除 */
export const OUTLIER_THRESHOLD = 0.02;
/** 两个来源时，价差超过这个比例就不做平均 */
export const DIVERGENCE_THRESHOLD = 0.02;

/** 价差相同、时间戳也相同时的固定 venue 优先级 */
export const VENUE_PRIORITY: readonly Venue[] = ['okx', 'bitget', 'binance', 'hyperliquid'];

/** 每层内部的 PriceKind 优先级；只有同一个 PriceKind 才允许聚合 */
const PRICE_KIND_PRIORITY: Record<SourceTier, readonly PriceKind[]> = {
  1: ['last', 'mid'],
  2: ['index', 'oracle', 'mark', 'last', 'mid'],
  3: ['oracle', 'mark', 'mid', 'last'],
};

export function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function venueRank(venue: Venue): number {
  const idx = VENUE_PRIORITY.indexOf(venue);
  return idx < 0 ? VENUE_PRIORITY.length : idx;
}

function quoteTier(quote: VenueQuote): SourceTier {
  return productTier(quote.productKind);
}

export interface AggregateOptions {
  assetKey: AssetKey;
  symbol: string;
  category: AssetCategory;
  quotes: VenueQuote[];
  now: number;
  /** 超过这个「本地收到时间」年龄的报价不参与聚合 */
  freshnessWindowMs: number;
}

/** 没有任何可用 instrument 时的显式不可用快照（可带上最后缓存价） */
export function unavailableSnapshot(
  assetKey: AssetKey,
  symbol: string,
  cached?: PriceSnapshot | null,
): PriceSnapshot {
  return {
    assetKey,
    symbol,
    price: cached?.price ?? 0,
    change24h: cached?.change24h ?? null,
    volume24h: null,
    lastUpdate: cached?.lastUpdate ?? 0,
    source: cached?.source ?? '',
    sources: [],
    sourceCount: 0,
    quality: 'unavailable',
    coverageTier: 'unavailable',
    quoteCurrency: cached?.quoteCurrency ?? 'USD',
    productKind: null,
    priceKind: null,
  };
}

export function aggregateSnapshot(options: AggregateOptions): PriceSnapshot | null {
  const { assetKey, symbol, category, quotes, now, freshnessWindowMs } = options;

  const valid = quotes.filter((q) => Number.isFinite(q.price) && q.price > 0);
  if (valid.length === 0) return null;

  const fresh = valid.filter((q) => now - q.receivedAt <= freshnessWindowMs);
  if (fresh.length === 0) {
    return staleSnapshot(assetKey, symbol, valid);
  }

  const group = selectGroup(fresh);
  if (!group) return staleSnapshot(assetKey, symbol, valid);

  const { tier, members } = group;
  const price = combinePrices(members);
  const representative = pickRepresentative(members, price);

  return {
    assetKey,
    symbol,
    price,
    change24h: representative.change24h,
    volume24h: representative.volume24h,
    lastUpdate: Math.max(...members.map((m) => m.sourceTimestamp)),
    source: representative.venue,
    sources: dedupeVenues(members),
    sourceCount: members.length,
    quality: tier === 1 ? 'live' : 'degraded',
    coverageTier: coverageTierFor(tier, members.length, category),
    quoteCurrency: representative.quoteCurrency,
    productKind: representative.productKind,
    priceKind: representative.priceKind,
  };
}

function staleSnapshot(
  assetKey: AssetKey,
  symbol: string,
  quotes: VenueQuote[],
): PriceSnapshot | null {
  const newest = quotes.reduce((a, b) => (b.receivedAt > a.receivedAt ? b : a));
  if (!newest) return null;
  return {
    assetKey,
    symbol,
    price: newest.price,
    change24h: newest.change24h,
    volume24h: newest.volume24h,
    lastUpdate: newest.sourceTimestamp,
    source: newest.venue,
    sources: [newest.venue],
    sourceCount: 1,
    quality: 'stale',
    coverageTier: 'stale',
    quoteCurrency: newest.quoteCurrency,
    productKind: newest.productKind,
    priceKind: newest.priceKind,
  };
}

/** 取最高可用 Tier，并在层内取优先级最高的 PriceKind 分组 */
function selectGroup(quotes: VenueQuote[]): { tier: SourceTier; members: VenueQuote[] } | null {
  for (const tier of [1, 2, 3] as const) {
    const inTier = quotes.filter((q) => quoteTier(q) === tier);
    if (inTier.length === 0) continue;
    for (const kind of PRICE_KIND_PRIORITY[tier]) {
      const members = inTier.filter((q) => q.priceKind === kind);
      if (members.length > 0) return { tier, members };
    }
  }
  return null;
}

function combinePrices(members: VenueQuote[]): number {
  if (members.length === 1) return members[0].price;

  if (members.length === 2) {
    const [a, b] = members;
    const mean = (a.price + b.price) / 2;
    const spread = Math.abs(a.price - b.price) / mean;
    if (spread <= DIVERGENCE_THRESHOLD) return mean;
    if (a.sourceTimestamp !== b.sourceTimestamp) {
      return a.sourceTimestamp > b.sourceTimestamp ? a.price : b.price;
    }
    return venueRank(a.venue) <= venueRank(b.venue) ? a.price : b.price;
  }

  const first = median(members.map((m) => m.price));
  const kept = members.filter((m) => Math.abs(m.price - first) / first <= OUTLIER_THRESHOLD);
  return kept.length > 0 ? median(kept.map((m) => m.price)) : first;
}

/**
 * change24h / volume24h 必须来自同一份 VenueQuote，
 * 因此取价格最接近聚合结果的那个来源作为代表，绝不跨 venue 拼接或求和。
 */
function pickRepresentative(members: VenueQuote[], price: number): VenueQuote {
  let best = members[0];
  let bestDelta = Math.abs(best.price - price);
  let bestRank = venueRank(best.venue);
  for (const member of members.slice(1)) {
    const delta = Math.abs(member.price - price);
    const rank = venueRank(member.venue);
    if (delta < bestDelta || (delta === bestDelta && rank < bestRank)) {
      best = member;
      bestDelta = delta;
      bestRank = rank;
    }
  }
  return best;
}

function dedupeVenues(members: VenueQuote[]): Venue[] {
  const seen = new Set<Venue>();
  for (const m of members) seen.add(m.venue);
  return VENUE_PRIORITY.filter((v) => seen.has(v));
}

function coverageTierFor(tier: SourceTier, count: number, category: AssetCategory): CoverageTier {
  if (tier === 3) return 'trusted-oracle-fallback';
  if (tier === 2) return 'derivative-reference';
  if (count === 1) return 'single-source';
  return category === 'stock' || category === 'etf' ? 'tokenized-spot-consensus' : 'spot-consensus';
}

export function describeCoverage(snapshot: PriceSnapshot): string {
  const labels: Record<CoverageTier, string> = {
    'spot-consensus': '多家现货共识',
    'tokenized-spot-consensus': '多家代币化股票现货共识',
    'single-source': '单一来源',
    'derivative-reference': '衍生品参考价',
    'trusted-oracle-fallback': 'HIP-3 预言机兜底',
    stale: '数据陈旧',
    unavailable: '暂无可用市场',
  };
  return labels[snapshot.coverageTier];
}

export type { QuoteQuality };
