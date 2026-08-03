import { describe, it, expect } from 'vitest';
import { aggregateSnapshot, median, unavailableSnapshot } from './aggregate';
import type { PriceKind, ProductKind, Venue, VenueQuote } from './types';

const NOW = 1_800_000_000_000;
const WINDOW = 60_000;

function quote(
  venue: Venue,
  price: number,
  overrides: Partial<VenueQuote> & { productKind?: ProductKind; priceKind?: PriceKind } = {},
): VenueQuote {
  const productKind = overrides.productKind ?? 'tokenized_stock_spot';
  return {
    assetKey: 'stock:NVDA',
    venue,
    instrumentId: `${venue}-inst`,
    productKind,
    priceKind: overrides.priceKind ?? 'last',
    quoteCurrency: 'USDT',
    price,
    change24h: overrides.change24h ?? 1,
    volume24h: overrides.volume24h ?? 100,
    sourceTimestamp: overrides.sourceTimestamp ?? NOW - 1000,
    receivedAt: overrides.receivedAt ?? NOW - 1000,
  };
}

function aggregate(quotes: VenueQuote[], category: 'stock' | 'crypto' = 'stock') {
  return aggregateSnapshot({
    assetKey: 'stock:NVDA',
    symbol: 'NVDA',
    category,
    quotes,
    now: NOW,
    freshnessWindowMs: WINDOW,
  });
}

describe('median', () => {
  it('奇数取中间，偶数取中间两个的平均', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([7])).toBe(7);
  });
});

describe('同 Tier 聚合', () => {
  it('三个来源先取 median 再剔除 2% 以外的离群值', () => {
    const snap = aggregate([
      quote('okx', 100),
      quote('bitget', 101),
      quote('binance', 200), // 离群
    ]);
    expect(snap!.price).toBe(100.5);
    expect(snap!.sourceCount).toBe(3);
    expect(snap!.sources).toEqual(['okx', 'bitget', 'binance']);
  });

  it('三个来源都在阈值内时取剩余值的 median', () => {
    const snap = aggregate([quote('okx', 100), quote('bitget', 100.5), quote('binance', 101)]);
    expect(snap!.price).toBe(100.5);
    expect(snap!.coverageTier).toBe('tokenized-spot-consensus');
  });

  it('两个来源价差在阈值内时取中位数', () => {
    const snap = aggregate([quote('okx', 100), quote('bitget', 101)]);
    expect(snap!.price).toBe(100.5);
  });

  it('两个来源分歧超过阈值时不平均，取更新的那个', () => {
    const snap = aggregate([
      quote('okx', 100, { sourceTimestamp: NOW - 5000 }),
      quote('bitget', 130, { sourceTimestamp: NOW - 1000 }),
    ]);
    expect(snap!.price).toBe(130);
  });

  it('分歧且时间戳相同时按固定 venue 优先级', () => {
    const snap = aggregate([
      quote('bitget', 130, { sourceTimestamp: NOW - 1000 }),
      quote('okx', 100, { sourceTimestamp: NOW - 1000 }),
    ]);
    expect(snap!.price).toBe(100);
  });

  it('单一来源标记 single-source', () => {
    const snap = aggregate([quote('okx', 100)]);
    expect(snap).toMatchObject({ price: 100, sourceCount: 1, coverageTier: 'single-source' });
  });

  it('crypto 多来源用 spot-consensus', () => {
    const snap = aggregate(
      [
        quote('okx', 100, { productKind: 'crypto_spot' }),
        quote('bitget', 100.2, { productKind: 'crypto_spot' }),
      ],
      'crypto',
    );
    expect(snap!.coverageTier).toBe('spot-consensus');
  });
});

