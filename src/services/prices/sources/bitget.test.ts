import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeBitgetTicker, bitgetAdapter } from './bitget';
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

describe('normalizeBitgetTicker', () => {
  it('change24h 已是 decimal，乘以 100 得到百分比', () => {
    const map = new Map([['BTCUSDT', 'BTC']]);
    const out = normalizeBitgetTicker(
      {
        symbol: 'BTCUSDT',
        lastPr: '70000',
        change24h: '0.0123', // +1.23%
        quoteVolume: '1500',
        ts: '1700000000000',
      },
      map,
    );
    expect(out!.change24h).toBeCloseTo(1.23, 5);
    expect(out!.volume24h).toBe(1500);
    expect(out!.source).toBe('bitget');
  });

  it('未知 symbol 返回 null', () => {
    const out = normalizeBitgetTicker({ symbol: 'XYZUSDT', lastPr: '1' }, new Map());
    expect(out).toBeNull();
  });

  it('change24h 缺失时为 null', () => {
    const map = new Map([['BTCUSDT', 'BTC']]);
    const out = normalizeBitgetTicker({ symbol: 'BTCUSDT', lastPr: '70000' }, map);
    expect(out!.change24h).toBeNull();
  });

  it('lastPr 非法返回 null', () => {
    const map = new Map([['BTCUSDT', 'BTC']]);
    const out = normalizeBitgetTicker({ symbol: 'BTCUSDT', lastPr: 'oops' }, map);
    expect(out).toBeNull();
  });
});

describe('bitgetAdapter.fetchPrices', () => {
  it('正常 200 + code=00000 解析成功', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: '00000',
          data: [
            {
              symbol: 'BTCUSDT',
              lastPr: '70000',
              change24h: '0.01',
              quoteVolume: '999',
              ts: '1700000000000',
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const out = await bitgetAdapter.fetchPrices([BTC]);
    expect(out.size).toBe(1);
    expect(out.get('BTC')!.price).toBe(70000);
  });

  it('code != 00000 抛错', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: '40000', msg: 'err', data: [] }), { status: 200 }),
    );
    await expect(bitgetAdapter.fetchPrices([BTC])).rejects.toThrow();
  });

  it('http 失败抛错', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 502 }));
    await expect(bitgetAdapter.fetchPrices([BTC])).rejects.toThrow();
  });

  it('probe 成功返回延迟', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: '00000', data: [] }), { status: 200 }),
    );
    const ms = await bitgetAdapter.probe();
    expect(typeof ms).toBe('number');
  });

  it('空 assets 直接返回空', async () => {
    const out = await bitgetAdapter.fetchPrices([]);
    expect(out.size).toBe(0);
  });
});
