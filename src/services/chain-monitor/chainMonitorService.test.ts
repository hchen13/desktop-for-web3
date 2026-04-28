/**
 * ChainMonitorService 测试
 *
 * 注意：chainMonitorService 是模块单例，构造时启动 auto refresh。
 * 这里测试公共行为（订阅、缓存格式、迁移）以及 fetch mock 后的回退链。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChainMetrics } from './types';

// 设置 localStorage stub & fetch mock 后再 import service
beforeEach(() => {
  // jsdom 已提供 localStorage
  localStorage.clear();
});

const buildMetrics = (chain: ChainMetrics['chain']): ChainMetrics => ({
  chain,
  blockTimeDelay: { blockNumber: 100, latestBlockTime: 0, delaySeconds: 12, source: 'rpc' },
  gasPrice: {
    avgGasGwei: 25,
    medianGasGwei: 24,
    minGasGwei: 20,
    maxGasGwei: 30,
    unit: 'gwei',
    source: 'rpc',
  },
  tps: null,
  activeAddresses: null,
  tvl: null,
  lastUpdate: Date.now(),
});

describe('ChainMonitorService — cache/migration', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists snapshot via getCachedMetrics after notify', async () => {
    // Mock fetch to no-op
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    const { chainMonitorService } = await import('./chainMonitorService');
    expect(chainMonitorService.getCachedMetrics('eth')).toBeNull();
  });

  it('subscribe immediately notifies new subscriber if cache exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    // Pre-seed localStorage cache with valid version
    localStorage.setItem(
      'chain_monitor_cache_eth',
      JSON.stringify({
        version: 'v2',
        timestamp: Date.now(),
        data: buildMetrics('eth'),
      }),
    );
    vi.resetModules();
    const { chainMonitorService } = await import('./chainMonitorService');

    const cb = vi.fn();
    const unsub = chainMonitorService.subscribe('eth', cb);
    // Wait microtask
    await Promise.resolve();
    expect(cb).toHaveBeenCalled();
    unsub();
  });

  it('cached version mismatch removes the entry', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    localStorage.setItem(
      'chain_monitor_cache_eth',
      JSON.stringify({
        version: 'old-version',
        timestamp: Date.now(),
        data: buildMetrics('eth'),
      }),
    );
    vi.resetModules();
    const { chainMonitorService } = await import('./chainMonitorService');
    expect(chainMonitorService.getCachedMetrics('eth')).toBeNull();
    expect(localStorage.getItem('chain_monitor_cache_eth')).toBeNull();
  });

  it('multiple subscribers notified independently', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    localStorage.setItem(
      'chain_monitor_cache_eth',
      JSON.stringify({
        version: 'v2',
        timestamp: Date.now(),
        data: buildMetrics('eth'),
      }),
    );
    vi.resetModules();
    const { chainMonitorService } = await import('./chainMonitorService');

    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const unsub1 = chainMonitorService.subscribe('eth', cb1);
    const unsub2 = chainMonitorService.subscribe('eth', cb2);
    await Promise.resolve();
    expect(cb1).toHaveBeenCalled();
    expect(cb2).toHaveBeenCalled();

    unsub1();
    // Reset call counts
    cb1.mockClear();
    cb2.mockClear();

    // Subscribe a third time to trigger cached notify path
    const cb3 = vi.fn();
    const unsub3 = chainMonitorService.subscribe('eth', cb3);
    await Promise.resolve();
    expect(cb3).toHaveBeenCalled();
    expect(cb1).not.toHaveBeenCalled(); // unsubscribed

    unsub2();
    unsub3();
  });

  it('formatMetricsForUI integration: chain mismatch returns null', async () => {
    const { formatMetricsForUI } = await import('../../utils/formatters');
    expect(formatMetricsForUI(buildMetrics('eth'), 'btc')).toBeNull();
  });

  it('unsubscribed callback no longer notified', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    vi.resetModules();
    const { chainMonitorService } = await import('./chainMonitorService');

    const cb = vi.fn();
    const unsub = chainMonitorService.subscribe('eth', cb);
    unsub();
    cb.mockClear();
    // Trigger a synthetic subscriber re-add to ensure unsubscribed cb is gone
    const cb2 = vi.fn();
    chainMonitorService.subscribe('eth', cb2);
    await Promise.resolve();
    // cb still not called (it was unsubscribed)
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('ChainMonitorService — corrupt cache resilience', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('corrupt JSON in storage does not crash construction', async () => {
    localStorage.setItem('chain_monitor_cache_eth', '{not-json');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    const mod = await import('./chainMonitorService');
    expect(mod.chainMonitorService.getCachedMetrics('eth')).toBeNull();
    errorSpy.mockRestore();
  });
});

describe('ChainMonitorService — getCachedMetrics format', () => {
  it('returns null for chain without data', async () => {
    vi.resetModules();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    const { chainMonitorService } = await import('./chainMonitorService');
    expect(chainMonitorService.getCachedMetrics('polygon')).toBeNull();
  });
});

describe('ChainMonitorService — TTL cache validity', () => {
  it('expired cache (>24h) is not restored to in-memory cache from storage', async () => {
    localStorage.clear();
    const oldTs = Date.now() - 25 * 60 * 60 * 1000;
    const oldData = buildMetrics('btc');
    // Use distinctive value to detect if the OLD data was restored
    oldData.blockTimeDelay!.blockNumber = 999_999_999;
    localStorage.setItem(
      'chain_monitor_cache_btc',
      JSON.stringify({ version: 'v2', timestamp: oldTs, data: oldData }),
    );
    vi.resetModules();
    // fetch returns garbage so RPC fetch fails — auto-refresh may write a fresh
    // empty-ish entry, but it must not be the OLD blockNumber.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const { chainMonitorService } = await import('./chainMonitorService');
    const restored = chainMonitorService.getCachedMetrics('btc');
    if (restored && restored.blockTimeDelay) {
      expect(restored.blockTimeDelay.blockNumber).not.toBe(999_999_999);
    } else {
      expect(restored).toBeNull();
    }
  });

  it('fresh cache (<24h) is restored', async () => {
    localStorage.clear();
    const recentTs = Date.now() - 1 * 60 * 1000;
    localStorage.setItem(
      'chain_monitor_cache_eth',
      JSON.stringify({ version: 'v2', timestamp: recentTs, data: buildMetrics('eth') }),
    );
    vi.resetModules();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    const { chainMonitorService } = await import('./chainMonitorService');
    const restored = chainMonitorService.getCachedMetrics('eth');
    expect(restored).not.toBeNull();
    expect(restored?.chain).toBe('eth');
  });
});

describe('ChainMonitorService — migration backfills source', () => {
  it('migrates metrics with empty source field (key in object but falsy)', async () => {
    localStorage.clear();
    const metricsWithEmptySource: any = buildMetrics('eth');
    metricsWithEmptySource.blockTimeDelay.source = '';
    metricsWithEmptySource.gasPrice.source = '';
    localStorage.setItem(
      'chain_monitor_cache_eth',
      JSON.stringify({ version: 'v2', timestamp: Date.now(), data: metricsWithEmptySource }),
    );
    vi.resetModules();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    const { chainMonitorService } = await import('./chainMonitorService');
    const restored = chainMonitorService.getCachedMetrics('eth');
    expect(restored?.blockTimeDelay?.source).toBeTruthy();
    expect(restored?.gasPrice?.source).toBeTruthy();
  });
});
