/**
 * AssetKey —— 资产身份的唯一标识
 *
 * 形如 `${AssetCategory}:${UPPERCASE_SYMBOL}`。同名不同类别（crypto:COIN vs stock:COIN）
 * 必须是两个独立资产，因此 subscriber union / snapshot map / catalog 去重 / 持久化缓存
 * 一律以 AssetKey 为 key，不能只用 symbol。
 */

import type { AssetCategory, AssetKey } from './types';

const CATEGORIES: readonly AssetCategory[] = ['crypto', 'stock', 'etf', 'fx', 'commodity'];

/**
 * canonical 资产迁移表 —— 交易所换 ticker 后用户面 symbol 也要跟着换。
 *
 * Block, Inc. 已由 SQ 更名为 XYZ。这是资产本身的迁移，不是 venue alias，
 * 因此持久化配置和缓存都要按 AssetKey 整体迁移；不得对任意 SQ 字符串做全局替换。
 */
const CANONICAL_MIGRATIONS: Readonly<Record<AssetKey, AssetKey>> = {
  'stock:SQ': 'stock:XYZ',
};

/**
 * venue 侧 symbol 别名 —— 用户面 canonical 保持不变，只在拼 instrumentId 时替换。
 *
 * BRK.B 在交易所侧写作 BRKB；BRENT / WTI 在 TradFi 永续上使用期货 root symbol BZ / CL。
 * 这些是逐条列举的显式映射，不是"删除所有标点"或字符串相似度猜测。
 */
const VENUE_SYMBOL_ALIASES: Readonly<Record<AssetKey, string>> = {
  'stock:BRK.B': 'BRKB',
  'commodity:BRENT': 'BZ',
  'commodity:WTI': 'CL',
};

export function makeAssetKey(category: AssetCategory, symbol: string): AssetKey {
  return `${category}:${symbol.trim().toUpperCase()}`;
}

export function assetKeyOf(meta: { category: AssetCategory; symbol: string }): AssetKey {
  return makeAssetKey(meta.category, meta.symbol);
}

export function parseAssetKey(key: string): { category: AssetCategory; symbol: string } | null {
  const idx = key.indexOf(':');
  if (idx <= 0) return null;
  const category = key.slice(0, idx) as AssetCategory;
  if (!CATEGORIES.includes(category)) return null;
  const symbol = key.slice(idx + 1);
  if (!symbol) return null;
  return { category, symbol };
}

export function assetKeySymbol(key: AssetKey): string {
  return parseAssetKey(key)?.symbol ?? key;
}

export function assetKeyCategory(key: AssetKey): AssetCategory | null {
  return parseAssetKey(key)?.category ?? null;
}

/** 把历史 AssetKey 迁移到当前 canonical（幂等） */
export function migrateAssetKey(key: AssetKey): AssetKey {
  return CANONICAL_MIGRATIONS[key] ?? key;
}

/** 拼 instrumentId 时使用的 venue 侧 symbol */
export function venueSymbol(key: AssetKey): string {
  const alias = VENUE_SYMBOL_ALIASES[key];
  if (alias) return alias;
  return assetKeySymbol(key);
}

/**
 * 历史 Watchlist 设置 → AssetKey。
 *
 * 依次兼容：显式 assetKey → category + symbol → 更老的 { symbol: 'BTCUSDT', baseAsset: 'BTC' }。
 */
export function assetKeyFromSetting(setting: {
  assetKey?: string;
  category?: string;
  symbol?: string;
  baseAsset?: string;
}): AssetKey | null {
  if (setting.assetKey) {
    const parsed = parseAssetKey(setting.assetKey);
    if (parsed) return migrateAssetKey(makeAssetKey(parsed.category, parsed.symbol));
  }
  const rawSymbol = setting.baseAsset ?? setting.symbol;
  if (!rawSymbol) return null;
  const category = CATEGORIES.includes(setting.category as AssetCategory)
    ? (setting.category as AssetCategory)
    : 'crypto';
  return migrateAssetKey(makeAssetKey(category, rawSymbol));
}
