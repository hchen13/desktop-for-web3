/**
 * Pyth 动态 catalog —— 启动时拉全量 price_feeds，转成 AssetMeta，缓存 24h。
 *
 * 让 watchlist selector 能搜到任何 Pyth 支持的标的（~2000 个），
 * 不局限于 curated 的 ~166 个 ASSETS。
 *
 * 与 ASSETS 的关系：
 *  - ASSETS 是「精选/默认展示」的 ~76 个常见标的，rank 决定排序，并兼有 logoSlug / cexPair 等额外字段
 *  - Dynamic catalog 是「全量可搜」的兜底，缺 cexPair（不影响 — Pyth-only 资产本来就没 CEX 对）
 *
 * 查询时 ASSETS 优先；ASSETS 没有的 symbol 才落到这里。
 */
import type { AssetMeta, AssetCategory } from './types';

const HERMES_BASE = 'https://hermes.pyth.network';
const STORAGE_KEY = 'pyth_catalog_v1';
const CACHE_TTL_MS = 24 * 3600 * 1000;

type Hex = string;

interface PythFeedAttrs {
  asset_type: string;
  base?: string;
  country?: string;
  description?: string;
  nasdaq_symbol?: string;
  cms_symbol?: string;
  cqs_symbol?: string;
  quote_currency?: string;
  display_symbol?: string;
}

interface PythFeedEntry {
  id: string;
  attributes: PythFeedAttrs;
}

/**
 * 把 Pyth 一条 feed 翻译成 AssetMeta，过滤掉 PRE/POST/OVERNIGHT 副本与非 USD quote。
 * 返回 null 表示这条不关心（外汇 base=USD、商品没有 base 等等）。
 */
