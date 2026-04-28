/**
 * DefiLlama 服务共享类型
 */

/** 单个稳定币资产规范化数据 */
export interface StablecoinAsset {
  /** DefiLlama id（fallback 为 symbol） */
  id: string;
  /** 大写 symbol，如 USDT / USDC / USDe */
  symbol: string;
  /** 显示名 */
  name: string;
  /** 锚定类型（peggedUSD / peggedEUR / peggedVAR ...） */
  pegType: string;
  /** 锚定机制（fiat-backed / crypto-backed / algorithmic ...） */
  pegMechanism?: string;
  /** 当前总流通市值（数值，单位 USD 等价） */
  mcap: number;
  /** 24h 之前的流通量（用于计算 delta） */
  mcapPrev: number | null;
  /** 24h 流通量变化百分比 */
  change24h: number | null;
  /** 当前价格（USD），用于计算 peg 偏离 */
  price: number | null;
  /** 链分布 */
  chains: string[];
  /** CoinGecko id（备用） */
  geckoId?: string;
}

export type StablecoinFetchStatus = 'idle' | 'loading' | 'success' | 'error';

export interface StablecoinsState {
  assets: StablecoinAsset[];
  lastUpdated: number | null;
  status: StablecoinFetchStatus;
  error: string | null;
}

export type StablecoinSubscriber = (state: StablecoinsState) => void;

/** Yields service 类型 */
export interface YieldPool {
  /** DefiLlama 池 ID */
  pool: string;
  /** 项目名 */
  project: string;
  /** 池 symbol（如 USDC, sUSDe） */
  symbol: string;
  /** 链名（小写） */
  chain: string;
  /** 总 APY（%, 已含 base + reward） */
  apy: number | null;
  /** 仅 base APY */
  apyBase: number | null;
  /** 仅 reward APY */
  apyReward: number | null;
  /** TVL (USD) */
  tvlUsd: number;
  /** 锁定期 / 风险标识（DefiLlama 提供） */
  ilRisk?: string;
  exposure?: string;
  /** 稳定币标识（仅当 pool 为 stablecoin pool 时） */
  stablecoin: boolean;
}

export type YieldsStatus = 'idle' | 'loading' | 'success' | 'error';

export interface YieldsState {
  pools: YieldPool[];
  lastUpdated: number | null;
  status: YieldsStatus;
  error: string | null;
}

export type YieldsSubscriber = (state: YieldsState) => void;
