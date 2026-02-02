/**
 * Binance REST API 服务
 * 获取初始价格数据
 * 支持主站 (binance.com) 和备用站 (binance.us)
 */

import type { PriceData, WatchlistCoinConfig } from './types';
import { getRestApiBase, getCurrentSource } from './connectivityService';

// 是否在开发模式
const isDev = import.meta.env.DEV;

// 获取主站 API 基础 URL
function getPrimaryApiBase(): string {
  return getRestApiBase();
}

// 获取备用站 API 基础 URL
function getFallbackApiBase(): string {
  const source = getCurrentSource();
  if (isDev) {
    // 开发模式使用 Vite 代理
    return source === 'binance.us' ? '/binance-api/api/v3' : '/binance-us-api/api/v3';
  }
  // 生产模式
  return source === 'binance.us' ? 'https://api.binance.com/api/v3' : 'https://api.binance.us/api/v3';
}

/**
 * REST API 24hr Ticker (MINI) 响应类型
 */
interface RestTickerMini {
  symbol: string;          // 交易对
  openPrice: string;       // 开盘价
  highPrice: string;       // 最高价
  lowPrice: string;        // 最低价
  lastPrice: string;       // 最新价
  volume: string;          // 成交量
  quoteVolume: string;     // 成交额
  openTime: number;        // 开盘时间
  closeTime: number;       // 收盘时间 (用作数据时间戳)
  firstId: number;
  lastId: number;
  count: number;
}

/**
 * 从指定的 API 基础 URL 获取多个交易对的 24hr Ticker (MINI) 数据
 */
async function fetchFromAPI(
  coins: WatchlistCoinConfig[],
  apiBase: string
): Promise<PriceData[]> {
  if (coins.length === 0) {
    return [];
  }

  // 构建 symbols 参数: ["BTCUSDT","ETHUSDT","SOLUSDT"]
  const symbols = JSON.stringify(coins.map(c => c.symbol));
  const url = `${apiBase}/ticker/24hr?symbols=${encodeURIComponent(symbols)}&type=MINI`;

  console.log(`[BinanceREST] Fetching from ${apiBase} with symbols:`, symbols);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  const tickers: RestTickerMini[] = await response.json();

  console.log(`[BinanceREST] Received ${tickers.length} tickers from batch request`);

  // 检查是否有 symbol 未返回数据
  const returnedSymbols = new Set(tickers.map(t => t.symbol));
  const missingSymbols = coins.filter(c => !returnedSymbols.has(c.symbol));

  if (missingSymbols.length > 0) {
    console.warn(`[BinanceREST] Missing ${missingSymbols.length} symbols from batch response:`, missingSymbols.map(c => c.symbol));

    // 对缺失的 symbol 进行单独请求
    const individualResults = await Promise.allSettled(
      missingSymbols.map(coin => fetchSingleSymbol(coin, apiBase))
    );

    individualResults.forEach((result, index) => {
      const coin = missingSymbols[index];
      if (result.status === 'fulfilled') {
        tickers.push(result.value);
        console.log(`[BinanceREST] Fetched ${coin.symbol} individually`);
      } else {
        console.error(`[BinanceREST] Failed to fetch ${coin.symbol} individually:`, result.reason);
      }
    });
  }

  // 转换为 PriceData 格式
  return tickers.map((ticker) => {
    const coin = coins.find(c => c.symbol === ticker.symbol);
    if (!coin) {
      return null as any;
    }

    const price = parseFloat(ticker.lastPrice);
    const openPrice = parseFloat(ticker.openPrice);
    const change24h = (price / openPrice - 1) * 100;

    return {
      symbol: ticker.symbol,
      baseAsset: coin.baseAsset,
      name: coin.name,
      price,
      priceString: ticker.lastPrice,
      change24h,
      lastUpdate: ticker.closeTime,
    };
  }).filter((data): data is PriceData => data !== null);
}

/**
 * 获取单个 symbol 的数据
 */
async function fetchSingleSymbol(coin: WatchlistCoinConfig, apiBase: string): Promise<RestTickerMini> {
  const url = `${apiBase}/ticker/24hr?symbol=${coin.symbol}&type=MINI`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Single symbol API error for ${coin.symbol}: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

/**
 * 获取多个交易对的 24hr Ticker (MINI) 数据
 * 先尝试主站，失败后尝试备用站
 *
 * @param coins 币种配置列表
 * @returns Promise<PriceData[]> 价格数据数组
 */
export async function fetch24hrTickerMini(coins: WatchlistCoinConfig[]): Promise<PriceData[]> {
  if (coins.length === 0) {
    return [];
  }

  // 先尝试主站（根据连通性探测结果）
  try {
    const primaryBase = getPrimaryApiBase();
    console.log(`[BinanceREST] Fetching from primary API (${primaryBase})...`);
    return await fetchFromAPI(coins, primaryBase);
  } catch (primaryError) {
    console.warn('[BinanceREST] Primary API failed, trying fallback:', primaryError);

    // 主站失败，尝试备用站
    try {
      const fallbackBase = getFallbackApiBase();
      return await fetchFromAPI(coins, fallbackBase);
    } catch (fallbackError) {
      console.error('[BinanceREST] Both primary and fallback APIs failed');
      throw fallbackError;
    }
  }
}

/**
 * 获取单个交易对的 24hr Ticker (MINI) 数据
 *
 * @param symbol 交易对符号
 * @param coin 币种配置
 * @returns Promise<PriceData> 价格数据
 */
export async function fetch24hrTickerMiniSingle(
  symbol: string,
  coin: WatchlistCoinConfig
): Promise<PriceData> {
  // 先尝试主站（根据连通性探测结果）
  try {
    const primaryBase = getPrimaryApiBase();
    const url = `${primaryBase}/ticker/24hr?symbol=${symbol}&type=MINI`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const ticker: RestTickerMini = await response.json();

    const price = parseFloat(ticker.lastPrice);
    const openPrice = parseFloat(ticker.openPrice);
    const change24h = (price / openPrice - 1) * 100;

    return {
      symbol: ticker.symbol,
      baseAsset: coin.baseAsset,
      name: coin.name,
      price,
      priceString: ticker.lastPrice,
      change24h,
      lastUpdate: ticker.closeTime,
    };
  } catch (primaryError) {
    // 主站失败，尝试备用站
    console.warn('[BinanceREST] Primary API failed for single symbol, trying fallback');
    const fallbackBase = getFallbackApiBase();
    const url = `${fallbackBase}/ticker/24hr?symbol=${symbol}&type=MINI`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Fallback API error: ${response.status} ${response.statusText}`);
    }

    const ticker: RestTickerMini = await response.json();

    const price = parseFloat(ticker.lastPrice);
    const openPrice = parseFloat(ticker.openPrice);
    const change24h = (price / openPrice - 1) * 100;

    return {
      symbol: ticker.symbol,
      baseAsset: coin.baseAsset,
      name: coin.name,
      price,
      priceString: ticker.lastPrice,
      change24h,
      lastUpdate: ticker.closeTime,
    };
  }
}
