/**
 * Rate Monitor 服务
 *
 * 数据源:
 * 1. CoinGecko (主源，一次获取所有法币)
 * 2. Upbit (仅补 KRW-USDT/USDC)
 *
 * CoinGecko 失败且 JPY/CNY 没有新值时保留上一轮缓存并标记 degraded，
 * 绝不把「缺少数据」伪装成 live。
 *
 * 缓存策略:
 * - 使用 localStorage 持久化
 * - 缓存只用于立即渲染，不影响数据获取时机
 * - 组件加载时立即请求 + 每 X 分钟轮询
 */

import type {
  Stablecoin,
  FiatCurrency,
  ExchangeRate,
  AllRates,
  RateStatus,
  RateDataState,
  UserSelection,
  RateCacheData,
  RateUpdateCallback,
  CoinGeckoSimplePriceResponse,
  UpbitTickerResponse,
} from './types';

// ==================== 配置常量 ====================

/** localStorage 缓存键 */
const CACHE_KEY = 'rate_monitor_cache';

/** 缓存版本号 */
const CACHE_VERSION = 'v1';

/** 默认轮询间隔 (毫秒) - 10 分钟 */
const DEFAULT_POLL_INTERVAL = 10 * 60 * 1000;

/** API 端点 */
const COINGECKO_API = 'https://api.coingecko.com/api/v3/simple/price';
const UPBIT_API = 'https://api.upbit.com/v1/ticker';

// ==================== 工具函数 ====================

/** 创建空的汇率数据结构 */
function createEmptyRates(): AllRates {
  return {
    USDT: { USD: null, CNY: null, JPY: null, KRW: null },
    USDC: { USD: null, CNY: null, JPY: null, KRW: null },
  };
}

/** 创建默认用户选择 */
function createDefaultSelection(): UserSelection {
  return {
    stablecoin: 'USDT',
    fiat: 'CNY',
    swapped: false,
  };
}

// ==================== 缓存管理 ====================

/** 从 localStorage 读取缓存 */
function getCache(): RateCacheData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;

    const data: RateCacheData = JSON.parse(raw);
    if (data.version !== CACHE_VERSION) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }

    return data;
  } catch (error) {
    console.error('[RateMonitor] Cache read error:', error);
    return null;
  }
}

