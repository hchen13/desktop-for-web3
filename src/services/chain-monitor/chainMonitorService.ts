/**
 * 链上监控数据服务
 * 管理数据获取优先级、缓存和自动刷新
 *
 * 重构说明：
 * - 每条链的每个指标独立更新
 * - 获取失败时保留旧数据
 * - 刷新间隔：10分钟
 */

import type { ChainId, ChainMetrics, BlockTimeDelay, GasPrice, TPS, ActiveAddresses, TVL, DataResult, DataSource } from './types';
import { getBlockTimeDelayRPC, getGasPriceRPC, getTPSRPC } from './rpcClient';
import { getTVLDefiLlama } from './defillamaClient';
import { workerAPI } from './apiClient';

/**
 * localStorage 缓存数据结构
 */
interface CachedMetricsData {
  version: string;
  timestamp: number;
  data: ChainMetrics;
}

const CACHE_VERSION = 'v2';
const CACHE_TTL = 24 * 60 * 60 * 1000;
const REFRESH_INTERVAL = 10 * 60 * 1000;

/**
 * 默认数据源配置
 */
const DEFAULT_DATA_SOURCES: Record<MetricType, DataSource> = {
  blockTimeDelay: 'rpc',
  gasPrice: 'rpc',
  tps: 'worker.dune',
  activeAddresses: 'worker.dune',
  tvl: 'defillama',
} as const;

/**
 * 获取指标的默认数据源
 */
function getDefaultSource(metricType: MetricType, chain: ChainId): DataSource {
  if (metricType === 'tps' && chain === 'sol') {
    return 'rpc';
  }
  return DEFAULT_DATA_SOURCES[metricType];
}

/**
 * 指标类型
 */
type MetricType = 'blockTimeDelay' | 'gasPrice' | 'tps' | 'activeAddresses' | 'tvl';

/**
 * 从 localStorage 读取缓存
 */
function getCacheFromStorage(chain: ChainId): CachedMetricsData | null {
  try {
    const key = `chain_monitor_cache_${chain}`;
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const data: CachedMetricsData = JSON.parse(raw);

    // 检查版本号
    if (data.version !== CACHE_VERSION) {
      localStorage.removeItem(key);
      return null;
    }

    return data;
  } catch (error) {
    console.error(`[ChainMonitor] Cache read error for ${chain}:`, error);
    return null;
  }
}

/**
 * 写入 localStorage 缓存
 */
function setCacheToStorage(chain: ChainId, metrics: ChainMetrics): void {
  try {
    const key = `chain_monitor_cache_${chain}`;
    const data: CachedMetricsData = {
      version: CACHE_VERSION,
      timestamp: Date.now(),
      data: metrics,
    };
    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.error(`[ChainMonitor] Cache write error for ${chain}:`, error);
  }
}

/**
 * 检查缓存是否有效（在保质期内）
 */
function isCacheValid(cache: CachedMetricsData): boolean {
  const now = Date.now();
  return (now - cache.timestamp) < CACHE_TTL;
}

/**
 * 链上监控服务
 */
class ChainMonitorService {
  private cache = new Map<ChainId, ChainMetrics>();
  private refreshTimers = new Map<string, number>(); // key: `${chain}_${metric}`
  private subscribers = new Map<ChainId, Set<(data: ChainMetrics) => void>>();
  private globalAutoRefreshStarted = false;
  private readonly allChains: ChainId[] = ['btc', 'eth', 'sol', 'bsc', 'polygon'];
  private workerLastRequest = new Map<string, number>(); // key: `${chain}_${metric}`
  private readonly workerMinInterval = 10 * 60 * 1000; // 10 minutes

  /**
   * 迁移旧数据，确保所有指标都有 source 字段
   */
  private migrateMetrics(chain: ChainId, metrics: ChainMetrics): ChainMetrics {
    const migrated = { ...metrics };
    const metricsList: (keyof ChainMetrics)[] = ['blockTimeDelay', 'gasPrice', 'tps', 'activeAddresses', 'tvl'];

    for (const metric of metricsList) {
      const value = migrated[metric];
      if (value && typeof value === 'object' && 'source' in value && !value.source) {
        (value as any).source = getDefaultSource(metric as MetricType, chain);
      }
    }

    return migrated;
  }

