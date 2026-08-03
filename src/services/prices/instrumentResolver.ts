/**
 * AssetKey → VenueInstrument 解析
 *
 * 正常路径走 exchange catalog。冷启动（本地无 catalog 缓存）时按 curated category 和
 * 各 venue 的明确产品规则生成保守 candidate，再用 targeted ticker 验证——绝不为此
 * 请求全市场 catalog 或全市场 ticker。
 */

import type { AssetCategory, AssetKey, AssetMeta, VenueInstrument } from './types';
import { assetKeyCategory, migrateAssetKey, venueSymbol } from './assetKey';
import { getCuratedAsset } from './assets';
import { exchangeCatalog } from './exchangeCatalog';
import { equityCategoryFor, makeInstrument } from './venues/shared';

/**
 * 价格来源分层。跨层禁止聚合。
 *  1 现货（crypto spot / tokenized stock spot）
 *  2 CEX 衍生品（equity perp / fx perp / commodity perp）
 *  3 trusted Hyperliquid HIP-3
 */
export type SourceTier = 1 | 2 | 3;

export function instrumentTier(instrument: VenueInstrument): SourceTier {
  switch (instrument.productKind) {
    case 'crypto_spot':
    case 'tokenized_stock_spot':
      return 1;
    case 'equity_perp':
    case 'fx_perp':
    case 'commodity_perp':
      return 2;
    case 'hip3_perp':
      return 3;
  }
}

export function catalogInstrumentsFor(assetKey: AssetKey): VenueInstrument[] {
  return exchangeCatalog.instrumentsFor(assetKey).filter((i) => i.status === 'live');
}

/**
 * 冷启动 candidate。仅对 curated 资产生成，且完全由 canonical symbol 推导，
 * 不使用任何代理标的（FBTC 不会退化成 BTC/IBIT，XLF 不会退化成金融指数）。
 */
export function candidateInstruments(assetKey: AssetKey, tier: SourceTier): VenueInstrument[] {
  const key = migrateAssetKey(assetKey);
  const meta = getCuratedAsset(key);
  const category = assetKeyCategory(key);
  if (!meta || !category) return [];

  if (category === 'crypto') return tier === 1 ? cryptoSpotCandidates(meta) : [];
  if (category === 'stock' || category === 'etf') {
    return tier === 1 ? tokenizedSpotCandidates(key, category) : equityPerpCandidates(key, category);
  }
  if (category === 'commodity') return tier === 2 ? commodityPerpCandidates(key) : [];
  // FX 没有任何经过 metadata 验证的公开产品，宁可 unavailable 也不猜
  return [];
}

function cryptoSpotCandidates(meta: AssetMeta): VenueInstrument[] {
  const pair = meta.cexPair;
  if (!pair) return [];
  const { base, quote } = pair;
  const common = {
    symbol: meta.symbol,
    base,
    quote,
    category: 'crypto' as const,
    productKind: 'crypto_spot' as const,
    preferredPriceKind: 'last' as const,
  };
  return [
    makeInstrument({ venue: 'okx', instrumentId: `${base}-${quote}`, ...common }),
    makeInstrument({ venue: 'bitget', instrumentId: `${base}${quote}`, ...common }),
    makeInstrument({ venue: 'binance', instrumentId: `${base}${quote}`, ...common }),
  ];
}

function tokenizedSpotCandidates(key: AssetKey, category: AssetCategory): VenueInstrument[] {
  const vs = venueSymbol(key);
  const symbol = getCuratedAsset(key)?.symbol ?? vs;
  const common = {
    symbol,
    quote: 'USDT',
    category,
    productKind: 'tokenized_stock_spot' as const,
    preferredPriceKind: 'last' as const,
  };
  return [
    makeInstrument({ venue: 'okx', instrumentId: `X${vs}-USDT`, base: `X${vs}`, ...common }),
    makeInstrument({ venue: 'bitget', instrumentId: `R${vs}USDT`, base: `R${vs}`, ...common }),
    makeInstrument({ venue: 'binance', instrumentId: `${vs}BUSDT`, base: `${vs}B`, ...common }),
  ];
}

function equityPerpCandidates(key: AssetKey, category: AssetCategory): VenueInstrument[] {
  const vs = venueSymbol(key);
  const symbol = getCuratedAsset(key)?.symbol ?? vs;
  const common = {
    symbol,
    base: vs,
    quote: 'USDT',
    category,
    productKind: 'equity_perp' as const,
    preferredPriceKind: 'index' as const,
  };
  return [
    makeInstrument({ venue: 'okx', instrumentId: `${vs}-USDT-SWAP`, ...common }),
    makeInstrument({ venue: 'bitget', instrumentId: `${vs}USDT`, ...common }),
    makeInstrument({ venue: 'binance', instrumentId: `${vs}USDT`, ...common }),
  ];
}

function commodityPerpCandidates(key: AssetKey): VenueInstrument[] {
  const vs = venueSymbol(key);
  const symbol = getCuratedAsset(key)?.symbol ?? vs;
  const common = {
    symbol,
    base: vs,
    quote: 'USDT',
    category: 'commodity' as const,
    productKind: 'commodity_perp' as const,
    preferredPriceKind: 'index' as const,
  };
  return [
    makeInstrument({ venue: 'bitget', instrumentId: `${vs}USDT`, ...common }),
    makeInstrument({ venue: 'binance', instrumentId: `${vs}USDT`, ...common }),
  ];
}

/** UI 用：资产是否至少有一个已验证的 live instrument */
export function hasLiveInstrument(assetKey: AssetKey): boolean {
  return catalogInstrumentsFor(assetKey).length > 0;
}

/** 动态 catalog 条目缺少 curated 名称时的兜底元数据 */
export function fallbackMetaFor(assetKey: AssetKey): AssetMeta | null {
  const key = migrateAssetKey(assetKey);
  const curated = getCuratedAsset(key);
  if (curated) return curated;
  const category = assetKeyCategory(key);
  if (!category) return null;
  const symbol = key.slice(key.indexOf(':') + 1);
  return {
    symbol,
    name: symbol,
    category: category === 'stock' ? equityCategoryFor(symbol) : category,
  };
}
