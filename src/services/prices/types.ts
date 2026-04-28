/**
 * 价格服务类型定义
 *
 * - PriceSnapshot：单个资产在某一时刻的价格快照
 * - AssetMeta：静态资产元数据
 * - SourceAdapter：CEX REST adapter 通用接口
 * - PriceSubscriber：订阅者结构
 */

export type AssetCategory = 'crypto' | 'stock' | 'etf' | 'fx' | 'commodity';

export interface AssetMeta {
  /** 用户面 canonical ticker，如 'BTC' / 'NVDA' / 'XAU' */
  symbol: string;
  /** 全名，如 'Bitcoin' / 'NVIDIA Corp.' */
  name: string;
  /** 资产类别 */
  category: AssetCategory;
  /** Pyth Hermes feed_id（64 hex，0x 前缀）；无 feed 时为 null */
  pythFeedId: string | null;
  /** CEX 上的对名，仅 crypto 有意义 */
  cexPair?: { base: string; quote: string };
  /** logo slug（用于 coincap 等图源 URL 拼接） */
  logoSlug?: string;
  /** 大致市值排名，用于 selector 默认排序 */
  rank?: number;
}

export interface PriceSnapshot {
  symbol: string;
  /** 最新价（单位 USD 或 quote 资产） */
  price: number;
  /** 24h 涨跌幅（百分比，如 +1.23 表示 +1.23%） */
  change24h: number | null;
  /** 24h 成交量（quote 资产计） */
  volume24h: number | null;
  /** 数据更新毫秒时间戳 */
  lastUpdate: number;
  /** 数据源标记（rest source 名称 / pyth） */
  source: string;
}

/** REST adapter 拉取多个 symbol 的接口；返回 symbol→snapshot 映射 */
export interface SourceAdapter {
  /** adapter 名字，作为标识 */
  name: string;
  /**
   * Probe — 测试连通性，返回延迟（毫秒），失败则 reject
   */
  probe(): Promise<number>;
  /**
   * 拉取一组 crypto 资产的最新价（仅 cryptos with cexPair）
   */
  fetchPrices(assets: AssetMeta[]): Promise<Map<string, PriceSnapshot>>;
}

export type PriceCallback = (snapshot: Map<string, PriceSnapshot>) => void;

export interface PriceSubscriber {
  symbols: Set<string>;
  callback: PriceCallback;
}
