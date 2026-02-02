/**
 * 链上监控数据类型定义
 */

export type ChainId = 'btc' | 'eth' | 'sol' | 'bsc' | 'polygon';

/**
 * 数据源类型
 * - 'rpc': 前端直接通过公共 RPC 节点获取
 * - 'worker.rpc': Worker API 通过 RPC（如 Alchemy）获取
 * - 'worker.dune': Worker API 通过 Dune Analytics 获取
 * - 'defillama': 前端直接通过 DefiLlama API 获取
 * - 'worker.defillama': Worker API 通过 DefiLlama 获取（备用）
 */
export type DataSource = 'rpc' | 'worker.rpc' | 'worker.dune' | 'defillama' | 'worker.defillama';

/**
 * 区块时间延迟
 */
export interface BlockTimeDelay {
  blockNumber: number;
  latestBlockTime: number; // Unix timestamp (seconds)
  delaySeconds: number;
  source?: DataSource; // 数据来源
}

/**
 * Gas 价格（EVM 链）
 */
export interface GasPrice {
  avgGasGwei: number;
  medianGasGwei: number;
  minGasGwei: number;
  maxGasGwei: number;
  unit: 'gwei' | 'sat/vB' | 'SOL';
  source?: DataSource; // 数据来源
}

/**
 * TPS（每秒交易数）
 */
export interface TPS {
  tps: number;
  txCount?: number;
  sampleCount?: number; // SOL 专用
  periodSeconds?: number; // SOL 专用
  source?: DataSource; // 数据来源
}

/**
 * 活跃地址数
 */
export interface ActiveAddresses {
  activeAddresses: number;
  source?: DataSource; // 数据来源
}

/**
 * TVL（总锁仓价值）
 */
export interface TVL {
  tvl: number;
  tvlUSD: number;
  message?: string;
  source?: DataSource; // 数据来源
}

/**
 * 链的所有指标
 */
export interface ChainMetrics {
  chain: ChainId;
  blockTimeDelay: BlockTimeDelay | null;
  gasPrice: GasPrice | null;
  tps: TPS | null;
  activeAddresses: ActiveAddresses | null;
  tvl: TVL | null;
  lastUpdate: number; // 最后更新时间戳
}

/**
 * 数据获取结果
 */
export interface DataResult<T> {
  data: T | null;
  source: DataSource | null;
  error?: Error;
  cached?: boolean;
}

/**
 * 数据新鲜度配置
 */
export interface CacheConfig {
  blockTimeDelay: number; // 10秒
  gasPrice: number; // 30秒
  tps: number; // 60秒
  activeAddresses: number; // 5分钟
  tvl: number; // 5分钟
}

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  blockTimeDelay: 10 * 1000,
  gasPrice: 30 * 1000,
  tps: 60 * 1000,
  activeAddresses: 5 * 60 * 1000,
  tvl: 5 * 60 * 1000,
};