export function classifyPythFeed(entry: PythFeedEntry): AssetMeta | null {
  const a = entry.attributes || {};
  const t = (a.asset_type || '').toLowerCase();
  const desc = a.description || '';

  // 跳过附属 schedule 副本
  if (/\b(POST|PRE) MARKET HOURS\b|\bOVERNIGHT HOURS\b/i.test(desc)) return null;

  let category: AssetCategory;
  let symbol: string;
  let name: string;

  if (t === 'crypto') {
    if (a.quote_currency !== 'USD') return null;
    category = 'crypto';
    symbol = (a.base || '').toUpperCase();
    name = symbol;
  } else if (t === 'equity') {
    if (a.country !== 'US' || a.quote_currency !== 'USD') return null;
    symbol = (a.nasdaq_symbol || a.cms_symbol || a.cqs_symbol || a.base || '').toUpperCase();
    // 取描述（去掉 / US DOLLAR 后缀）作为 name
    const clean = desc.replace(/\s*\/\s*US DOLLAR\s*$/i, '').trim();
    name = titleCase(clean) || symbol;
    // ETF 启发式
    category = /\b(ETF|TRUST|FUND|FUNDS|SHARES|INDEX)\b/i.test(clean) ? 'etf' : 'stock';
  } else if (t === 'fx') {
    if (!a.base || !a.quote_currency) return null;
    category = 'fx';
    symbol = a.base.toUpperCase() + a.quote_currency.toUpperCase();
    name = `${a.base}/${a.quote_currency}`;
  } else if (t === 'metal' || t === 'commodities' || t === 'commodity') {
    category = 'commodity';
    symbol = (a.base || '').toUpperCase();
    if (!symbol) return null;
    name = symbol;
  } else {
    return null;
  }

  if (!symbol) return null;
  const id = entry.id?.startsWith('0x')
    ? entry.id.toLowerCase()
    : `0x${(entry.id || '').toLowerCase()}`;
  return { symbol, name, category, pythFeedId: id as Hex };
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

interface PersistedCatalog {
  version: 'v1';
  timestamp: number;
  assets: AssetMeta[];
}

class DynamicCatalog {
  private bySymbol = new Map<string, AssetMeta>();
  private all: AssetMeta[] = [];
  private loadPromise: Promise<void> | null = null;
  private timestamp = 0;

  /** 触发加载（幂等）。先尝试缓存，再 fetch */
  async ensureLoaded(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.doLoad().catch((err) => {
      console.warn('[DynamicCatalog] load failed', err);
    });
    return this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    // 先看缓存
    const cached = await this.loadFromStorage();
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      this.applyAssets(cached.assets, cached.timestamp);
      return;
    }
    if (cached) {
      // 缓存过期但仍可用，先临时填充避免空白
      this.applyAssets(cached.assets, cached.timestamp);
    }

    // 拉新数据
    const types = ['crypto', 'equity', 'fx', 'metal', 'commodities'];
    const allFresh: AssetMeta[] = [];
    await Promise.all(
      types.map(async (t) => {
        try {
          const resp = await fetch(`${HERMES_BASE}/v2/price_feeds?asset_type=${t}`);
          if (!resp.ok) return;
          const json = (await resp.json()) as PythFeedEntry[];
          for (const entry of json) {
            const meta = classifyPythFeed(entry);
            if (meta) allFresh.push(meta);
          }
        } catch (err) {
          console.warn(`[DynamicCatalog] fetch ${t} failed`, err);
        }
      }),
    );

    if (allFresh.length === 0 && this.all.length === 0) return;
    // dedupe 取首次出现
    const map = new Map<string, AssetMeta>();
    for (const a of allFresh) if (!map.has(a.symbol)) map.set(a.symbol, a);
    const deduped = Array.from(map.values());
    if (deduped.length > 0) {
      this.applyAssets(deduped, Date.now());
      void this.persistToStorage();
    }
  }

  private applyAssets(assets: AssetMeta[], ts: number): void {
    const map = new Map<string, AssetMeta>();
    for (const a of assets) map.set(a.symbol, a);
    this.bySymbol = map;
    this.all = assets;
    this.timestamp = ts;
  }

  private async loadFromStorage(): Promise<PersistedCatalog | null> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const cached = result?.[STORAGE_KEY] as PersistedCatalog | undefined;
      if (cached && cached.version === 'v1' && Array.isArray(cached.assets)) return cached;
    } catch {
      /* ignore */
    }
    return null;
  }

  private async persistToStorage(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    try {
      const payload: PersistedCatalog = {
        version: 'v1',
        timestamp: this.timestamp,
        assets: this.all,
      };
      await chrome.storage.local.set({ [STORAGE_KEY]: payload });
    } catch {
      /* ignore */
    }
  }

  /** 按 symbol 取（精确匹配） */
  get(symbol: string): AssetMeta | null {
    return this.bySymbol.get(symbol) ?? null;
  }

  /** 按 query 模糊搜索（symbol 或 name 包含），可指定 category 过滤 */
  search(query: string, category?: AssetCategory | 'all'): AssetMeta[] {
    const q = query.trim().toUpperCase();
    if (!q) return [];
    const cat = category && category !== 'all' ? category : null;
    const out: AssetMeta[] = [];
    const symbolStarts: AssetMeta[] = [];
    const symbolContains: AssetMeta[] = [];
    const nameContains: AssetMeta[] = [];
    for (const a of this.all) {
      if (cat && a.category !== cat) continue;
      const sym = a.symbol;
      const name = a.name.toUpperCase();
      if (sym === q) {
        out.push(a);
      } else if (sym.startsWith(q)) {
        symbolStarts.push(a);
      } else if (sym.includes(q)) {
        symbolContains.push(a);
      } else if (name.includes(q)) {
        nameContains.push(a);
      }
    }
    // 按精确度排序：完全相等 > symbol startsWith > symbol contains > name contains
    return [...out, ...symbolStarts, ...symbolContains, ...nameContains].slice(0, 100);
  }

  /** 是否已经有数据可用（即使是过期缓存） */
  isLoaded(): boolean {
    return this.bySymbol.size > 0;
  }

  /** 仅供测试 */
  __resetForTest(): void {
    this.bySymbol.clear();
    this.all = [];
    this.loadPromise = null;
    this.timestamp = 0;
  }
}

export const dynamicCatalog = new DynamicCatalog();
