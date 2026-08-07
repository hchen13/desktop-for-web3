/**
 * DefiLlama Stablecoins 数据服务
 *
 * 单例服务，封装 DefiLlama Stablecoins API 的获取/缓存/订阅逻辑。
 * 同一份数据同时供多个 Widget 使用（StablePeg + RWATreasuries），避免重复请求。
 *
 * 缓存策略：
 * - in-memory cache（运行期）
 * - chrome.storage.local 持久化（启动恢复）
 * - TTL = 60s （主要面向 StablePeg 的脱锚监控；RWA 用同一份数据）
 *
 * 失败处理：
 * - fetch 失败时保留 stale 数据，notify 订阅者状态切换为 error
 * - notify 时附带 error，便于 UI 展示
 */
import { isChromeStorageAvailable } from './shared';
import type { StablecoinAsset, StablecoinsState, StablecoinSubscriber } from './types';

/** DefiLlama API endpoint */
const STABLECOINS_API = 'https://stablecoins.llama.fi/stablecoins?includePrices=true';

/** 缓存 TTL：60s，触发刷新阈值 */
const CACHE_TTL_MS = 60 * 1000;

/** 后台刷新间隔 */
const REFRESH_INTERVAL_MS = 60 * 1000;

/** chrome.storage.local 缓存键 */
const STORAGE_KEY = 'defillama_stablecoins_cache_v1';

/** 持久化结构 */
interface PersistedCache {
  version: 'v1';
  timestamp: number;
  assets: StablecoinAsset[];
}

/** DefiLlama API 原始响应类型（部分字段） */
interface RawDefiLlamaStablecoin {
  id?: string | number;
  name?: string;
  symbol?: string;
  pegType?: string;
  pegMechanism?: string;
  circulating?: Record<string, number> | number;
  circulatingPrevDay?: Record<string, number> | number;
  price?: number | null;
  gecko_id?: string;
  chains?: string[];
}

interface RawDefiLlamaResponse {
  peggedAssets?: RawDefiLlamaStablecoin[];
}

/** 安全提取数字（兼容 string / object 形式的 circulating） */
function extractCirculating(raw: RawDefiLlamaStablecoin['circulating']): number {
  if (raw == null) return 0;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'object') {
    // DefiLlama 返回 { peggedUSD: number, peggedEUR: ... } —— 取第一个有限值
    for (const k of Object.keys(raw)) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
  }
  return 0;
}

/**
 * 将原始 API 响应规范化为 StablecoinAsset[]
 * - 过滤无 symbol / 无 mcap 的条目
 * - 计算 24h delta
 * - 排序按 mcap 倒序
 */
export function normalizeStablecoins(raw: RawDefiLlamaResponse): StablecoinAsset[] {
  const list = Array.isArray(raw?.peggedAssets) ? raw.peggedAssets : [];
  const assets: StablecoinAsset[] = [];
  for (const item of list) {
    const symbol = (item?.symbol || '').toUpperCase();
    if (!symbol) continue;

    const mcap = extractCirculating(item.circulating);
    if (mcap <= 0) continue;

    const mcapPrev = extractCirculating(item.circulatingPrevDay);
    const price = typeof item.price === 'number' && Number.isFinite(item.price) ? item.price : null;

    let change24h: number | null = null;
    if (mcapPrev > 0 && mcap > 0) {
      change24h = ((mcap - mcapPrev) / mcapPrev) * 100;
    }

    assets.push({
      id: String(item.id ?? symbol),
      symbol,
      name: item.name || symbol,
      pegType: item.pegType || 'peggedUSD',
      pegMechanism: item.pegMechanism,
      mcap,
      mcapPrev: mcapPrev || null,
      change24h,
      price,
      chains: Array.isArray(item.chains) ? item.chains : [],
      geckoId: item.gecko_id,
    });
  }

  assets.sort((a, b) => b.mcap - a.mcap);
  return assets;
}

/** 计算稳定币偏离 1.0 的绝对百分比（仅对 USD 锚定币有意义） */
export function computePegDelta(asset: StablecoinAsset): number | null {
  if (asset.price == null) return null;
  if (!asset.pegType || asset.pegType === 'peggedUSD') {
    return Math.abs(asset.price - 1) * 100;
  }
  // 非 USD 锚定的 stablecoin 暂不计算
  return null;
}

/**
 * 偏移分级阈值 — UI 颜色编码用
 *  level 0: ≤ 0.2%   neutral
 *  level 1: 0.2–0.5% warn (yellow)
 *  level 2: 0.5–1.0% alert (orange)
 *  level 3: >1%      danger (red)
 */
export const PEG_DELTA_THRESHOLDS = {
  WARN: 0.2,
  ALERT: 0.5,
  DANGER: 1.0,
} as const;

export function classifyPegDelta(deltaPct: number | null): 0 | 1 | 2 | 3 {
  if (deltaPct == null || !Number.isFinite(deltaPct)) return 0;
  if (deltaPct > PEG_DELTA_THRESHOLDS.DANGER) return 3;
  if (deltaPct > PEG_DELTA_THRESHOLDS.ALERT) return 2;
  if (deltaPct > PEG_DELTA_THRESHOLDS.WARN) return 1;
  return 0;
}

