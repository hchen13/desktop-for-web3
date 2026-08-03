/**
 * 价格服务类型定义
 *
 * 资产身份统一用 AssetKey（`${category}:${SYMBOL}`），避免 crypto:COIN 与 stock:COIN 碰撞。
 * 行情来源统一用 VenueInstrument（交易所侧 instrument）+ VenueQuote（单一 instrument 报价）。
 */

export type AssetCategory = 'crypto' | 'stock' | 'etf' | 'fx' | 'commodity';

/** `${AssetCategory}:${UPPERCASE_SYMBOL}`，如 'crypto:BTC' / 'stock:BRK.B' / 'etf:SPY' */
export type AssetKey = string;

export interface AssetMeta {
  /** 用户面 canonical ticker，如 'BTC' / 'NVDA' / 'XAU' */
  symbol: string;
  /** 全名，如 'Bitcoin' / 'NVIDIA' */
  name: string;
  /** 资产类别 */
  category: AssetCategory;
  /** CEX 上的对名，仅 crypto 有意义 */
  cexPair?: { base: string; quote: string };
  /** logo slug（用于 coincap 等图源 URL 拼接） */
  logoSlug?: string;
  /** 大致市值排名，用于 selector 默认排序 */
  rank?: number;
}

/** 支持的行情场所 */
export type Venue = 'okx' | 'bitget' | 'binance' | 'hyperliquid';

/**
 * 产品类别 —— 不同类别的价格语义不同，禁止跨类别平均。
 *
 * - crypto_spot           普通加密现货
 * - tokenized_stock_spot  代币化股票现货（OKX Unified Tokenized Stocks / Bitget Reality / Binance bStocks）
 * - equity_perp           CEX 股票永续
 * - hip3_perp             Hyperliquid HIP-3 builder-deployed 永续
 * - fx_perp / commodity_perp  交易所 metadata 明确分类的外汇 / 商品永续
 */
export type ProductKind =
  | 'crypto_spot'
  | 'tokenized_stock_spot'
  | 'equity_perp'
  | 'hip3_perp'
  | 'fx_perp'
  | 'commodity_perp';

/** 价格字段语义 —— 只能在相同 PriceKind 内聚合 */
export type PriceKind = 'last' | 'index' | 'oracle' | 'mark' | 'mid';

export type InstrumentStatus = 'live' | 'suspended';

export interface VenueInstrument {
  venue: Venue;
  /** 交易所侧 instrument 标识，如 'XAAPL-USDT' / 'RAAPLUSDT' / 'AAPLBUSDT' / 'xyz:AAPL' */
  instrumentId: string;
  assetKey: AssetKey;
  /** 用户面 canonical symbol */
  symbol: string;
  base: string;
  quote: string;
  category: AssetCategory;
  productKind: ProductKind;
  preferredPriceKind: PriceKind;
  status: InstrumentStatus;
}

export interface VenueQuote {
  assetKey: AssetKey;
  venue: Venue;
  instrumentId: string;
  productKind: ProductKind;
  priceKind: PriceKind;
  /** 计价货币（USDT 报价不等于真实 USD） */
  quoteCurrency: string;
  price: number;
  /** 该交易所产品自身的滚动 24h 变化百分比，不是美股相对上一交易日收盘 */
  change24h: number | null;
  volume24h: number | null;
  /** 交易所给出的行情时间戳 */
  sourceTimestamp: number;
  /** 本地收到的时间戳 */
  receivedAt: number;
}

/** 聚合结果的覆盖等级 */
export type CoverageTier =
  | 'spot-consensus'
  | 'tokenized-spot-consensus'
  | 'single-source'
  | 'derivative-reference'
  | 'trusted-oracle-fallback'
  | 'stale'
  | 'unavailable';

export type QuoteQuality = 'live' | 'degraded' | 'stale' | 'unavailable';

export interface PriceSnapshot {
  assetKey: AssetKey;
  symbol: string;
  price: number;
  change24h: number | null;
  volume24h: number | null;
  lastUpdate: number;
  /** 代表来源（提供 change24h / volume24h 的那一家） */
  source: string;
  /** 参与聚合的 venue 列表 */
  sources: Venue[];
  sourceCount: number;
  quality: QuoteQuality;
  coverageTier: CoverageTier;
  quoteCurrency: string;
  productKind: ProductKind | null;
  priceKind: PriceKind | null;
}

export type PriceCallback = (snapshots: Map<AssetKey, PriceSnapshot>) => void;

/** 稳定订阅 handle —— 换币只更新 AssetKey 集合，不重建 subscriber */
export interface PriceSubscription {
  updateAssets(assetKeys: Set<AssetKey>): void;
  setActive(active: boolean): void;
  unsubscribe(): void;
}
