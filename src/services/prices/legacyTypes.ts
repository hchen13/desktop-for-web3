/**
 * 旧 Pyth + 全市场 ticker 运行链的类型。
 *
 * 新的 venue-aware 模型见 `./types.ts`。本文件随旧链一起删除。
 */

import type { AssetMeta } from './types';

export interface LegacyPriceSnapshot {
  symbol: string;
  price: number;
  change24h: number | null;
  volume24h: number | null;
  lastUpdate: number;
  source: string;
}

export interface SourceAdapter {
  name: string;
  probe(): Promise<number>;
  fetchPrices(assets: AssetMeta[]): Promise<Map<string, LegacyPriceSnapshot>>;
}

export type LegacyPriceCallback = (snapshot: Map<string, LegacyPriceSnapshot>) => void;

export interface LegacyPriceSubscriber {
  symbols: Set<string>;
  callback: LegacyPriceCallback;
}
