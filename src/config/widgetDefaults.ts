/**
 * Widget Default Settings Configuration
 * 
 * 统一管理各 Widget 组件的默认设置
 * 每个 Widget 实例的设置存储在 GridElement.state.settings 中
 */

import type { Stablecoin, FiatCurrency } from '../services/rate-monitor';

// ============== 类型定义 ==============

/** RateMonitor 设置 */
export interface RateMonitorSettings {
  stablecoin: Stablecoin;
  fiat: FiatCurrency;
  swapped: boolean;
}

/** News 设置 */
export interface NewsSettings {
  source: string;
  filter: string;
}

/** ChainMonitor 设置 */
export interface ChainMonitorSettings {
  selectedChain: string;
}

/** WorldClock 设置 - 存储时区列表 */
export interface WorldClockSettings {
  timezones: string[];  // 时区 ID 列表，如 ['Asia/Shanghai', 'America/New_York', 'Europe/London']
}

/** Calendar 设置 */
export interface CalendarSettings {
  view: 'full' | 'compact';
}

/** Watchlist 币种配置（用于持久化） */
export interface WatchlistCoinSetting {
  symbol: string;       // 交易对，如 BTCUSDT
  baseAsset: string;    // 基础资产，如 BTC
  name: string;         // 币种全名
}

/** Watchlist 设置 */
export interface WatchlistSettings {
  coins: WatchlistCoinSetting[];
}

/** EconMap 设置 */
export interface EconMapSettings {
  // 未来扩展
}

/** 所有 Widget 设置的联合类型 */
export type WidgetSettings =
  | RateMonitorSettings
  | NewsSettings
  | ChainMonitorSettings
  | WorldClockSettings
  | CalendarSettings
  | WatchlistSettings
  | EconMapSettings
  | Record<string, unknown>;

/** Widget state 结构 */
export interface WidgetState {
  settings?: WidgetSettings;
  [key: string]: unknown;
}

// ============== 默认设置 ==============

export const DEFAULT_RATE_MONITOR_SETTINGS: RateMonitorSettings = {
  stablecoin: 'USDT',
  fiat: 'CNY',
  swapped: false,
};

export const DEFAULT_NEWS_SETTINGS: NewsSettings = {
  source: 'blockbeats',
  filter: 'all',
};

export const DEFAULT_CHAIN_MONITOR_SETTINGS: ChainMonitorSettings = {
  selectedChain: 'eth',
};

export const DEFAULT_WORLD_CLOCK_SETTINGS: WorldClockSettings = {
  timezones: ['Asia/Shanghai', 'America/New_York', 'Europe/London'],
};

export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = {
  view: 'full',
};

export const DEFAULT_WATCHLIST_SETTINGS: WatchlistSettings = {
  coins: [
    { symbol: 'BTCUSDT', baseAsset: 'BTC', name: 'Bitcoin' },
    { symbol: 'ETHUSDT', baseAsset: 'ETH', name: 'Ethereum' },
    { symbol: 'SOLUSDT', baseAsset: 'SOL', name: 'Solana' },
    { symbol: 'XRPUSDT', baseAsset: 'XRP', name: 'XRP' },
    { symbol: 'BNBUSDT', baseAsset: 'BNB', name: 'BNB' },
  ],
};

export const DEFAULT_ECON_MAP_SETTINGS: EconMapSettings = {};

// ============== 工具函数 ==============

/**
 * 根据组件类型获取默认设置
 */
export function getDefaultSettings(componentType: string): WidgetSettings {
  switch (componentType) {
    case 'rate-monitor':
      return { ...DEFAULT_RATE_MONITOR_SETTINGS };
    case 'news':
      return { ...DEFAULT_NEWS_SETTINGS };
    case 'chain-monitor':
      return { ...DEFAULT_CHAIN_MONITOR_SETTINGS };
    case 'world-clock':
      return { ...DEFAULT_WORLD_CLOCK_SETTINGS };
    case 'calendar':
      return { ...DEFAULT_CALENDAR_SETTINGS };
    case 'watchlist':
      return { ...DEFAULT_WATCHLIST_SETTINGS };
    case 'econ-map':
      return { ...DEFAULT_ECON_MAP_SETTINGS };
    default:
      return {};
  }
}

/**
 * 获取带有默认设置的 state
 * 如果 state 已有 settings，则合并（已有值优先）
 */
export function getStateWithDefaults(
  componentType: string,
  existingState?: Record<string, unknown>
): WidgetState {
  const defaults = getDefaultSettings(componentType);
  const existingSettings = existingState?.settings as WidgetSettings | undefined;
  
  return {
    ...existingState,
    settings: {
      ...defaults,
      ...existingSettings,
    },
  };
}

/**
 * 创建新 Widget 元素的初始 state
 */
export function createInitialWidgetState(componentType: string): WidgetState {
  return {
    settings: getDefaultSettings(componentType),
  };
}
