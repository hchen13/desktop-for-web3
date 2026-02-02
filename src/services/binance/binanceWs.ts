/**
 * Binance WebSocket 服务
 * 使用精简 Ticker (Mini Ticker) 流推送实时价格
 */

import type { MiniTickerStream, PriceData, PriceUpdateCallback, WatchlistCoinConfig, ConnectionStatus } from './types';

// Binance WebSocket 端点
const WS_PRIMARY_SINGLE_STREAM = 'wss://stream.binance.com:9443/ws';  // 主站单流端点
const WS_PRIMARY_COMBINED_STREAM = 'wss://stream.binance.com:9443/stream';  // 主站组合流端点
const WS_FALLBACK_SINGLE_STREAM = 'wss://stream.binance.us:9443/ws';  // 备用站单流端点
const WS_FALLBACK_COMBINED_STREAM = 'wss://stream.binance.us:9443/stream';  // 备用站组合流端点

// 心跳配置
const HEARTBEAT_INTERVAL = 30000;  // 30秒检查一次数据接收
const DATA_TIMEOUT = 60000;  // 60秒无数据认为连接有问题

/**
 * Binance WebSocket 连接管理器
 */
class BinanceWebSocketManager {
  private ws: WebSocket | null = null;
  private additionalSockets: WebSocket[] = [];
  private callbacks: Set<PriceUpdateCallback> = new Set();
  private reconnectTimer: number | null = null;
  private reconnectDelay = 5000;
  private priceCache: Map<string, PriceData> = new Map();
  private coins: WatchlistCoinConfig[] = [];
  private isConnected = false;
  private hasReceivedData = false;
  private statusChangeCallbacks: Set<(status: ConnectionStatus) => void> = new Set();
  private currentStatus: ConnectionStatus = 'idle';
  // Fallback 相关状态
  private usingFallback = false;  // 当前是否使用备用服务器
  private primaryHasFailed = false;  // 主站是否已失败过
  private fallbackHasFailed = false;  // 备用站是否已失败过
  // 心跳相关
  private heartbeatTimer: number | null = null;
  private lastDataTime: number = 0;  // 上次收到数据的时间

  /**
   * 更新连接状态
   */
  private setStatus(status: ConnectionStatus): void {
    this.currentStatus = status;
    this.statusChangeCallbacks.forEach(cb => cb(status));
  }

  /**
   * 获取当前连接状态
   */
  public getStatus(): ConnectionStatus {
    return this.currentStatus;
  }

  /**
   * 是否已接收到数据
   */
  public hasData(): boolean {
    return this.hasReceivedData;
  }

  /**
   * 订阅连接状态变化
   * 立即回调当前状态，然后监听后续变化
   */
  public onStatusChange(callback: (status: ConnectionStatus) => void): () => void {
    this.statusChangeCallbacks.add(callback);
    // 立即通知当前状态
    try {
      callback(this.currentStatus);
    } catch (error) {
      console.error('[BinanceWS] Status callback error:', error);
    }
    return () => this.statusChangeCallbacks.delete(callback);
  }

  /**
   * 连接 WebSocket
   * @param useFallback 是否使用备用服务器
   */
  private connect(useFallback: boolean = false): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    if (this.coins.length === 0) {
      console.warn('[BinanceWS] No coins to subscribe');
      return;
    }

    // 两个站点都使用组合流 URL
    let url: string;
    const streams = this.coins.map(c => `${c.symbol.toLowerCase()}@miniTicker`).join('/');

    if (useFallback) {
      // binance.us: 使用组合流 URL
      url = `${WS_FALLBACK_COMBINED_STREAM}?streams=${streams}`;
    } else {
      // binance.com: 使用组合流 URL
      url = `${WS_PRIMARY_COMBINED_STREAM}?streams=${streams}`;
    }

    const serverName = useFallback ? 'binance.us (fallback)' : 'binance.com (primary)';
    console.log(`[BinanceWS] Connecting to ${serverName}:`, url);
    this.setStatus('connecting');
    this.usingFallback = useFallback;

