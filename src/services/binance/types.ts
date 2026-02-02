/**
 * Binance API 类型定义
 */

// ==================== 连接状态 ====================

/**
 * 连接状态
 */
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

// ==================== WebSocket Stream ====================

/**
 * 精简 Ticker 推送数据
 */
export interface MiniTickerStream {
  e: string;              // 事件类型: 24hrMiniTicker
  E: number;              // 事件时间
  s: string;              // 交易对: BTCUSDT
  c: string;              // 最新成交价
  o: string;              // 24h 开盘价
  h: string;              // 24h 最高价
  l: string;              // 24h 最低价
  v: string;              // 成交量
  q: string;              // 成交额
}

// ==================== 业务类型 ====================

/**
 * 币种配置
 */
export interface WatchlistCoinConfig {
  symbol: string;         // Binance 交易对，如：BTCUSDT
  baseAsset: string;      // 基础资产，如：BTC
  name: string;           // 币种全名
  logoUrl?: string;       // 币种 Logo URL（可选）
}

/**
 * 价格数据
 */
export interface PriceData {
  symbol: string;         // 交易对
  baseAsset: string;      // 基础资产
  name: string;           // 币种全名
  price: number;          // 最新价格（数值，用于计算）
  priceString: string;    // 最新价格（原始字符串，保留 Binance 精度）
  change24h: number;      // 24h 涨跌幅（百分比）
  lastUpdate: number;     // 最后更新时间戳
}

/**
 * 价格更新回调
 */
export type PriceUpdateCallback = (data: PriceData) => void;
