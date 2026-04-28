/**
 * YieldsService 单元测试
 *
 * 覆盖：
 *  - normalize 时筛选稳定币 + TVL 下限
 *  - APY 倒序
 *  - selectYields 的 chain filter / topN
 *  - fetch 失败保留 stale
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeYields, selectYields, isStablecoinPool } from './yieldsService';

describe('isStablecoinPool', () => {
  it('显式 stablecoin=true 直接通过', () => {
    expect(isStablecoinPool({ stablecoin: true, symbol: 'WEIRD' })).toBe(true);
  });

  it('symbol 含 USDC / USDT / USDe / sUSDS 等 token 视为稳定币', () => {
    expect(isStablecoinPool({ symbol: 'USDC' })).toBe(true);
    expect(isStablecoinPool({ symbol: 'USDC-USDT' })).toBe(true);
    expect(isStablecoinPool({ symbol: 'sUSDe' })).toBe(true);
    expect(isStablecoinPool({ symbol: 'USDY' })).toBe(true);
  });

  it('其他 symbol 不视为稳定币', () => {
    expect(isStablecoinPool({ symbol: 'ETH' })).toBe(false);
    expect(isStablecoinPool({ symbol: 'BTC-WETH' })).toBe(false);
  });

  it('空 symbol 返回 false', () => {
    expect(isStablecoinPool({})).toBe(false);
    expect(isStablecoinPool({ symbol: '' })).toBe(false);
  });
});

describe('normalizeYields', () => {
  it('过滤 TVL < $10M 的池子', () => {
    const raw = {
      data: [
        { pool: 'p1', symbol: 'USDC', chain: 'ethereum', apy: 5, tvlUsd: 5_000_000 },
        { pool: 'p2', symbol: 'USDC', chain: 'ethereum', apy: 6, tvlUsd: 50_000_000 },
      ],
    };
    const out = normalizeYields(raw);
    expect(out).toHaveLength(1);
    expect(out[0].pool).toBe('p2');
  });

  it('过滤非稳定币池', () => {
    const raw = {
      data: [
        { pool: 'p1', symbol: 'ETH', chain: 'ethereum', apy: 5, tvlUsd: 100_000_000 },
        { pool: 'p2', symbol: 'USDC', chain: 'ethereum', apy: 5, tvlUsd: 100_000_000 },
      ],
    };
    const out = normalizeYields(raw);
    expect(out).toHaveLength(1);
    expect(out[0].symbol).toBe('USDC');
  });

  it('按 APY 倒序', () => {
    const raw = {
      data: [
        { pool: 'p1', symbol: 'USDC', chain: 'ethereum', apy: 3, tvlUsd: 100_000_000 },
        { pool: 'p2', symbol: 'USDT', chain: 'ethereum', apy: 12, tvlUsd: 100_000_000 },
        { pool: 'p3', symbol: 'sUSDe', chain: 'ethereum', apy: 7, tvlUsd: 100_000_000 },
      ],
    };
    const out = normalizeYields(raw);
    expect(out.map((p) => p.pool)).toEqual(['p2', 'p3', 'p1']);
  });

  it('过滤 apy=null / 非数', () => {
    const raw = {
      data: [
        { pool: 'p1', symbol: 'USDC', chain: 'eth', apy: null, tvlUsd: 100_000_000 },
        { pool: 'p2', symbol: 'USDC', chain: 'eth', apy: 5, tvlUsd: 100_000_000 },
      ],
    };
    const out = normalizeYields(raw);
    expect(out).toHaveLength(1);
  });

  it('容错空响应', () => {
    expect(normalizeYields({} as never)).toEqual([]);
    expect(normalizeYields({ data: null } as never)).toEqual([]);
  });

  it('chain 转小写存储', () => {
    const raw = {
      data: [{ pool: 'p', symbol: 'USDC', chain: 'Ethereum', apy: 5, tvlUsd: 100_000_000 }],
    };
    const out = normalizeYields(raw);
    expect(out[0].chain).toBe('ethereum');
  });
});

describe('selectYields', () => {
  const pools = [
    {
      pool: 'p1',
      project: 'a',
      symbol: 'USDC',
      chain: 'ethereum',
      apy: 8,
      apyBase: 8,
      apyReward: 0,
      tvlUsd: 1e9,
      stablecoin: true,
    },
    {
      pool: 'p2',
      project: 'b',
      symbol: 'USDT',
      chain: 'solana',
      apy: 6,
      apyBase: 6,
      apyReward: 0,
      tvlUsd: 1e9,
      stablecoin: true,
    },
    {
      pool: 'p3',
      project: 'c',
      symbol: 'sUSDe',
      chain: 'ethereum',
      apy: 12,
      apyBase: 12,
      apyReward: 0,
      tvlUsd: 1e9,
      stablecoin: true,
    },
  ];

  it('chain="all" 返回全部', () => {
    expect(selectYields(pools, { chain: 'all' })).toHaveLength(3);
  });

  it('chain=ethereum 仅返回以太坊池', () => {
    const out = selectYields(pools, { chain: 'ethereum' });
    expect(out.every((p) => p.chain === 'ethereum')).toBe(true);
    expect(out).toHaveLength(2);
  });

  it('chain 大小写不敏感', () => {
    const out = selectYields(pools, { chain: 'Solana' });
    expect(out).toHaveLength(1);
    expect(out[0].pool).toBe('p2');
  });

  it('topN 截断', () => {
    const out = selectYields(pools, { topN: 2 });
    expect(out).toHaveLength(2);
  });
});

describe('YieldsService — fetch + stale', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetch 成功后状态转 success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              pool: 'p',
              project: 'aave',
              symbol: 'USDC',
              chain: 'ethereum',
              apy: 5,
              tvlUsd: 100_000_000,
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const { yieldsService } = await import('./yieldsService');
    yieldsService.__resetForTest();
    await yieldsService.refresh(true);
    const s = yieldsService.getData();
    expect(s.status).toBe('success');
    expect(s.pools).toHaveLength(1);
  });

  it('fetch 失败保留 stale + 切换 error 状态', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                pool: 'p',
                project: 'a',
                symbol: 'USDC',
                chain: 'ethereum',
                apy: 5,
                tvlUsd: 100_000_000,
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockRejectedValueOnce(new Error('boom'));

    const { yieldsService } = await import('./yieldsService');
    yieldsService.__resetForTest();
    await yieldsService.refresh(true);
    expect(yieldsService.getData().pools).toHaveLength(1);

    await yieldsService.refresh(true);
    const s = yieldsService.getData();
    expect(s.status).toBe('error');
    expect(s.pools).toHaveLength(1); // stale
    fetchSpy.mockRestore();
  });

  it('多订阅者 + unsubscribe', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              pool: 'p',
              project: 'a',
              symbol: 'USDC',
              chain: 'ethereum',
              apy: 5,
              tvlUsd: 100_000_000,
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const { yieldsService } = await import('./yieldsService');
    yieldsService.__resetForTest();

    const a = vi.fn();
    const b = vi.fn();
    const unsubA = yieldsService.subscribe(a);
    yieldsService.subscribe(b);
    a.mockClear();
    b.mockClear();

    await yieldsService.refresh(true);
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();

    unsubA();
    a.mockClear();
    b.mockClear();
    await yieldsService.refresh(true);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });
});
