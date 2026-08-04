import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RateCacheData } from './types';

const CACHE_KEY = 'rate_monitor_cache';

/** service 是模块级单例，每个用例都要拿一份全新的 */
async function freshService() {
  vi.resetModules();
  const mod = await import('./rateMonitorService');
  return mod.rateMonitorService;
}

function writeCache(raw: unknown): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify(raw));
}

function readCache(): RateCacheData {
  return JSON.parse(localStorage.getItem(CACHE_KEY)!);
}

const V1_WITH_PYTH_RATES = {
  version: 'v1',
  timestamp: 1_700_000_000_000,
  rates: {
    USDT: {
      USD: { stablecoin: 'USDT', fiat: 'USD', rate: 1, updatedAt: 1, source: 'pyth' },
      CNY: { stablecoin: 'USDT', fiat: 'CNY', rate: 7.1, updatedAt: 1, source: 'calculated' },
      JPY: null,
      KRW: null,
    },
    USDC: { USD: null, CNY: null, JPY: null, KRW: null },
  },
  selection: { stablecoin: 'USDC', fiat: 'JPY', swapped: true },
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RateMonitor 缓存版本迁移', () => {
  it('旧 v1 缓存的 rates 一律作废，只迁移 selection', async () => {
    writeCache(V1_WITH_PYTH_RATES);

    const service = await freshService();

    expect(service.getSelection()).toEqual({ stablecoin: 'USDC', fiat: 'JPY', swapped: true });
    expect(service.getRate('USDT', 'CNY')).toBeNull();
    expect(service.getRate('USDT', 'USD')).toBeNull();
  });

  it('迁移结果幂等写回 v2，重开不会反复迁移', async () => {
    writeCache(V1_WITH_PYTH_RATES);
    await freshService();

    const migrated = readCache();
    expect(migrated.version).toBe('v2');
    expect(JSON.stringify(migrated)).not.toContain('pyth');
    expect(migrated.selection).toEqual({ stablecoin: 'USDC', fiat: 'JPY', swapped: true });

    const service = await freshService();
    expect(service.getSelection().fiat).toBe('JPY');
    expect(readCache().version).toBe('v2');
  });
});

describe('RateMonitor 状态语义', () => {
  it('从缓存恢复时是 stale，不能显示成 live', async () => {
    writeCache({
      version: 'v2',
      timestamp: Date.now() - 7 * 24 * 3600 * 1000,
      rates: {
        USDT: {
          USD: { stablecoin: 'USDT', fiat: 'USD', rate: 1, updatedAt: 1, source: 'coingecko' },
          CNY: { stablecoin: 'USDT', fiat: 'CNY', rate: 7.1, updatedAt: 1, source: 'coingecko' },
          JPY: null,
          KRW: null,
        },
        USDC: { USD: null, CNY: null, JPY: null, KRW: null },
      },
      selection: { stablecoin: 'USDT', fiat: 'CNY', swapped: false },
    });

    const service = await freshService();

    expect(service.getState().status).toBe('stale');
    expect(service.getRate('USDT', 'CNY')?.rate).toBe(7.1);
  });

  it('本轮 CoinGecko 刷新成功后才转 live', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          tether: { usd: 1, cny: 7.2, jpy: 150, krw: 1300 },
          'usd-coin': { usd: 1, cny: 7.2, jpy: 150, krw: 1300 },
        }),
      ),
    );

    const service = await freshService();
    await service.fetchData();

    expect(service.getState().status).toBe('live');
    expect(service.getRate('USDT', 'CNY')?.rate).toBe(7.2);
    expect(service.getRate('USDT', 'CNY')?.source).toBe('coingecko');
  });

  it('CoinGecko 与 Upbit 都失败时是 error，不是 live', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

    const service = await freshService();
    await service.fetchData();

    expect(service.getState().status).toBe('error');
  });

  it('CoinGecko 挂掉但 Upbit 补上 KRW 时标 degraded', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('coingecko')) throw new Error('down');
      return new Response(JSON.stringify([{ market: 'KRW-USDT', trade_price: 1400 }]));
    });

    const service = await freshService();
    await service.fetchData();

    expect(service.getState().status).toBe('degraded');
    expect(service.getRate('USDT', 'KRW')?.rate).toBe(1400);
  });
});
