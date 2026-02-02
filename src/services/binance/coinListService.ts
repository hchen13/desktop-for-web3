/**
 * Binance 币种列表服务
 * 获取所有可交易币种的列表，用于自动补全和币种选择
 */

import { getCurrentSource, getBapiBase, type DataSource } from './connectivityService';

/**
 * 币种信息（来自 Binance.com get-product-static API）
 */
export interface CoinInfo {
  symbol: string;       // 交易对，如 BTCUSDT
  baseAsset: string;    // 基础资产，如 BTC
  quoteAsset: string;   // 计价资产，如 USDT
  name: string;         // 币种全名，如 Bitcoin
  tags?: string[];      // 标签，如 ["pow", "mining-zone"]
  status: string;       // 交易状态，如 TRADING
}

/**
 * Binance.com get-product-static 响应类型
 */
interface BinanceComProductResponse {
  success?: boolean;
  code?: string;
  data: Array<{
    s: string;      // symbol (交易对)
    b: string;      // base asset
    q: string;      // quote asset
    an: string;     // asset name
    qn: string;     // quote name
    st: string;     // status
    tags?: string[];
  }>;
}

/**
 * Binance.US market/prices 响应类型
 */
interface BinanceUsMarketResponse {
  success?: boolean;
  code?: string;
  data: {
    productDataList: Array<{
      symbol: string;       // 交易对
      baseAsset: string;    // 基础资产
      baseAssetName: string;// 币种全名
      quoteAsset: string;   // 计价资产
      status: number;       // 状态
    }>;
  };
}

/**
 * 币种分类（仅 Binance.com 有分类）
 */
export interface CoinCategory {
  name: string;
  coins: CoinInfo[];
}

/**
 * 币种列表缓存
 */
interface CoinListCache {
  coins: CoinInfo[];
  categories: CoinCategory[];
  lastUpdate: number;
  source: DataSource;
}

// 缓存
let coinListCache: CoinListCache | null = null;

// 缓存有效期：1小时
const CACHE_TTL = 60 * 60 * 1000;

/**
 * 从 Binance.com 获取币种列表
 */
async function fetchFromBinanceCom(): Promise<{ coins: CoinInfo[]; categories: CoinCategory[] }> {
  const url = `${getBapiBase()}/bapi/asset/v2/friendly/asset-service/product/get-product-static?includeEtf=true`;

  console.log('[CoinList] Fetching from:', url);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Binance.com API error: ${response.status}`);
  }

  const data: BinanceComProductResponse = await response.json();

  console.log('[CoinList] Response received, data array length:', data.data?.length);

  // 检查响应是否成功（API 可能返回 success:true 或 code:'000000'）
  if (!data.data || (!data.success && data.code !== '000000')) {
    throw new Error(`Binance.com API error: ${JSON.stringify(data).slice(0, 100)}`);
  }

  // 去重：只保留 USDT 交易对，按 baseAsset 去重
  const seenBaseAssets = new Set<string>();
  const coins: CoinInfo[] = [];
  const tagMap = new Map<string, CoinInfo[]>();

  for (const item of data.data) {
    // 只保留 USDT 交易对和 TRADING 状态
    if (item.q !== 'USDT' || item.st !== 'TRADING') {
      continue;
    }

    // 去重
    if (seenBaseAssets.has(item.b)) {
      continue;
    }
    seenBaseAssets.add(item.b);

    const coin: CoinInfo = {
      symbol: item.s,
      baseAsset: item.b,
      quoteAsset: item.q,
      name: item.an,
      tags: item.tags,
      status: item.st,
    };

    coins.push(coin);

    // 按 tag 分类
    if (item.tags && item.tags.length > 0) {
      for (const tag of item.tags) {
        if (!tagMap.has(tag)) {
          tagMap.set(tag, []);
        }
        tagMap.get(tag)!.push(coin);
      }
    }
  }

  // 构建分类（按币种数量排序，取前10个分类）
  const categories: CoinCategory[] = Array.from(tagMap.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10)
    .map(([name, categoryCoins]) => ({ name, coins: categoryCoins }));

  console.log(`[CoinList] Fetched ${coins.length} coins from Binance.com with ${categories.length} categories`);

  return { coins, categories };
}

/**
 * 从 Binance.US 获取币种列表
 */
async function fetchFromBinanceUs(): Promise<{ coins: CoinInfo[]; categories: CoinCategory[] }> {
  const url = `${getBapiBase()}/gateway/trade/friendly/v1/market/prices?timeFrame=DAY`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Binance.US API error: ${response.status}`);
  }

  const data: BinanceUsMarketResponse = await response.json();

  // 检查响应是否成功
  if (!data.data?.productDataList && !data.success && data.code !== '000000') {
    throw new Error(`Binance.US API error: ${JSON.stringify(data).slice(0, 100)}`);
  }

  // 去重：按 baseAsset 去重
  const seenBaseAssets = new Set<string>();
  const coins: CoinInfo[] = [];

  for (const item of data.data.productDataList) {
    // 只保留 USDT 交易对
    if (item.quoteAsset !== 'USDT') {
      continue;
    }

    // 去重
    if (seenBaseAssets.has(item.baseAsset)) {
      continue;
    }
    seenBaseAssets.add(item.baseAsset);

    coins.push({
      symbol: item.symbol,
      baseAsset: item.baseAsset,
      quoteAsset: item.quoteAsset,
      name: item.baseAssetName,
      status: item.status === 1 ? 'TRADING' : 'BREAK',
    });
  }

  console.log(`[CoinList] Fetched ${coins.length} coins from Binance.US (no categories)`);

  // Binance.US 没有分类
  return { coins, categories: [] };
}