/** 服务单例类 */
class StablecoinsService {
  private state: StablecoinsState = {
    assets: [],
    lastUpdated: null,
    status: 'idle',
    error: null,
  };

  private subscribers = new Set<StablecoinSubscriber>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<StablecoinAsset[]> | null = null;
  private restoredFromStorage = false;

  /** 同步获取当前状态（用于初次渲染） */
  getData(): StablecoinsState {
    return this.state;
  }

  /** 订阅状态变化；订阅时立即推送一次当前状态 */
  subscribe(callback: StablecoinSubscriber): () => void {
    this.subscribers.add(callback);
    // 立即同步当前状态
    try {
      callback(this.state);
    } catch (err) {
      console.error('[StablecoinsService] subscriber initial notify failed', err);
    }

    // 首次订阅时启动后台刷新与持久化恢复
    this.ensureBackgroundStarted();

    return () => {
      this.subscribers.delete(callback);
      if (this.subscribers.size === 0 && this.refreshTimer) {
        clearInterval(this.refreshTimer);
        this.refreshTimer = null;
      }
    };
  }

  /** 主动触发一次刷新（外部调用） */
  async refresh(force = false): Promise<StablecoinAsset[]> {
    if (!force && this.isFresh()) {
      return this.state.assets;
    }
    return this.fetchAndUpdate();
  }

  /**
   * 重置服务状态 —— 仅供测试使用
   */
  __resetForTest(): void {
    this.state = {
      assets: [],
      lastUpdated: null,
      status: 'idle',
      error: null,
    };
    this.subscribers.clear();
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.inFlight = null;
    this.restoredFromStorage = false;
  }

  // ============ 内部方法 ============

  private isFresh(): boolean {
    if (!this.state.lastUpdated) return false;
    return Date.now() - this.state.lastUpdated < CACHE_TTL_MS;
  }

  private ensureBackgroundStarted(): void {
    // 启动持久化恢复（一次性）
    if (!this.restoredFromStorage) {
      this.restoredFromStorage = true;
      void this.restoreFromStorage();
    }

    // 启动定时刷新
    if (this.refreshTimer == null && typeof setInterval === 'function') {
      this.refreshTimer = setInterval(() => {
        void this.fetchAndUpdate().catch(() => {
          /* swallowed */
        });
      }, REFRESH_INTERVAL_MS);
    }

    // 立即触发一次（如果数据已 stale 或为空）
    if (!this.isFresh() && !this.inFlight) {
      void this.fetchAndUpdate().catch(() => {
        /* swallowed */
      });
    }
  }

  private async restoreFromStorage(): Promise<void> {
    if (!isChromeStorageAvailable()) return;
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const cached = result?.[STORAGE_KEY] as PersistedCache | undefined;
      if (cached?.version === 'v1' && Array.isArray(cached.assets) && cached.assets.length > 0) {
        // 仅当当前内存为空时使用持久化数据填充
        if (this.state.assets.length === 0) {
          this.updateState({
            assets: cached.assets,
            lastUpdated: cached.timestamp,
            status: 'success',
            error: null,
          });
        }
      }
    } catch (err) {
      console.error('[StablecoinsService] restore from storage failed', err);
    }
  }

  private async persistToStorage(assets: StablecoinAsset[], timestamp: number): Promise<void> {
    if (!isChromeStorageAvailable()) return;
    try {
      const payload: PersistedCache = { version: 'v1', timestamp, assets };
      await chrome.storage.local.set({ [STORAGE_KEY]: payload });
    } catch (err) {
      console.error('[StablecoinsService] persist failed', err);
    }
  }

  private async fetchAndUpdate(): Promise<StablecoinAsset[]> {
    // 防并发
    if (this.inFlight) return this.inFlight;

    this.updateState({ ...this.state, status: 'loading' });

    const promise = (async () => {
      try {
        const resp = await fetch(STABLECOINS_API);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const json = (await resp.json()) as RawDefiLlamaResponse;
        const assets = normalizeStablecoins(json);
        const ts = Date.now();
        this.updateState({
          assets,
          lastUpdated: ts,
          status: 'success',
          error: null,
        });
        void this.persistToStorage(assets, ts);
        return assets;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        // 保留旧数据，仅切换状态
        this.updateState({
          ...this.state,
          status: 'error',
          error: errorMsg,
        });
        return this.state.assets;
      } finally {
        this.inFlight = null;
      }
    })();

    this.inFlight = promise;
    return promise;
  }

  private updateState(next: StablecoinsState): void {
    this.state = next;
    for (const cb of Array.from(this.subscribers)) {
      try {
        cb(next);
      } catch (err) {
        console.error('[StablecoinsService] subscriber callback failed', err);
      }
    }
  }
}

export const stablecoinsService = new StablecoinsService();