    try {
      this.ws = new WebSocket(url);
      this.isConnected = false;

      this.ws.onopen = () => {
        console.log(`[BinanceWS] Connected to ${serverName}`);
        this.isConnected = true;
        this.setStatus('connected');
        this.lastDataTime = Date.now();

        // 启动心跳检查
        this.startHeartbeat();

        // 连接成功，重置失败标记（对于当前使用的服务器）
        if (useFallback) {
          this.fallbackHasFailed = false;
        } else {
          this.primaryHasFailed = false;
        }

        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = (error) => {
        console.error(`[BinanceWS] WebSocket error on ${serverName}:`, error);
        // 标记当前服务器失败
        if (useFallback) {
          this.fallbackHasFailed = true;
        } else {
          this.primaryHasFailed = true;
        }
        // 只有当两个服务器都失败时才设置错误状态
        if (this.primaryHasFailed && this.fallbackHasFailed) {
          this.setStatus('error');
        }
      };

      this.ws.onclose = (event) => {
        console.log(`[BinanceWS] Disconnected from ${serverName}, code:`, event.code, 'reason:', event.reason);
        this.isConnected = false;
        this.stopHeartbeat();  // 停止心跳检查
        // 非正常关闭时标记为错误
        if (event.code !== 1000) {
          if (useFallback) {
            this.fallbackHasFailed = true;
          } else {
            this.primaryHasFailed = true;
          }
          if (this.primaryHasFailed && this.fallbackHasFailed) {
            this.setStatus('error');
          }
        }
        this.scheduleReconnect();
      };
    } catch (error) {
      console.error(`[BinanceWS] Connection error on ${serverName}:`, error);
      if (useFallback) {
        this.fallbackHasFailed = true;
      } else {
        this.primaryHasFailed = true;
      }
      if (this.primaryHasFailed && this.fallbackHasFailed) {
        this.setStatus('error');
      }
      this.scheduleReconnect();
    }
  }

  /**
   * 安排重连
   * 如果主站失败，尝试备用站；如果备用站失败，尝试主站
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    // 决定下一个要连接的服务器
    // 优先尝试未失败的服务器
    let nextUseFallback = this.usingFallback;

    if (!this.usingFallback && this.primaryHasFailed && !this.fallbackHasFailed) {
      // 主站失败，尝试备用站
      nextUseFallback = true;
      console.log('[BinanceWS] Primary failed, trying fallback...');
    } else if (this.usingFallback && this.fallbackHasFailed && !this.primaryHasFailed) {
      // 备用站失败，尝试主站
      nextUseFallback = false;
      console.log('[BinanceWS] Fallback failed, trying primary...');
    } else if (this.primaryHasFailed && this.fallbackHasFailed) {
      // 两者都失败，仍然尝试重连（可能只是临时网络问题）
      // 轮流尝试
      nextUseFallback = !this.usingFallback;
    }

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      const serverName = nextUseFallback ? 'binance.us (fallback)' : 'binance.com (primary)';
      console.log(`[BinanceWS] Attempting to reconnect to ${serverName}...`);
      this.connect(nextUseFallback);
    }, this.reconnectDelay);
  }

  /**
   * 处理收到的消息
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // 检查是否是订阅确认消息（用于显式订阅方式）
      if ('result' in message && 'id' in message) {
        return;
      }

      // 检查是否是错误消息
      if ('error' in message) {
        console.error('[BinanceWS] Subscription error:', message.error);
        return;
      }

      // Binance 组合流返回的数据格式是 { stream: "...", data: {...} }
      const ticker: MiniTickerStream = message.data || message;

      // 验证事件类型
      if (ticker?.e !== '24hrMiniTicker') {
        return;
      }

      this.processTicker(ticker);
    } catch (error) {
      console.error('[BinanceWS] Failed to parse message:', data, error);
    }
  }

  /**
   * 处理 Ticker 数据
   */
  private processTicker(ticker: MiniTickerStream): void {
    const symbol = ticker.s;

    const price = parseFloat(ticker.c);
    const priceString = ticker.c;  // 保留 Binance 原始价格字符串
    const openPrice = parseFloat(ticker.o);
    const change24h = (price / openPrice - 1) * 100;

    // 查找对应的币种配置
    const coin = this.coins.find(c => c.symbol === symbol);
    if (!coin) {
      return;
    }

    const priceData: PriceData = {
      symbol,
      baseAsset: coin.baseAsset,
      name: coin.name,
      price,
      priceString,
      change24h,
      lastUpdate: ticker.E, // 使用 WebSocket 事件时间作为时间戳
    };

    // 标记已接收数据并更新最后数据时间
    if (!this.hasReceivedData) {
      this.hasReceivedData = true;
    }
    this.lastDataTime = Date.now();  // 更新心跳时间戳

    // 使用时间戳比较更新缓存
    this.updatePriceCache(symbol, priceData);

    // 通知所有订阅者
    this.callbacks.forEach(callback => {
      try {
        callback(priceData);
      } catch (error) {
        console.error('[BinanceWS] Callback error:', error);
      }
    });
  }

  /**
   * 更新价格缓存（带时间戳比较）
   * 如果缓存中不存在该 symbol，直接写入
   * 如果存在，比较时间戳，只保留较新的数据
   */
  private updatePriceCache(symbol: string, newData: PriceData): void {
    const existing = this.priceCache.get(symbol);
    if (!existing || newData.lastUpdate > existing.lastUpdate) {
      this.priceCache.set(symbol, newData);
    }
  }

  /**
   * 批量更新价格缓存（用于 REST API 初始数据）
   * 根据时间戳比较，只保留较新的数据
   */
  public updatePriceCacheBatch(prices: PriceData[]): void {
    prices.forEach(priceData => {
      this.updatePriceCache(priceData.symbol, priceData);
    });
    // 批量更新时也更新心跳时间（如果有数据）
    if (prices.length > 0) {
      this.lastDataTime = Date.now();
    }
  }

