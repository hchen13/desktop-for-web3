import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeCoinbase, coinbaseAdapter } from './coinbase';
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

describe('normalizeCoinbase', () => {
  it('正常映射，open / price 计算 24h%', () => {
    const out = normalizeCoinbase(
      { price: '70000', volume: '10', time: '2024-01-01T00:00:00Z' },
      { open: '69000' },
      'BTC',
    );
    expect(out!.price).toBe(70000);
    expect(out!.change24h).toBeCloseTo((70000 / 69000 - 1) * 100, 5);
    expect(out!.volume24h).toBeCloseTo(10 * 70000, 5);
  });

  it('open 缺失时 change24h null', () => {
    const out = normalizeCoinbase({ price: '70000' }, null, 'BTC');
    expect(out!.change24h).toBeNull();
  });

  it('price 0 返回 null', () => {
    const out = normalizeCoinbase({ price: '0' }, null, 'BTC');
    expect(out).toBeNull();
  });

  it('price 非数字返回 null', () => {
    const out = normalizeCoinbase({ price: 'foo' }, null, 'BTC');
    expect(out).toBeNull();
  });
});

describe('coinbaseAdapter.fetchPrices', () => {
  it('针对每个 asset 各发 ticker + stats 请求', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes('/ticker')) {
        return new Response(
          JSON.stringify({ price: '70000', volume: '5', time: '2024-01-01T00:00:00Z' }),
          { status: 200 },
        );
      }
      if (url.includes('/stats')) {
        return new Response(JSON.stringify({ open: '69000', volume: '5' }), { status: 200 });
      }
      return new Response('', { status: 404 });
    });
    const out = await coinbaseAdapter.fetchPrices([BTC]);
    expect(out.size).toBe(1);
    expect(out.get('BTC')!.price).toBe(70000);
  });

  it('ticker 失败时跳过该 symbol', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    const out = await coinbaseAdapter.fetchPrices([BTC]);
    expect(out.size).toBe(0);
  });

  it('probe 成功', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ price: '70000' }), { status: 200 }),
    );
    const ms = await coinbaseAdapter.probe();
    expect(typeof ms).toBe('number');
  });

  it('probe 失败抛错', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    await expect(coinbaseAdapter.probe()).rejects.toThrow();
  });

  it('空 assets 直接返回', async () => {
    const out = await coinbaseAdapter.fetchPrices([]);
    expect(out.size).toBe(0);
  });
});
