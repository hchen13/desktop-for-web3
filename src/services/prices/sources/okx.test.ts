import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeOkxTicker, okxAdapter } from './okx';
import type { AssetMeta } from '../types';

const BTC: AssetMeta = {
  symbol: 'BTC',
  name: 'Bitcoin',
  category: 'crypto',
  pythFeedId: null,
  cexPair: { base: 'BTC', quote: 'USDT' },
};
const ETH: AssetMeta = {
  symbol: 'ETH',
  name: 'Ethereum',
  category: 'crypto',
  pythFeedId: null,
  cexPair: { base: 'ETH', quote: 'USDT' },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('normalizeOkxTicker', () => {
  it('正常字段映射 + 24h% 计算', () => {
    const map = new Map([['BTC-USDT', 'BTC']]);
    const out = normalizeOkxTicker(
      {
        instId: 'BTC-USDT',
        last: '70000',
        open24h: '69000',
        volCcy24h: '12345.67',
        ts: '1700000000000',
      },
      map,
    );
    expect(out).not.toBeNull();
    expect(out!.symbol).toBe('BTC');
    expect(out!.price).toBe(70000);
    expect(out!.change24h).toBeCloseTo((70000 / 69000 - 1) * 100, 5);
    expect(out!.volume24h).toBeCloseTo(12345.67, 5);
    expect(out!.source).toBe('okx');
  });

  it('未知 pair 返回 null', () => {
    const out = normalizeOkxTicker({ instId: 'XYZ-USDT', last: '1', open24h: '1' }, new Map());
    expect(out).toBeNull();
  });

  it('open=0 时 change24h 为 null', () => {
    const map = new Map([['BTC-USDT', 'BTC']]);
    const out = normalizeOkxTicker({ instId: 'BTC-USDT', last: '70000', open24h: '0' }, map);
    expect(out!.change24h).toBeNull();
  });

  it('price 非数字返回 null', () => {
    const map = new Map([['BTC-USDT', 'BTC']]);
    const out = normalizeOkxTicker({ instId: 'BTC-USDT', last: 'NaN' }, map);
    expect(out).toBeNull();
  });
});

describe('okxAdapter.fetchPrices', () => {
  it('解析多 ticker，仅返回订阅集中的 symbol', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: '0',
          data: [
            {
              instId: 'BTC-USDT',
              last: '70000',
              open24h: '69000',
              volCcy24h: '1',
              ts: '1700000000000',
            },
            {
              instId: 'ETH-USDT',
              last: '3500',
              open24h: '3400',
              volCcy24h: '2',
              ts: '1700000000000',
            },
            { instId: 'JUNK-USDT', last: '1', open24h: '1', volCcy24h: '0', ts: '1700000000000' },
          ],
        }),
        { status: 200 },
      ),
    );
    const out = await okxAdapter.fetchPrices([BTC, ETH]);
    expect(out.size).toBe(2);
    expect(out.get('BTC')!.price).toBe(70000);
    expect(out.get('ETH')!.price).toBe(3500);
  });

  it('http 失败抛错', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(okxAdapter.fetchPrices([BTC])).rejects.toThrow();
  });

  it('code != 0 抛错', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: '50001', msg: 'err', data: [] }), { status: 200 }),
    );
    await expect(okxAdapter.fetchPrices([BTC])).rejects.toThrow();
  });

  it('空 assets 列表直接返回空 map', async () => {
    const out = await okxAdapter.fetchPrices([]);
    expect(out.size).toBe(0);
  });

  it('probe 返回数字延迟', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: '0', data: [] }), { status: 200 }),
    );
    const ms = await okxAdapter.probe();
    expect(typeof ms).toBe('number');
    expect(ms).toBeGreaterThanOrEqual(0);
  });
});
