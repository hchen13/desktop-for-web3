/**
 * 链上监控配置
 * 定义支持的链及其在 Dune 中的映射关系
 */

/**
 * CoinCap Logo URL 生成器
 * 使用 weserv.nl 代理避免 CORS 错误
 */
const getCoinCapLogoUrl = (symbol: string): string => {
  const originalUrl = `https://assets.coincap.io/assets/icons/${symbol.toLowerCase()}@2x.png`;
  return `https://images.weserv.nl/?url=${encodeURIComponent(originalUrl)}`;
};

export interface ChainConfig {
  id: string; // 链 ID（小写）
  name: string; // 链显示名称（在 header 上显示）
  symbol: string; // 链符号（调用接口时使用）
  duneNamespace: string; // Dune 数据表命名空间
  icon: string; // 链图标（emoji 或字符，已废弃，保留用于兼容）
  logoUrl: string; // 链 Logo URL（使用 CoinCap CDN）
}

export const SUPPORTED_CHAINS: ChainConfig[] = [
  {
    id: 'btc',
    name: 'Bitcoin',
    symbol: 'btc',
    duneNamespace: 'bitcoin',
    icon: '₿',
    logoUrl: getCoinCapLogoUrl('BTC'),
  },
  {
    id: 'eth',
    name: 'Ethereum',
    symbol: 'eth',
    duneNamespace: 'ethereum',
    icon: 'Ξ',
    logoUrl: getCoinCapLogoUrl('ETH'),
  },
  {
    id: 'sol',
    name: 'Solana',
    symbol: 'sol',
    duneNamespace: 'solana',
    icon: '◎',
    logoUrl: getCoinCapLogoUrl('SOL'),
  },
  {
    id: 'bsc',
    name: 'BSC',
    symbol: 'bnb',
    duneNamespace: 'bnb',
    icon: '⬡',
    logoUrl: getCoinCapLogoUrl('BNB'),
  },
  {
    id: 'polygon',
    name: 'Polygon',
    symbol: 'pol',
    duneNamespace: 'polygon',
    icon: '⬟',
    logoUrl: getCoinCapLogoUrl('MATIC'),
  },
];

/**
 * 默认显示的链（按顺序）
 */
export const DEFAULT_CHAINS: string[] = ['btc', 'eth', 'sol', 'bsc', 'polygon'];

/**
 * 根据链 ID 获取配置
 */
export function getChainConfig(chainId: string): ChainConfig | undefined {
  return SUPPORTED_CHAINS.find(chain => chain.id === chainId.toLowerCase());
}

/**
 * 根据链符号获取配置
 */
export function getChainConfigBySymbol(symbol: string): ChainConfig | undefined {
  return SUPPORTED_CHAINS.find(chain => chain.symbol.toUpperCase() === symbol.toUpperCase());
}

/**
 * 获取所有支持的链 ID
 */
export function getAllChainIds(): string[] {
  return SUPPORTED_CHAINS.map(chain => chain.id);
}

/**
 * 验证链 ID 是否支持
 */
export function isChainSupported(chainId: string): boolean {
  return SUPPORTED_CHAINS.some(chain => chain.id === chainId.toLowerCase());
}
