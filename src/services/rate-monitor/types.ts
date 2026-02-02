/**
 * Rate Monitor 服务类型定义
 * 
 * 支持的货币组合：
 * - 稳定币: USDT, USDC
 * - 法币: USD, CNY, JPY, KRW
 * - 共 8 种组合 (2 x 4)
 */

/** 稳定币类型 */
export type Stablecoin = 'USDT' | 'USDC';

/** 法币类型 */
export type FiatCurrency = 'USD' | 'CNY' | 'JPY' | 'KRW';

/** 汇率数据 */
export interface ExchangeRate {
  stablecoin: Stablecoin;
  fiat: FiatCurrency;
  /** 1 稳定币 = rate 法币 */
  rate: number;
  /** 数据更新时间 (timestamp) */
  updatedAt: number;
  /** 数据来源 */
  source: 'coingecko' | 'upbit' | 'pyth' | 'calculated';
}

/** 所有汇率数据 (8 种组合) */
export interface AllRates {
  USDT: Record<FiatCurrency, ExchangeRate | null>;
  USDC: Record<FiatCurrency, ExchangeRate | null>;
}

/** 服务状态 */
export type RateStatus = 'idle' | 'syncing' | 'live' | 'error';

/** 服务数据状态 */
export interface RateDataState {
  status: RateStatus;
  rates: AllRates;
  lastSync: number;
  error?: string;
}

/** 用户选择 (持久化到 localStorage) */
export interface UserSelection {
  stablecoin: Stablecoin;
  fiat: FiatCurrency;
  /** true = 显示 法币→稳定币, false = 显示 稳定币→法币 */
  swapped: boolean;
}

/** 缓存数据结构 */
export interface RateCacheData {
  version: string;
  timestamp: number;
  rates: AllRates;
  selection: UserSelection;
}

/** 数据更新回调 */
export type RateUpdateCallback = (state: RateDataState) => void;

/** CoinGecko API 响应 */
export interface CoinGeckoSimplePriceResponse {
  tether?: {
    usd?: number;
    cny?: number;
    jpy?: number;
    krw?: number;
  };
  'usd-coin'?: {
    usd?: number;
    cny?: number;
    jpy?: number;
    krw?: number;
  };
}

/** Upbit Ticker 响应 */
export interface UpbitTickerResponse {
  market: string;
  trade_price: number;
  // ... 其他字段省略
}

/** Pyth Hermes 价格响应 */
export interface PythPriceResponse {
  parsed?: Array<{
    id: string;
    price: {
      price: string;
      expo: number;
      publish_time: number;
    };
  }>;
}
