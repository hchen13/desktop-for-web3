/**
 * Exchange market catalog —— 交易所公开 instrument 目录
 *
 * 唯一的正常远程触发时机是 WatchlistEditDialog 打开（`ensureFresh`）。页面启动、
 * PriceService 启动、周期报价 timer 只允许读本地缓存（`loadCachedOnly`）。
 *
 * 预热只拉 instruments / exchangeInfo 这类 metadata，绝不拉全市场 ticker。
 */

import type { AssetKey, AssetMeta, Venue, VenueInstrument } from './types';
import { assetKeyOf, migrateAssetKey } from './assetKey';
import { ASSETS, getCuratedAsset } from './assets';
import {
  buildBinanceInstruments,
  collectBinanceEquitySymbols,
  fetchBinanceRawCatalog,
  type BinanceRawCatalog,
} from './venues/binance';
import {
  buildBitgetInstruments,
  collectBitgetEquitySymbols,
  fetchBitgetRawCatalog,
  type BitgetRawCatalog,
} from './venues/bitget';
import {
  buildHyperliquidInstruments,
  fetchHyperliquidRawCatalog,
  type HyperliquidRawCatalog,
} from './venues/hyperliquid';
import {
  buildOkxInstruments,
  collectOkxEquitySymbols,
  fetchOkxRawCatalog,
  type OkxRawCatalog,
} from './venues/okx';
import { CRYPTO_QUOTE_PRIORITY } from './venues/shared';

const STORAGE_KEY = 'exchange_catalog_v1';
export const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

interface PersistedCatalog {
  version: 'v1';
  timestamp: number;
  instruments: VenueInstrument[];
}

function isChromeStorageAvailable(): boolean {
  try {
    return typeof chrome !== 'undefined' && !!chrome.storage?.local?.get;
  } catch {
    return false;
  }
}

/** curated 已知的股票 / ETF canonical，作为各家 venue metadata 之外的第一层确认 */
function curatedEquitySymbols(): Set<string> {
  const out = new Set<string>();
  for (const asset of ASSETS) {
    if (asset.category === 'stock' || asset.category === 'etf') {
      out.add(asset.symbol.toUpperCase());
      // BRK.B 在交易所侧写作 BRKB，确认集合按 venue 侧写法存放
      out.add(asset.symbol.replace(/\./g, '').toUpperCase());
    }
  }
  return out;
}

/**
 * 同一 venue 同一资产的等价现货对只留一个（USDT 优先），避免 catalog 体积翻几倍。
 * 衍生品与现货是不同产品，不参与这里的去重。
 */