  /**
   * 从 localStorage 恢复缓存
   */
  private restoreCacheFromStorage(): void {
    const chains: ChainId[] = ['btc', 'eth', 'sol', 'bsc', 'polygon'];
    for (const chain of chains) {
      const cached = getCacheFromStorage(chain);
      if (cached && isCacheValid(cached)) {
        const migrated = this.migrateMetrics(chain, cached.data);
        this.cache.set(chain, migrated);
        if (migrated !== cached.data) {
          setCacheToStorage(chain, migrated);
        }
        this.notifySubscribers(chain, migrated);
      }
    }
  }

  constructor() {
    // 初始化时从 localStorage 恢复缓存
    this.restoreCacheFromStorage();
    // 启动全链路轮询（与 UI 状态解耦）
    this.startAllAutoRefresh();
  }

  /**
   * 获取指定链的现有数据（如果不存在则创建空结构）
   */
  private getOrCreateMetrics(chain: ChainId): ChainMetrics {
    const existing = this.cache.get(chain);
    if (existing) {
      return existing;
    }
    return {
      chain,
      blockTimeDelay: null,
      gasPrice: null,
      tps: null,
      activeAddresses: null,
      tvl: null,
      lastUpdate: Date.now(),
    };
  }

  /**
   * 更新单个指标（保留其他指标不变）
   */
  private updateMetric(chain: ChainId, metricType: MetricType, data: any): void {
    const existing = this.getOrCreateMetrics(chain);

    if (!data) {
      const updated: ChainMetrics = {
        ...existing,
        [metricType]: null,
        lastUpdate: Date.now(),
      };
      this.cache.set(chain, updated);
      setCacheToStorage(chain, updated);
      this.notifySubscribers(chain, updated);
      return;
    }

    if (!data.source) {
      data.source = getDefaultSource(metricType, chain);
    }

    const updated: ChainMetrics = {
      ...existing,
      [metricType]: data,
      lastUpdate: Date.now(),
    };
    this.cache.set(chain, updated);
    setCacheToStorage(chain, updated);
    this.notifySubscribers(chain, updated);
  }

  /**
   * 指标获取器映射
   */
  private readonly metricFetchers: Record<MetricType, (chain: ChainId) => Promise<DataResult<any>>> = {
    blockTimeDelay: (chain) => this.getBlockTimeDelayWithPriority(chain),
    gasPrice: (chain) => this.getGasPriceWithPriority(chain),
    tps: (chain) => this.getTPSWithPriority(chain),
    activeAddresses: (chain) => this.getActiveAddressesWithPriority(chain),
    tvl: (chain) => this.getTVLWithPriority(chain),
  };

  /**
   * 通用指标获取函数
   */
  private async fetchMetric(chain: ChainId, metricType: MetricType): Promise<void> {
    try {
      const fetcher = this.metricFetchers[metricType];
      const result = await fetcher(chain);
      if (result.data) {
        this.updateMetric(chain, metricType, result.data);
        console.log(`[ChainMonitor] ${chain} ${metricType} updated`);
      }
    } catch (error) {
      console.debug(`[ChainMonitor] ${chain} ${metricType} fetch failed, keeping old data`);
    }
  }