/**
 * 获取币种列表（使用缓存）
 */
export async function fetchCoinList(forceRefresh = false): Promise<CoinListCache> {
  const source = getCurrentSource();

  // 检查缓存
  if (!forceRefresh && coinListCache) {
    const now = Date.now();
    if (now - coinListCache.lastUpdate < CACHE_TTL && coinListCache.source === source) {
      console.log('[CoinList] Using cached coin list');
      return coinListCache;
    }
  }

  // 根据数据源获取
  let result: { coins: CoinInfo[]; categories: CoinCategory[] };

  if (source === 'binance.us') {
    result = await fetchFromBinanceUs();
  } else {
    // 默认使用 Binance.com
    result = await fetchFromBinanceCom();
  }

  // 更新缓存
  coinListCache = {
    coins: result.coins,
    categories: result.categories,
    lastUpdate: Date.now(),
    source,
  };

  return coinListCache;
}

/**
 * 获取缓存的币种列表（不触发网络请求）
 */
export function getCachedCoinList(): CoinListCache | null {
  return coinListCache;
}

/**
 * 清除币种列表缓存
 */
export function clearCoinListCache(): void {
  coinListCache = null;
}

/**
 * 搜索币种（用于自动补全）
 * @param query 搜索关键词（支持 symbol 或 name）
 * @param limit 返回结果数量限制
 */
export function searchCoins(query: string, limit = 10): CoinInfo[] {
  if (!coinListCache || !query.trim()) {
    return [];
  }

  const lowerQuery = query.toLowerCase().trim();

  // 精确匹配优先，然后是前缀匹配，最后是包含匹配
  const exactMatches: CoinInfo[] = [];
  const prefixMatches: CoinInfo[] = [];
  const containsMatches: CoinInfo[] = [];

  for (const coin of coinListCache.coins) {
    const lowerSymbol = coin.baseAsset.toLowerCase();
    const lowerName = coin.name.toLowerCase();

    // 精确匹配
    if (lowerSymbol === lowerQuery || lowerName === lowerQuery) {
      exactMatches.push(coin);
    }
    // 前缀匹配
    else if (lowerSymbol.startsWith(lowerQuery) || lowerName.startsWith(lowerQuery)) {
      prefixMatches.push(coin);
    }
    // 包含匹配
    else if (lowerSymbol.includes(lowerQuery) || lowerName.includes(lowerQuery)) {
      containsMatches.push(coin);
    }
  }

  // 合并结果
  const results = [...exactMatches, ...prefixMatches, ...containsMatches];

  return results.slice(0, limit);
}

/**
 * 根据 baseAsset 获取币种信息
 */
export function getCoinByBaseAsset(baseAsset: string): CoinInfo | undefined {
  if (!coinListCache) {
    return undefined;
  }

  const upper = baseAsset.toUpperCase();
  return coinListCache.coins.find(coin => coin.baseAsset === upper);
}

/**
 * 检查是否有分类数据
 */
export function hasCategories(): boolean {
  return coinListCache !== null && coinListCache.categories.length > 0;
}
