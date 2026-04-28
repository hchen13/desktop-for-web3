import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeBybitTicker, bybitAdapter } from './bybit';
import type { AssetMeta } from '../types';

const BTC: AssetMeta = {
  symbol: 'BTC',
  name: 'Bitcoin',
  category: 'crypto',
  pythFeedId: null,
  cexPair: { base: 'BTC', quote: 'USDT' },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('normalizeBybitTicker', () => {
  it('price24hPcnt decimal → 百分比', () => {
    const map = new Map([['BTCUSDT', 'BTC']]);
    const out = normalizeBybitTicker(
      {
        symbol: 'BTCUSDT',
        lastPrice: '70000',
        price24hPcnt: '-0.025',
        turnover24h: '1234',
      },
      map,
      1700000000000,
    );
    expect(out!.change24h).toBeCloseTo(-2.5, 5);
    expect(out!.volume24h).toBe(1234);
    expect(out!.lastUpdate).toBe(1700000000000);
  });

  it('未知 symbol 返回 null', () => {
    const out = normalizeBybitTicker({ symbol: 'XYZUSDT', lastPrice: '1' }, new Map(), 0);
    expect(out).toBeNull();
  });

  it('lastPrice 非法返回 null', () => {
    const map = new Map([['BTCUSDT', 'BTC']]);
    const out = normalizeBybitTicker({ symbol: 'BTCUSDT', lastPrice: '0' }, map, 0);
    expect(out).toBeNull();
  });

  it('price24hPcnt 缺失时 change24h=null', () => {
    const map = new Map([['BTCUSDT', 'BTC']]);
    const out = normalizeBybitTicker({ symbol: 'BTCUSDT', lastPrice: '70000' }, map, 0);
    expect(out!.change24h).toBeNull();
  });
});

describe('bybitAdapter.fetchPrices', () => {
  it('解析 result.list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          retCode: 0,
          result: {
            list: [
              { symbol: 'BTCUSDT', lastPrice: '70000', price24hPcnt: '0.01', turnover24h: '1' },
            ],
          },
          time: 1700000000000,
        }),
        { status: 200 },
      ),
    );
    const out = await bybitAdapter.fetchPrices([BTC]);
    expect(out.size).toBe(1);
    expect(out.get('BTC')!.price).toBe(70000);
    expect(out.get('BTC')!.lastUpdate).toBe(1700000000000);
  });

  it('retCode != 0 抛错', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ retCode: 10001, retMsg: 'err' }), { status: 200 }),
    );
    await expect(bybitAdapter.fetchPrices([BTC])).rejects.toThrow();
  });

  it('http 5xx 抛错', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    await expect(bybitAdapter.fetchPrices([BTC])).rejects.toThrow();
  });

  it('probe 成功返回延迟', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ retCode: 0, result: { list: [] } }), { status: 200 }),
    );
    const ms = await bybitAdapter.probe();
    expect(typeof ms).toBe('number');
  });

  it('空 assets 直接返回空', async () => {
    const out = await bybitAdapter.fetchPrices([]);
    expect(out.size).toBe(0);
  });
});