  /**
   * 通用优先级执行器
   */
  private async executeWithPriority<T extends { source?: DataSource }>(
    chain: ChainId,
    metricName: string,
    options: {
      primaryFn?: () => Promise<T | null>;
      fallbackFn?: () => Promise<{ data?: any } | null>;
      primaryDefaultSource?: DataSource;
      fallbackDefaultSource?: DataSource;
    }
  ): Promise<DataResult<T>> {
    const { primaryFn, fallbackFn, primaryDefaultSource, fallbackDefaultSource } = options;

    const shouldUseWorker = (metric: string, source?: DataSource) => {
      if (!source || !source.startsWith('worker.')) return true;
      const key = `${chain}_${metric}`;
      const last = this.workerLastRequest.get(key) || 0;
      const now = Date.now();
      if (now - last < this.workerMinInterval) {
        return false;
      }
      this.workerLastRequest.set(key, now);
      return true;
    };

    const retryRpc = async (fn: () => Promise<T | null>, attempts = 3): Promise<T | null> => {
      let lastError: unknown;
      for (let i = 0; i < attempts; i += 1) {
        try {
          return await fn();
        } catch (error) {
          lastError = error;
          const delay = 500 * Math.pow(2, i);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      if (lastError) {
        throw lastError;
      }
      return null;
    };

    // 优先级1: 主要数据源（RPC 或 API）
    if (primaryFn) {
      try {
        const data = primaryDefaultSource === 'rpc'
          ? await retryRpc(primaryFn)
          : await primaryFn();
        if (data) {
          if (!data.source && primaryDefaultSource) {
            data.source = primaryDefaultSource;
          }
          return { data, source: data.source || primaryDefaultSource };
        }
      } catch (error) {
        console.log(`[ChainMonitor] Primary failed for ${chain} ${metricName}, trying fallback`);
      }
    }

    // 优先级2: 备用数据源（Worker API）
    if (fallbackFn && shouldUseWorker(metricName, fallbackDefaultSource)) {
      try {
        const response = await fallbackFn();
        if (response?.data) {
          if (!response.data.source && fallbackDefaultSource) {
            response.data.source = fallbackDefaultSource;
          }
          return { data: response.data as T, source: (response.data.source || fallbackDefaultSource) as DataSource };
        }
      } catch (error) {
        console.log(`[ChainMonitor] Fallback failed for ${chain} ${metricName}`);
      }
    }

    return { data: null, source: null, error: new Error('All data sources failed') };
  }

  private async getBlockTimeDelayWithPriority(chain: ChainId): Promise<DataResult<BlockTimeDelay>> {
    return this.executeWithPriority(chain, 'blockTimeDelay', {
      primaryFn: () => getBlockTimeDelayRPC(chain),
      fallbackFn: () => workerAPI.blockchainMonitor.getBlockTimeDelay(chain),
      primaryDefaultSource: 'rpc',
      fallbackDefaultSource: 'worker.rpc',
    });
  }

  private async getGasPriceWithPriority(chain: ChainId): Promise<DataResult<GasPrice>> {
    return this.executeWithPriority(chain, 'gasPrice', {
      primaryFn: () => getGasPriceRPC(chain),
      fallbackFn: () => workerAPI.blockchainMonitor.getGasPrice(chain),
      primaryDefaultSource: 'rpc',
      fallbackDefaultSource: 'worker.rpc',
    });
  }

  private async getTPSWithPriority(chain: ChainId): Promise<DataResult<TPS>> {
    return this.executeWithPriority(chain, 'TPS', {
      primaryFn: chain === 'sol' ? () => getTPSRPC(chain) : undefined,
      fallbackFn: () => workerAPI.blockchainMonitor.getTPS(chain),
      primaryDefaultSource: 'rpc',
      fallbackDefaultSource: chain === 'sol' ? 'worker.rpc' : 'worker.dune',
    });
  }

  private async getActiveAddressesWithPriority(chain: ChainId): Promise<DataResult<ActiveAddresses>> {
    return this.executeWithPriority(chain, 'activeAddresses', {
      fallbackFn: () => workerAPI.blockchainMonitor.getActiveAddresses(chain),
      fallbackDefaultSource: 'worker.dune',
    });
  }

  private async getTVLWithPriority(chain: ChainId): Promise<DataResult<TVL>> {
    return this.executeWithPriority(chain, 'TVL', {
      primaryFn: () => getTVLDefiLlama(chain),
      fallbackFn: () => workerAPI.blockchainMonitor.getTVL(chain),
      primaryDefaultSource: 'defillama',
      fallbackDefaultSource: 'worker.defillama',
    });
  }

  /**
   * 启动单个指标的定时刷新
   */
  private startMetricRefresh(chain: ChainId, metricType: MetricType): void {
    const timerKey = `${chain}_${metricType}`;

    // 清除已有的定时器
    this.stopMetricRefresh(chain, metricType);

    // 立即执行一次
    this.fetchMetric(chain, metricType).catch(err => {
      console.error(`[ChainMonitor] Initial fetch failed for ${chain} ${metricType}:`, err);
    });

    // 设置定时刷新
    const intervalId = window.setInterval(() => {
      this.fetchMetric(chain, metricType).catch(err => {
        console.error(`[ChainMonitor] Refresh failed for ${chain} ${metricType}:`, err);
      });
    }, REFRESH_INTERVAL);

    this.refreshTimers.set(timerKey, intervalId);
    console.log(`[ChainMonitor] Started ${chain} ${metricType} refresh, interval: ${REFRESH_INTERVAL / 1000}s`);
  }

  /**
   * 停止单个指标的定时刷新
   */
  private stopMetricRefresh(chain: ChainId, metricType: MetricType): void {
    const timerKey = `${chain}_${metricType}`;
    const intervalId = this.refreshTimers.get(timerKey);
    if (intervalId) {
      clearInterval(intervalId);
      this.refreshTimers.delete(timerKey);
    }
  }

  /**
   * 停止指定链的所有指标刷新
   */
  private stopChainRefresh(chain: ChainId): void {
    const metrics: MetricType[] = ['blockTimeDelay', 'gasPrice', 'tps', 'activeAddresses', 'tvl'];
    for (const metric of metrics) {
      this.stopMetricRefresh(chain, metric);
    }
  }

  /**
   * 检查数据是否新鲜（10分钟保质期）
   */
  private isDataFresh(metrics: ChainMetrics): boolean {
    const now = Date.now();
    const age = now - metrics.lastUpdate;
    return age < REFRESH_INTERVAL;
  }

  /**
   * 获取链的所有指标（兼容旧接口）
   */
  async getAllMetrics(chain: ChainId, useCache: boolean = true): Promise<ChainMetrics | null> {
    // 检查缓存
    const cached = this.cache.get(chain);
    if (cached && useCache) {
      // 如果数据新鲜，直接返回，不触发网络请求
      if (this.isDataFresh(cached)) {
        return cached;
      }
      // 数据过期，继续获取新数据
    }

    // 如果没有缓存或数据过期，并发获取所有指标
    const metricTypes: MetricType[] = ['blockTimeDelay', 'gasPrice', 'tps', 'activeAddresses', 'tvl'];
    await Promise.all(metricTypes.map(metric => this.fetchMetric(chain, metric)));

    return this.cache.get(chain) || null;
  }

  /**
   * 获取缓存的指标数据
   */
  getCachedMetrics(chain: ChainId): ChainMetrics | null {
    return this.cache.get(chain) || null;
  }

  /**
   * 订阅数据更新
   */
  subscribe(chain: ChainId, callback: (data: ChainMetrics) => void): () => void {
    if (!this.subscribers.has(chain)) {
      this.subscribers.set(chain, new Set());
    }
    this.subscribers.get(chain)!.add(callback);

    // 如果已有缓存数据，立即通知
    const cached = this.cache.get(chain);
    if (cached) {
      callback(cached);
    }

    // 返回取消订阅函数
    return () => {
      this.subscribers.get(chain)?.delete(callback);
    };
  }

  /**
   * 通知订阅者
   */
  private notifySubscribers(chain: ChainId, data: ChainMetrics): void {
    const subscribers = this.subscribers.get(chain);
    if (subscribers) {
      subscribers.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`[ChainMonitor] Subscriber callback error:`, error);
        }
      });
    }
  }

  /**
   * 启动自动刷新（指定链的所有指标）
   */
  startAutoRefresh(chain: ChainId, interval?: number): void {
    // 清除已有间隔
    this.stopChainRefresh(chain);

    const metrics: MetricType[] = ['blockTimeDelay', 'gasPrice', 'tps', 'activeAddresses', 'tvl'];

    // 为每个指标启动独立的定时器
    // 错开启动时间，避免同时请求
    metrics.forEach((metric, index) => {
      setTimeout(() => {
        this.startMetricRefresh(chain, metric);
      }, index * 1000); // 每个指标间隔 1 秒启动
    });

    console.log(`[ChainMonitor] Auto refresh started for ${chain}`);
  }

  /**
   * 启动所有链的自动刷新（全局一次性）
   */
  private startAllAutoRefresh(): void {
    if (this.globalAutoRefreshStarted) return;
    this.globalAutoRefreshStarted = true;

    // 错开每条链启动，避免瞬时打满请求
    this.allChains.forEach((chain, chainIndex) => {
      setTimeout(() => {
        this.startAutoRefresh(chain);
      }, chainIndex * 1500);
    });

    console.log('[ChainMonitor] Global auto refresh started for all chains');
  }

  /**
   * 停止自动刷新
   */
  stopAutoRefresh(chain: ChainId): void {
    this.stopChainRefresh(chain);
    console.log(`[ChainMonitor] Auto refresh stopped for ${chain}`);
  }

  /**
   * 清理所有资源
   */
  cleanup(): void {
    this.refreshTimers.forEach(intervalId => clearInterval(intervalId));
    this.refreshTimers.clear();
    this.subscribers.clear();
    this.cache.clear();
    this.globalAutoRefreshStarted = false;
  }
}

// 单例
export const chainMonitorService = new ChainMonitorService();
