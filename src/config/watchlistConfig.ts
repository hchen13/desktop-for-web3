/**
 * Watchlist 币种配置
 *
 * 币种配置，使用 Binance WebSocket 获取实时价格
 * Logo 使用 CoinGecko 提供的图片资源
 */

import type { WatchlistCoinConfig } from '../services/binance/types';

/**
 * CoinCap Logo URL 生成器
 * 使用 weserv.nl 代理避免 CORS 错误
 */
export const getCoinCapLogoUrl = (symbol: string): string => {
  const originalUrl = `https://assets.coincap.io/assets/icons/${symbol.toLowerCase()}@2x.png`;
  return `https://images.weserv.nl/?url=${encodeURIComponent(originalUrl)}`;
};

/**
 * Watchlist 默认币种配置
 * symbol: Binance 交易对，如 BTCUSDT
 * baseAsset: 基础资产代码，如 BTC
 * name: 币种全名
 * logoUrl: 币种 Logo URL（使用 Binance CDN）
 */
export const WATCHLIST_COINS: WatchlistCoinConfig[] = [
  {
    symbol: 'BTCUSDT',
    baseAsset: 'BTC',
    name: 'Bitcoin',
    logoUrl: getCoinCapLogoUrl('BTC'),
  },
  {
    symbol: 'ETHUSDT',
    baseAsset: 'ETH',
    name: 'Ethereum',
    logoUrl: getCoinCapLogoUrl('ETH'),
  },
  {
    symbol: 'SOLUSDT',
    baseAsset: 'SOL',
    name: 'Solana',
    logoUrl: getCoinCapLogoUrl('SOL'),
  },
  {
    symbol: 'XRPUSDT',
    baseAsset: 'XRP',
    name: 'XRP',
    logoUrl: getCoinCapLogoUrl('XRP'),
  },
  {
    symbol: 'BNBUSDT',
    baseAsset: 'BNB',
    name: 'BNB',
    logoUrl: getCoinCapLogoUrl('BNB'),
  },
];

/**
 * 获取指定 symbol 的配置
 */
export const getCoinConfig = (symbol: string): WatchlistCoinConfig | undefined => {
  return WATCHLIST_COINS.find(coin => coin.symbol === symbol);
};

/**
 * 获取指定 baseAsset 的配置
 */
export const getCoinConfigByBaseAsset = (baseAsset: string): WatchlistCoinConfig | undefined => {
  return WATCHLIST_COINS.find(coin => coin.baseAsset === baseAsset);
};

/**
 * 获取所有已配置的 symbols
 */
export const getAllSymbols = (): string[] => {
  return WATCHLIST_COINS.map(coin => coin.symbol);
};

/**
 * 获取所有已配置的 baseAssets
 */
export const getAllBaseAssets = (): string[] => {
  return WATCHLIST_COINS.map(coin => coin.baseAsset);
};