describe('Tier 与 PriceKind 隔离', () => {
  it('tokenized spot 不会和 perp 混进同一个平均值', () => {
    const snap = aggregate([
      quote('okx', 100, { productKind: 'tokenized_stock_spot', priceKind: 'last' }),
      quote('bitget', 500, { productKind: 'equity_perp', priceKind: 'index' }),
    ]);
    expect(snap!.price).toBe(100);
    expect(snap!.sourceCount).toBe(1);
    expect(snap!.sources).toEqual(['okx']);
    expect(snap!.coverageTier).toBe('single-source');
  });

  it('Tier 1 全部不新鲜时才进入 Tier 2', () => {
    const snap = aggregate([
      quote('okx', 100, { receivedAt: NOW - WINDOW - 1 }),
      quote('bitget', 500, { productKind: 'equity_perp', priceKind: 'index' }),
    ]);
    expect(snap!.price).toBe(500);
    expect(snap!.coverageTier).toBe('derivative-reference');
    expect(snap!.quality).toBe('degraded');
  });

  it('index 不会和 mark / last 混在一起', () => {
    const snap = aggregate([
      quote('okx', 500, { productKind: 'equity_perp', priceKind: 'index' }),
      quote('bitget', 900, { productKind: 'equity_perp', priceKind: 'mark' }),
      quote('binance', 950, { productKind: 'equity_perp', priceKind: 'last' }),
    ]);
    expect(snap!.price).toBe(500);
    expect(snap!.priceKind).toBe('index');
    expect(snap!.sourceCount).toBe(1);
  });

  it('CEX Tier 不与 HIP-3 Tier 混合', () => {
    const snap = aggregate([
      quote('bitget', 500, { productKind: 'equity_perp', priceKind: 'index' }),
      quote('hyperliquid', 505, { productKind: 'hip3_perp', priceKind: 'oracle' }),
    ]);
    expect(snap!.price).toBe(500);
    expect(snap!.sources).toEqual(['bitget']);
  });

  it('HIP-3 只在前两层都不可用时启用', () => {
    const snap = aggregate([
      quote('hyperliquid', 505, { productKind: 'hip3_perp', priceKind: 'oracle' }),
    ]);
    expect(snap).toMatchObject({
      price: 505,
      coverageTier: 'trusted-oracle-fallback',
      priceKind: 'oracle',
    });
  });
});

describe('代表来源与陈旧处理', () => {
  it('change24h / volume24h 取自价格最接近聚合价的同一份 quote，不跨 venue 相加', () => {
    const snap = aggregate([
      quote('okx', 100, { change24h: 1, volume24h: 10 }),
      quote('bitget', 100.4, { change24h: 2, volume24h: 20 }),
      quote('binance', 101, { change24h: 3, volume24h: 30 }),
    ]);
    expect(snap!.price).toBeCloseTo(100.4, 6);
    expect(snap!.change24h).toBe(2);
    expect(snap!.volume24h).toBe(20);
    expect(snap!.source).toBe('bitget');
  });

  it('超出新鲜度窗口的来源被排除', () => {
    const snap = aggregate([
      quote('okx', 100, { receivedAt: NOW - WINDOW - 1 }),
      quote('bitget', 200),
    ]);
    expect(snap!.price).toBe(200);
    expect(snap!.sourceCount).toBe(1);
  });

  it('没有任何新鲜来源时用最近一条并标记 stale', () => {
    const snap = aggregate([
      quote('okx', 100, { receivedAt: NOW - WINDOW - 5000 }),
      quote('bitget', 200, { receivedAt: NOW - WINDOW - 1000 }),
    ]);
    expect(snap).toMatchObject({ price: 200, quality: 'stale', coverageTier: 'stale' });
  });

  it('价格非法的来源被过滤', () => {
    expect(aggregate([quote('okx', 0), quote('bitget', -1)])).toBeNull();
    expect(aggregate([])).toBeNull();
  });
});

describe('unavailable 快照', () => {
  it('没有任何 instrument 时给出显式 unavailable 状态', () => {
    const snap = unavailableSnapshot('etf:FBTC', 'FBTC');
    expect(snap).toMatchObject({
      assetKey: 'etf:FBTC',
      symbol: 'FBTC',
      quality: 'unavailable',
      coverageTier: 'unavailable',
      sourceCount: 0,
      lastUpdate: 0,
    });
  });

  it('已有缓存价时保留最后价格，同时仍标记 unavailable', () => {
    const snap = unavailableSnapshot('etf:XLF', 'XLF', {
      ...unavailableSnapshot('etf:XLF', 'XLF'),
      price: 42,
      lastUpdate: 123,
    });
    expect(snap).toMatchObject({ price: 42, lastUpdate: 123, quality: 'unavailable' });
  });
});