function dedupeInstruments(instruments: VenueInstrument[]): VenueInstrument[] {
  const bySpotSlot = new Map<string, VenueInstrument>();
  const others: VenueInstrument[] = [];
  const seenIds = new Set<string>();

  for (const inst of instruments) {
    const id = `${inst.venue}|${inst.instrumentId}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    if (inst.productKind === 'crypto_spot' || inst.productKind === 'tokenized_stock_spot') {
      const slot = `${inst.venue}|${inst.productKind}|${inst.assetKey}`;
      const existing = bySpotSlot.get(slot);
      if (!existing) {
        bySpotSlot.set(slot, inst);
        continue;
      }
      const rank = (q: string) => {
        const idx = CRYPTO_QUOTE_PRIORITY.indexOf(q);
        return idx < 0 ? CRYPTO_QUOTE_PRIORITY.length : idx;
      };
      if (rank(inst.quote) < rank(existing.quote)) bySpotSlot.set(slot, inst);
      continue;
    }
    others.push(inst);
  }

  return [...bySpotSlot.values(), ...others];
}

export interface CatalogEntry {
  meta: AssetMeta;
  assetKey: AssetKey;
  /** 至少有一个 live instrument 才允许被新选中 */
  selectable: boolean;
}

class ExchangeCatalog {
  private instrumentsByAsset = new Map<AssetKey, VenueInstrument[]>();
  private dynamicAssets = new Map<AssetKey, AssetMeta>();
  private timestamp = 0;
  private cacheReadPromise: Promise<void> | null = null;
  private refreshPromise: Promise<void> | null = null;
  private listeners = new Set<() => void>();

  /** 只读本地缓存，永远不发远程请求（应用启动路径唯一允许的入口） */
  loadCachedOnly(): Promise<void> {
    if (!this.cacheReadPromise) {
      this.cacheReadPromise = this.readCache().catch((err) => {
        console.warn('[ExchangeCatalog] cache read failed', err);
      });
    }
    return this.cacheReadPromise;
  }

  /**
   * 搜索弹窗打开时调用。
   * fresh 缓存直接返回；stale 缓存先返回、后台并行刷新；无缓存才等待刷新完成。
   */
  async ensureFresh(): Promise<void> {
    await this.loadCachedOnly();
    if (this.isFresh()) return;
    const refresh = this.refresh();
    if (this.hasData()) return;
    await refresh;
  }

  isFresh(): boolean {
    return this.hasData() && Date.now() - this.timestamp < CATALOG_TTL_MS;
  }

  hasData(): boolean {
    return this.instrumentsByAsset.size > 0;
  }

  lastUpdated(): number {
    return this.timestamp;
  }

  onUpdate(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  instrumentsFor(assetKey: AssetKey): VenueInstrument[] {
    return this.instrumentsByAsset.get(migrateAssetKey(assetKey)) ?? [];
  }

  isSelectable(assetKey: AssetKey): boolean {
    return this.instrumentsFor(assetKey).some((i) => i.status === 'live');
  }

  /** curated 优先，动态条目补充；同 AssetKey 只出现一次 */
  entries(category?: AssetMeta['category'] | 'all'): CatalogEntry[] {
    const wanted = category && category !== 'all' ? category : null;
    const seen = new Set<AssetKey>();
    const out: CatalogEntry[] = [];

    const push = (meta: AssetMeta) => {
      const key = assetKeyOf(meta);
      if (seen.has(key)) return;
      if (wanted && meta.category !== wanted) return;
      seen.add(key);
      out.push({ meta, assetKey: key, selectable: this.isSelectable(key) });
    };

    for (const meta of ASSETS) push(meta);
    for (const meta of this.dynamicAssets.values()) push(meta);
    return out;
  }

  search(query: string, category?: AssetMeta['category'] | 'all'): CatalogEntry[] {
    const q = query.trim().toUpperCase();
    const pool = this.entries(category);
    if (!q) {
      return pool
        .slice()
        .sort((a, b) => (a.meta.rank ?? 9999) - (b.meta.rank ?? 9999))
        .slice(0, 200);
    }

    const exact: CatalogEntry[] = [];
    const symbolStarts: CatalogEntry[] = [];
    const symbolContains: CatalogEntry[] = [];
    const nameContains: CatalogEntry[] = [];
    for (const entry of pool) {
      const symbol = entry.meta.symbol.toUpperCase();
      const name = entry.meta.name.toUpperCase();
      if (symbol === q) exact.push(entry);
      else if (symbol.startsWith(q)) symbolStarts.push(entry);
      else if (symbol.includes(q)) symbolContains.push(entry);
      else if (name.includes(q)) nameContains.push(entry);
    }
    const byRank = (a: CatalogEntry, b: CatalogEntry) =>
      (a.meta.rank ?? 9999) - (b.meta.rank ?? 9999);
    return [
      ...exact.sort(byRank),
      ...symbolStarts.sort(byRank),
      ...symbolContains.sort(byRank),
      ...nameContains.sort(byRank),
    ].slice(0, 200);
  }

  /**
   * 供 PriceService 在冷启动时把验证过的 candidate mapping 写回缓存。
   *
   * 这些 mapping 只覆盖当前 selected 的几个资产，不构成一次完整 catalog 预热，
   * 因此不能推进 timestamp——否则 isFresh() 会误判成 fresh，搜索弹窗 24 小时内
   * 都拉不到完整的交易所标的列表。
   */
  async mergeResolvedInstruments(instruments: VenueInstrument[]): Promise<void> {
    if (instruments.length === 0) return;
    const merged = dedupeInstruments([...this.allInstruments(), ...instruments]);
    this.apply(merged, this.timestamp);
    await this.writeCache();
  }

  allInstruments(): VenueInstrument[] {
    const out: VenueInstrument[] = [];
    for (const list of this.instrumentsByAsset.values()) out.push(...list);
    return out;
  }

  __pendingRefreshForTest(): Promise<void> | null {
    return this.refreshPromise;
  }

  __resetForTest(): void {
    this.instrumentsByAsset.clear();
    this.dynamicAssets.clear();
    this.timestamp = 0;
    this.cacheReadPromise = null;
    this.refreshPromise = null;
    this.listeners.clear();
  }

  // ============ 内部 ============

  private refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.doRefresh()
      .catch((err) => {
        console.warn('[ExchangeCatalog] refresh failed', err);
      })
      .finally(() => {
        this.refreshPromise = null;
      });
    return this.refreshPromise;
  }

  private async doRefresh(): Promise<void> {
    const [okx, bitget, binance, hyperliquid] = await Promise.allSettled([
      fetchOkxRawCatalog(),
      fetchBitgetRawCatalog(),
      fetchBinanceRawCatalog(),
      fetchHyperliquidRawCatalog(),
    ]);

    const okxRaw = valueOf<OkxRawCatalog>(okx);
    const bitgetRaw = valueOf<BitgetRawCatalog>(bitget);
    const binanceRaw = valueOf<BinanceRawCatalog>(binance);
    const hyperliquidRaw = valueOf<HyperliquidRawCatalog>(hyperliquid);

    if (!okxRaw && !bitgetRaw && !binanceRaw && !hyperliquidRaw) {
      throw new Error('all venue catalogs failed');
    }

    const confirmedEquitySymbols = curatedEquitySymbols();
    if (okxRaw) for (const s of collectOkxEquitySymbols(okxRaw)) confirmedEquitySymbols.add(s);
    if (bitgetRaw) {
      for (const s of collectBitgetEquitySymbols(bitgetRaw)) confirmedEquitySymbols.add(s);
    }
    if (binanceRaw) {
      for (const s of collectBinanceEquitySymbols(binanceRaw)) confirmedEquitySymbols.add(s);
    }

    const ctx = { confirmedEquitySymbols };
    const fresh: VenueInstrument[] = [];
    const refreshedVenues = new Set<Venue>();

    if (okxRaw) {
      fresh.push(...buildOkxInstruments(okxRaw, ctx));
      refreshedVenues.add('okx');
    }
    if (bitgetRaw) {
      fresh.push(...buildBitgetInstruments(bitgetRaw, ctx));
      refreshedVenues.add('bitget');
    }
    if (binanceRaw) {
      fresh.push(...buildBinanceInstruments(binanceRaw, ctx));
      refreshedVenues.add('binance');
    }
    if (hyperliquidRaw) {
      fresh.push(...buildHyperliquidInstruments(hyperliquidRaw, ctx));
      refreshedVenues.add('hyperliquid');
    }

    // 单个 venue 失败只降级该 venue：沿用它上一版的 instrument mapping
    const carried = this.allInstruments().filter((i) => !refreshedVenues.has(i.venue));
    this.apply(dedupeInstruments([...fresh, ...carried]), Date.now());
    await this.writeCache();
    this.notify();
  }

  private apply(instruments: VenueInstrument[], timestamp: number): void {
    const byAsset = new Map<AssetKey, VenueInstrument[]>();
    const dynamic = new Map<AssetKey, AssetMeta>();

    for (const inst of instruments) {
      const list = byAsset.get(inst.assetKey);
      if (list) list.push(inst);
      else byAsset.set(inst.assetKey, [inst]);

      if (!getCuratedAsset(inst.assetKey) && !dynamic.has(inst.assetKey)) {
        dynamic.set(inst.assetKey, {
          symbol: inst.symbol,
          name: inst.symbol,
          category: inst.category,
        });
      }
    }

    this.instrumentsByAsset = byAsset;
    this.dynamicAssets = dynamic;
    this.timestamp = timestamp;
  }

  private notify(): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener();
      } catch (err) {
        console.error('[ExchangeCatalog] listener failed', err);
      }
    }
  }

  private async readCache(): Promise<void> {
    if (!isChromeStorageAvailable()) return;
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const cached = result?.[STORAGE_KEY] as PersistedCatalog | undefined;
    if (cached?.version !== 'v1' || !Array.isArray(cached.instruments)) return;
    this.apply(cached.instruments, cached.timestamp ?? 0);
  }

  private async writeCache(): Promise<void> {
    if (!isChromeStorageAvailable()) return;
    try {
      const payload: PersistedCatalog = {
        version: 'v1',
        timestamp: this.timestamp,
        instruments: this.allInstruments(),
      };
      await chrome.storage.local.set({ [STORAGE_KEY]: payload });
    } catch (err) {
      console.warn('[ExchangeCatalog] cache write failed', err);
    }
  }
}

function valueOf<T>(result: PromiseSettledResult<unknown>): T | null {
  return result.status === 'fulfilled' ? (result.value as T) : null;
}

export const exchangeCatalog = new ExchangeCatalog();
export { STORAGE_KEY as EXCHANGE_CATALOG_STORAGE_KEY };
