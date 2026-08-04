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

/** 行情自身允许的最大年龄；超过就当作 stale，不再算 live */
export const MARKET_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** 同层同 PriceKind 下多种计价货币并存时的取舍顺序 */
const QUOTE_CURRENCY_PRIORITY = ['USDT', 'USDC', 'FDUSD', 'USD'];

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
    quoteCurrency: cached?.quoteCurrency ?? '',
    productKind: null,
    priceKind: null,
  };
}

export function aggregateSnapshot(options: AggregateOptions): PriceSnapshot | null {
  const { assetKey, symbol, category, quotes, now, freshnessWindowMs } = options;

  const valid = quotes.filter((q) => Number.isFinite(q.price) && q.price > 0);
  if (valid.length === 0) return null;

  // receivedAt 只说明「我们刚收到响应」，行情自身可能早就停住了（退市 symbol 仍会返回 200 + 旧价），
  // 所以两个时间都要看
  const fresh = valid.filter(
    (q) => now - q.receivedAt <= freshnessWindowMs && now - q.sourceTimestamp <= MARKET_MAX_AGE_MS,
  );
  if (fresh.length === 0) {
    return staleSnapshot(assetKey, symbol, valid);
  }

  const group = selectGroup(fresh);
  if (!group) return staleSnapshot(assetKey, symbol, valid);

  const { tier, members } = group;
  const { price, accepted } = combinePrices(members);
  const representative = pickRepresentative(accepted, price);

  return {
    assetKey,
    symbol,
    price,
    change24h: representative.change24h,
    volume24h: representative.volume24h,
    // 被剔除的来源既不计数也不能贡献时间戳，否则一个离群的新报价会让整体看起来比实际新
    lastUpdate: Math.max(...accepted.map((m) => m.sourceTimestamp)),
    source: representative.venue,
    sources: dedupeVenues(accepted),
    sourceCount: accepted.length,
    quality: tier === 1 ? 'live' : 'degraded',
    coverageTier: coverageTierFor(tier, accepted.length, category, representative.priceKind),
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

/**
 * 取最高可用 Tier，层内取优先级最高的 PriceKind，再按计价货币分组。
 * USDT 与 USDC 报价不是同一个东西，不能直接平均。
 */
function selectGroup(quotes: VenueQuote[]): { tier: SourceTier; members: VenueQuote[] } | null {
  for (const tier of [1, 2, 3] as const) {
    const inTier = quotes.filter((q) => quoteTier(q) === tier);
    if (inTier.length === 0) continue;
    for (const kind of PRICE_KIND_PRIORITY[tier]) {
      const sameKind = inTier.filter((q) => q.priceKind === kind);
      if (sameKind.length === 0) continue;
      const byCurrency = new Map<string, VenueQuote[]>();
      for (const q of sameKind) {
        const list = byCurrency.get(q.quoteCurrency);
        if (list) list.push(q);
        else byCurrency.set(q.quoteCurrency, [q]);
      }
      let best: VenueQuote[] | null = null;
      for (const currency of QUOTE_CURRENCY_PRIORITY) {
        const list = byCurrency.get(currency);
        if (list && (!best || list.length > best.length)) best = list;
      }
      if (!best) {
        for (const list of byCurrency.values()) {
          if (!best || list.length > best.length) best = list;
        }
      }
      if (best) return { tier, members: best };
    }
  }
  return null;
}

interface Combined {
  price: number;
  /** 真正参与定价的来源；被剔除或被放弃的不在其中 */
  accepted: VenueQuote[];
}

function combinePrices(members: VenueQuote[]): Combined {
  if (members.length === 1) return { price: members[0].price, accepted: members };

  if (members.length === 2) {
    const [a, b] = members;
    const mean = (a.price + b.price) / 2;
    const spread = Math.abs(a.price - b.price) / mean;
    if (spread <= DIVERGENCE_THRESHOLD) return { price: mean, accepted: members };
    // 分歧过大时只采用一个来源，因此不能再声称是多家共识
    const winner =
      a.sourceTimestamp !== b.sourceTimestamp
        ? a.sourceTimestamp > b.sourceTimestamp
          ? a
          : b
        : venueRank(a.venue) <= venueRank(b.venue)
          ? a
          : b;
    return { price: winner.price, accepted: [winner] };
  }

  const first = median(members.map((m) => m.price));
  const kept = members.filter((m) => Math.abs(m.price - first) / first <= OUTLIER_THRESHOLD);
  if (kept.length === 0) return { price: first, accepted: members };
  return { price: median(kept.map((m) => m.price)), accepted: kept };
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

function coverageTierFor(
  tier: SourceTier,
  count: number,
  category: AssetCategory,
  priceKind: PriceKind,
): CoverageTier {
  // HIP-3 的 l2Book 中间价只是盘口参考，不是 builder oracle，不能共用同一个标签
  if (tier === 3) {
    return priceKind === 'oracle' ? 'trusted-oracle-fallback' : 'derivative-reference';
  }
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
