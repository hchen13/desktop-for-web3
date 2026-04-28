import { describe, it, expect, vi, afterEach } from 'vitest';
import { pythToNumber, normalizePythUpdate, fetchPythLatest } from './pyth';
import type { AssetMeta } from '../types';

afterEach(() => {
  vi.restoreAllMocks();
});

const BTC: AssetMeta = {
  symbol: 'BTC',
  name: 'Bitcoin',
  category: 'crypto',
  pythFeedId: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
};

describe('pythToNumber', () => {
  it('基础 expo 反序列化', () => {
    expect(pythToNumber({ price: '7000000000000', expo: -8, publish_time: 0 })).toBeCloseTo(
      70000,
      5,
    );
  });
  it('正 expo 也支持', () => {
    expect(pythToNumber({ price: '70', expo: 3, publish_time: 0 })).toBe(70000);
  });
  it('非法 price 返回 NaN', () => {
    expect(Number.isNaN(pythToNumber({ price: 'oops', expo: -8, publish_time: 0 }))).toBe(true);
  });
});

describe('normalizePythUpdate', () => {
  it('feed 命中 → snapshot', () => {
    const map = new Map([[BTC.pythFeedId!.toLowerCase(), 'BTC']]);
    const out = normalizePythUpdate(
      {
        id: BTC.pythFeedId!,
        price: { price: '7000000000000', expo: -8, publish_time: 1700000000 },
      },
      map,
    );
    expect(out!.symbol).toBe('BTC');
    expect(out!.price).toBeCloseTo(70000, 5);
    expect(out!.lastUpdate).toBe(1700000000 * 1000);
    expect(out!.source).toBe('pyth');
  });

  it('feed 未命中 → null', () => {
    const out = normalizePythUpdate(
      {
        id: '0xdeadbeef',
        price: { price: '1', expo: 0, publish_time: 0 },
      },
      new Map(),
    );
    expect(out).toBeNull();
  });

  it('id 无 0x 前缀也能匹配', () => {
    const map = new Map([[BTC.pythFeedId!.toLowerCase(), 'BTC']]);
    const id = BTC.pythFeedId!.replace(/^0x/, '');
    const out = normalizePythUpdate(
      {
        id,
        price: { price: '7000000000000', expo: -8, publish_time: 1 },
      },
      map,
    );
    expect(out!.symbol).toBe('BTC');
  });

  it('price <= 0 → null', () => {
    const map = new Map([[BTC.pythFeedId!.toLowerCase(), 'BTC']]);
    const out = normalizePythUpdate(
      {
        id: BTC.pythFeedId!,
        price: { price: '0', expo: -8, publish_time: 1 },
      },
      map,
    );
    expect(out).toBeNull();
  });
});

describe('fetchPythLatest', () => {
  it('解析 parsed[] 数组', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          parsed: [
            {
              id: BTC.pythFeedId!.replace(/^0x/, ''),
              price: { price: '7000000000000', expo: -8, publish_time: 1700000000 },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const out = await fetchPythLatest([BTC]);
    expect(out.size).toBe(1);
    expect(out.get('BTC')!.price).toBeCloseTo(70000, 5);
  });

  it('http 失败时该 chunk 跳过，返回空（不抛错）', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    const out = await fetchPythLatest([BTC]);
    expect(out.size).toBe(0);
  });

  it('无 feed 的 asset 列表 → 空 map（不发请求）', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const noFeed: AssetMeta = {
      symbol: 'X',
      name: 'X',
      category: 'crypto',
      pythFeedId: null,
    };
    const out = await fetchPythLatest([noFeed]);
    expect(out.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('未识别 id 被忽略', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          parsed: [{ id: '0xdeadbeef', price: { price: '1', expo: 0, publish_time: 1 } }],
        }),
        { status: 200 },
      ),
    );
    const out = await fetchPythLatest([BTC]);
    expect(out.size).toBe(0);
  });
});