/** 写入 localStorage 缓存 */
function setCache(rates: AllRates, selection: UserSelection): void {
  try {
    const data: RateCacheData = {
      version: CACHE_VERSION,
      timestamp: Date.now(),
      rates,
      selection,
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error('[RateMonitor] Cache write error:', error);
  }
}

// ==================== 数据获取 - 方案A: CoinGecko ====================

async function fetchFromCoinGecko(): Promise<AllRates | null> {
  try {
    const url = `${COINGECKO_API}?ids=tether,usd-coin&vs_currencies=usd,cny,jpy,krw`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data: CoinGeckoSimplePriceResponse = await response.json();
    const now = Date.now();
    const rates = createEmptyRates();

    // 解析 USDT (tether)
    if (data.tether) {
      const t = data.tether;
      if (t.usd !== undefined) {
        rates.USDT.USD = {
          stablecoin: 'USDT',
          fiat: 'USD',
          rate: t.usd,
          updatedAt: now,
          source: 'coingecko',
        };
      }
      if (t.cny !== undefined) {
        rates.USDT.CNY = {
          stablecoin: 'USDT',
          fiat: 'CNY',
          rate: t.cny,
          updatedAt: now,
          source: 'coingecko',
        };
      }
      if (t.jpy !== undefined) {
        rates.USDT.JPY = {
          stablecoin: 'USDT',
          fiat: 'JPY',
          rate: t.jpy,
          updatedAt: now,
          source: 'coingecko',
        };
      }
      if (t.krw !== undefined) {
        rates.USDT.KRW = {
          stablecoin: 'USDT',
          fiat: 'KRW',
          rate: t.krw,
          updatedAt: now,
          source: 'coingecko',
        };
      }
    }

    // 解析 USDC (usd-coin)
    if (data['usd-coin']) {
      const u = data['usd-coin'];
      if (u.usd !== undefined) {
        rates.USDC.USD = {
          stablecoin: 'USDC',
          fiat: 'USD',
          rate: u.usd,
          updatedAt: now,
          source: 'coingecko',
        };
      }
      if (u.cny !== undefined) {
        rates.USDC.CNY = {
          stablecoin: 'USDC',
          fiat: 'CNY',
          rate: u.cny,
          updatedAt: now,
          source: 'coingecko',
        };
      }
      if (u.jpy !== undefined) {
        rates.USDC.JPY = {
          stablecoin: 'USDC',
          fiat: 'JPY',
          rate: u.jpy,
          updatedAt: now,
          source: 'coingecko',
        };
      }
      if (u.krw !== undefined) {
        rates.USDC.KRW = {
          stablecoin: 'USDC',
          fiat: 'KRW',
          rate: u.krw,
          updatedAt: now,
          source: 'coingecko',
        };
      }
    }

    console.log('[RateMonitor] CoinGecko fetch success');
    return rates;
  } catch (error) {
    console.error('[RateMonitor] CoinGecko fetch failed:', error);
    return null;
  }
}

// ==================== 数据获取 - 方案C: Upbit (KRW) ====================

async function fetchKRWFromUpbit(): Promise<{
  USDT: ExchangeRate | null;
  USDC: ExchangeRate | null;
}> {
  const result: { USDT: ExchangeRate | null; USDC: ExchangeRate | null } = {
    USDT: null,
    USDC: null,
  };

  try {
    const url = `${UPBIT_API}?markets=KRW-USDT,KRW-USDC`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    if (!response.ok) {
      throw new Error(`Upbit API error: ${response.status}`);
    }

    const data: UpbitTickerResponse[] = await response.json();
    const now = Date.now();

    for (const ticker of data) {
      // Upbit 返回的是 "1 USDT = X KRW" 的价格
      if (ticker.market === 'KRW-USDT') {
        result.USDT = {
          stablecoin: 'USDT',
          fiat: 'KRW',
          rate: ticker.trade_price,
          updatedAt: now,
          source: 'upbit',
        };
      } else if (ticker.market === 'KRW-USDC') {
        result.USDC = {
          stablecoin: 'USDC',
          fiat: 'KRW',
          rate: ticker.trade_price,
          updatedAt: now,
          source: 'upbit',
        };
      }
    }

    console.log('[RateMonitor] Upbit KRW fetch success');
  } catch (error) {
    console.error('[RateMonitor] Upbit fetch failed:', error);
  }

  return result;
}

// ==================== Rate Monitor 服务类 ====================

class RateMonitorService {
  private callbacks: Set<RateUpdateCallback> = new Set();
  private pollTimer: number | null = null;
  private pollInterval: number = DEFAULT_POLL_INTERVAL;

  private state: RateDataState = {
    status: 'idle',
    rates: createEmptyRates(),
    lastSync: 0,
  };

  private selection: UserSelection = createDefaultSelection();

  constructor() {
    this.loadFromCache();
  }

  /** 从缓存加载数据 */
  private loadFromCache(): void {
    const cache = getCache();
    if (cache) {
      this.state = {
        status: 'live',
        rates: cache.rates,
        lastSync: cache.timestamp,
      };
      this.selection = cache.selection;
      console.log('[RateMonitor] Loaded from cache');
    }
  }

  /** 通知所有订阅者 */
  private notifySubscribers(): void {
    this.callbacks.forEach((cb) => {
      try {
        cb(this.state);
      } catch (error) {
        console.error('[RateMonitor] Subscriber callback error:', error);
      }
    });
  }

  /** 订阅数据更新 */
  subscribe(callback: RateUpdateCallback): () => void {
    this.callbacks.add(callback);

    // 立即发送当前状态
    callback(this.state);

    // 如果是第一个订阅者，启动轮询
    if (this.callbacks.size === 1) {
      this.startPolling();
    }

    // 返回取消订阅函数
    return () => {
      this.callbacks.delete(callback);
      if (this.callbacks.size === 0) {
        this.stopPolling();
      }
    };
  }

  /** 启动轮询 */
  private startPolling(): void {
    // 立即获取一次
    this.fetchData();

    // 定时轮询
    this.pollTimer = window.setInterval(() => {
      this.fetchData();
    }, this.pollInterval);

    console.log(`[RateMonitor] Polling started (interval: ${this.pollInterval / 1000}s)`);
  }

  /** 停止轮询 */
  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      console.log('[RateMonitor] Polling stopped');
    }
  }

  /** 获取数据 (主逻辑) */
  async fetchData(): Promise<void> {
    // 设置为同步中状态
    this.state = { ...this.state, status: 'syncing' };
    this.notifySubscribers();

    try {
      // 方案A: 尝试 CoinGecko
      let rates = await fetchFromCoinGecko();

      if (rates) {
        // CoinGecko 成功
        this.state = {
          status: 'live',
          rates,
          lastSync: Date.now(),
        };
      } else {
        // CoinGecko 失败：只有 Upbit 能补 KRW，JPY/CNY 这一轮没有新值就保留缓存
        console.log('[RateMonitor] CoinGecko unavailable, falling back to Upbit (KRW only)');

        rates = this.state.rates;
        const krwRates = await fetchKRWFromUpbit();
        if (krwRates.USDT) rates.USDT.KRW = krwRates.USDT;
        if (krwRates.USDC) rates.USDC.KRW = krwRates.USDC;
        const gotKrw = !!(krwRates.USDT || krwRates.USDC);

        this.state = {
          status: gotKrw ? 'degraded' : 'error',
          rates,
          lastSync: gotKrw ? Date.now() : this.state.lastSync,
          error: gotKrw
            ? 'CoinGecko 不可用，JPY/CNY 为上一轮缓存值'
            : 'CoinGecko 与 Upbit 均不可用',
        };
      }

      // 更新缓存
      setCache(this.state.rates, this.selection);
    } catch (error) {
      console.error('[RateMonitor] Fetch error:', error);
      this.state = {
        ...this.state,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    this.notifySubscribers();
  }

  /** 获取当前选择 */
  getSelection(): UserSelection {
    return { ...this.selection };
  }

  /** 更新用户选择 */
  setSelection(selection: Partial<UserSelection>): void {
    this.selection = { ...this.selection, ...selection };
    setCache(this.state.rates, this.selection);
    // 选择变化不需要通知，UI 层自己管理
  }

  /** 交换显示方向 */
  toggleSwap(): void {
    this.selection.swapped = !this.selection.swapped;
    setCache(this.state.rates, this.selection);
  }

  /** 获取当前状态 */
  getState(): RateDataState {
    return this.state;
  }

  /** 获取指定组合的汇率 */
  getRate(stablecoin: Stablecoin, fiat: FiatCurrency): ExchangeRate | null {
    return this.state.rates[stablecoin][fiat];
  }

  /** 获取显示汇率 (考虑 swap) */
  getDisplayRate(stablecoin: Stablecoin, fiat: FiatCurrency, swapped: boolean): number | null {
    const rate = this.state.rates[stablecoin][fiat];
    if (!rate) return null;

    if (swapped) {
      // 法币 → 稳定币: 1 / rate
      return 1 / rate.rate;
    }
    // 稳定币 → 法币
    return rate.rate;
  }

  /** 设置轮询间隔 (毫秒) */
  setPollInterval(interval: number): void {
    this.pollInterval = interval;
    if (this.pollTimer !== null) {
      this.stopPolling();
      this.startPolling();
    }
  }
}

// 单例导出
export const rateMonitorService = new RateMonitorService();