  /**
   * 启动心跳检查
   * 定期检查是否收到数据，超时则重连
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();  // 清除旧的定时器

    this.heartbeatTimer = window.setInterval(() => {
      const now = Date.now();
      const timeSinceLastData = now - this.lastDataTime;

      if (timeSinceLastData > DATA_TIMEOUT) {
        console.warn(`[BinanceWS] No data received for ${timeSinceLastData / 1000}s, reconnecting...`);
        // 断开并重连
        if (this.ws) {
          this.ws.close();
        }
      }
    }, HEARTBEAT_INTERVAL);

    console.log(`[BinanceWS] Heartbeat started (interval: ${HEARTBEAT_INTERVAL}ms, timeout: ${DATA_TIMEOUT}ms)`);
  }

  /**
   * 停止心跳检查
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      console.log('[BinanceWS] Heartbeat stopped');
    }
  }

  /**
   * 订阅币种价格更新
   * 注意：不会在回调清空时自动关闭连接，以保持连接的持续性
   * 这允许组件在拖动、重新挂载时不会丢失数据连接
   */
  public subscribe(coins: WatchlistCoinConfig[], callback: PriceUpdateCallback): () => void {
    // 添加回调
    this.callbacks.add(callback);

    // 更新币种列表（仅在变化时更新）
    const coinsChanged = JSON.stringify(this.coins) !== JSON.stringify(coins);
    if (coinsChanged) {
      this.coins = coins;
      // 如果币种列表变化，重置数据接收标记
      this.hasReceivedData = false;
      
      // 如果已连接或正在连接，需要断开并重新连接以订阅新的 symbols
      const wsState = this.ws?.readyState;
      if (this.isConnected || wsState === WebSocket.CONNECTING || wsState === WebSocket.OPEN) {
        console.log('[BinanceWS] Coins changed, reconnecting with new symbols...');
        this.disconnect();
      }
      // 立即开始新连接
      this.connect(false);
      return () => {
        this.callbacks.delete(callback);
      };
    }

    // coins 未变化时：如果未连接且未在连接中，发起连接
    if (!this.isConnected && this.ws?.readyState !== WebSocket.CONNECTING) {
      this.connect(false);  // 默认使用主站
    }

    // 返回取消订阅函数
    // 注意：不再在回调清空时自动 shutdown，保持连接持续
    return () => {
      this.callbacks.delete(callback);
    };
  }

  /**
   * 获取当前缓存的价格数据
   */
  public getCachedPrices(): PriceData[] {
    return Array.from(this.priceCache.values());
  }

  /**
   * 获取指定 symbol 的缓存价格
   */
  public getCachedPrice(symbol: string): PriceData | undefined {
    return this.priceCache.get(symbol);
  }

  /**
   * 断开连接
   */
  private disconnect(): void {
    this.stopHeartbeat();  // 停止心跳检查
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.additionalSockets.forEach(ws => {
      try { ws.close(); } catch (e) {}
    });
    this.additionalSockets = [];
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isConnected = false;
  }

  /**
   * 完全关闭（停止重连）
   */
  public shutdown(): void {
    this.stopHeartbeat();  // 停止心跳检查
    this.callbacks.clear();
    this.coins = [];
    this.priceCache.clear();
    this.hasReceivedData = false;
    this.isConnected = false;  // 确保关闭后连接状态为 false
    this.lastDataTime = 0;  // 重置心跳时间
    // 重置 fallback 相关状态
    this.usingFallback = false;
    this.primaryHasFailed = false;
    this.fallbackHasFailed = false;
    this.setStatus('idle');
    this.disconnect();
  }
}

// 单例实例
const wsManager = new BinanceWebSocketManager();

// 导出单例
export const binanceWsService = wsManager;

/**
 * 便捷函数：订阅 Watchlist 价格更新
 */
export const subscribeWatchlistPrices = (
  coins: WatchlistCoinConfig[],
  callback: PriceUpdateCallback
): (() => void) => {
  return wsManager.subscribe(coins, callback);
};

/**
 * 便捷函数：获取所有缓存价格
 */
export const getCachedPrices = (): PriceData[] => {
  return wsManager.getCachedPrices();
};

/**
 * 便捷函数：获取指定 symbol 的缓存价格
 */
export const getCachedPrice = (symbol: string): PriceData | undefined => {
  return wsManager.getCachedPrice(symbol);
};

/**
 * 便捷函数：获取连接状态
 */
export const getConnectionStatus = (): ConnectionStatus => {
  return wsManager.getStatus();
};

/**
 * 便捷函数：订阅连接状态变化
 */
export const onConnectionStatusChange = (
  callback: (status: ConnectionStatus) => void
): (() => void) => {
  return wsManager.onStatusChange(callback);
};

/**
 * 便捷函数：批量更新价格缓存（用于 REST API 初始数据）
 */
export const updatePriceCacheBatch = (prices: PriceData[]): void => {
  wsManager.updatePriceCacheBatch(prices);
};
