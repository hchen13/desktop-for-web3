/**
 * PriceService — 多源价格 orchestrator（singleton）
 *
 * - 启动时并行 probe 所有 CEX REST adapter，按延迟排序
 * - 60s 轮询 PRIMARY adapter（失败回退到下一个）
 * - 对有 pythFeedId 的资产用 Hermes 实时层覆盖 price 字段
 * - subscribe 时维护 union watch list，仅 fetch 必要资产
 * - chrome.storage.local 持久化最新 snapshot 用于冷启动
 */

import type {
  AssetMeta,
  PriceCallback,
  PriceSnapshot,
  PriceSubscriber,
  SourceAdapter,
} from './types';
import { ASSETS, getAssetMeta } from './assets';
import { okxAdapter } from './sources/okx';
import { bitgetAdapter } from './sources/bitget';
import { bybitAdapter } from './sources/bybit';
import { coinbaseAdapter } from './sources/coinbase';
import { fetchPythLatest, fetchPythPrevDayClose, openPythStream } from './sources/pyth';
import { dynamicCatalog } from './dynamicCatalog';

const STORAGE_KEY = 'prices_cache_v1';
const REST_INTERVAL_MS = 60 * 1000;
const PROBE_TIMEOUT_MS = 3000;
const FETCH_TIMEOUT_MS = 8000;
const BACKGROUND_REFRESH_DEDUPE_MS = 5000;

interface PersistedCache {
  version: 'v1';
  snapshots: Record<string, PriceSnapshot>;
}

function isChromeStorageAvailable(): boolean {
  try {
    return (
      typeof chrome !== 'undefined' &&
      !!chrome.storage &&
      !!chrome.storage.local &&
      typeof chrome.storage.local.get === 'function'
    );
  } catch {
    return false;
  }
}

export class PriceService {
  private snapshots = new Map<string, PriceSnapshot>();
  private subscribers = new Set<PriceSubscriber>();
  private adapters: SourceAdapter[] = [okxAdapter, bitgetAdapter, bybitAdapter, coinbaseAdapter];
  /** probe 后按延迟排序的 adapter 列表（优先用 [0]） */
  private rankedAdapters: SourceAdapter[] = [];
  private probeStarted = false;
  private probePromise: Promise<void> | null = null;
  private restTimer: ReturnType<typeof setInterval> | null = null;
  private pythCleanup: (() => void) | null = null;
  private restoredFromStorage = false;
  private restInFlight: Promise<void> | null = null;
  private pendingTargets = new Set<string>();
  private lastFetchAttemptAt = new Map<string, number>();

  /** 公开：获取单个 symbol 的最新 snapshot（无则 null） */
  getSnapshot(symbol: string): PriceSnapshot | null {
    return this.snapshots.get(symbol) ?? null;
  }

  /** 公开：订阅一批 symbols 的更新；返回 unsubscribe */
  subscribe(symbols: Set<string>, callback: PriceCallback): () => void {
    const sub: PriceSubscriber = { symbols: new Set(symbols), callback };
    this.subscribers.add(sub);

    // 触发后台启动
    void this.ensureStarted();

    // 立即推一次现有数据
    try {
      callback(this.snapshotsFor(sub.symbols));
    } catch (err) {
      console.error('[PriceService] subscriber initial notify failed', err);
    }

    return () => {
      this.subscribers.delete(sub);
      // 重新评估订阅；不再 watch 的 symbol 自动停 fetch（下一轮自然跳过）
      this.maybeReconfigurePyth();
    };
  }

  /** 公开：主动刷新（不指定则刷新当前 union） */
  async refresh(symbols?: Set<string>): Promise<void> {
    const targets = symbols ?? this.unionSymbols();
    if (targets.size === 0) return;
    await this.fetchOnce(targets);
  }

  /** 仅供测试 */
  __resetForTest(): void {
    this.snapshots.clear();
    this.subscribers.clear();
    this.rankedAdapters = [];
    this.probeStarted = false;
    this.probePromise = null;
    this.restoredFromStorage = false;
    this.restInFlight = null;
    this.pendingTargets.clear();
    this.lastFetchAttemptAt.clear();
    if (this.restTimer) {
      clearInterval(this.restTimer);
      this.restTimer = null;
    }
    if (this.pythCleanup) {
      this.pythCleanup();
      this.pythCleanup = null;
    }
  }

  /** 仅供测试 — 注入 adapter 列表 */
  __setAdaptersForTest(adapters: SourceAdapter[]): void {
    this.adapters = adapters.slice();
    this.rankedAdapters = [];
    this.probeStarted = false;
    this.probePromise = null;
  }

  /** 仅供测试 — 读取当前 ranked adapter 名字列表 */
  __getRankedAdapters(): string[] {
    return this.rankedAdapters.map((a) => a.name);
  }

  async __waitForStartupForTest(): Promise<void> {
    await this.ensureStarted();
    if (this.probePromise) {
      await this.probePromise;
    }
  }

  // ============ 内部 ============

  private unionSymbols(): Set<string> {
    const out = new Set<string>();
    for (const sub of this.subscribers) {
      for (const s of sub.symbols) out.add(s);
    }
    return out;
  }

  private snapshotsFor(symbols: Set<string>): Map<string, PriceSnapshot> {
    const out = new Map<string, PriceSnapshot>();
    for (const s of symbols) {
      const snap = this.snapshots.get(s);
      if (snap) out.set(s, snap);
    }
    return out;
  }

  private async ensureStarted(): Promise<void> {
    if (!this.restoredFromStorage) {
      this.restoredFromStorage = true;
      await this.restoreFromStorage();
      this.notifyAll();
    }
    // 后台触发动态 catalog 加载（不 await，让 selector 打开时大概率已就绪）
    void dynamicCatalog.ensureLoaded();
    if (!this.probeStarted) {
      this.probeStarted = true;
      this.probePromise = this.probeAdapters()
        .then(() => {
          const union = this.unionSymbols();
          if (union.size > 0) void this.fetchOnce(union, false);
          if (this.restTimer == null && typeof setInterval === 'function') {
            this.restTimer = setInterval(() => {
              const cur = this.unionSymbols();
              if (cur.size === 0) return;
              void this.fetchOnce(cur).catch(() => {});
            }, REST_INTERVAL_MS);
          }
          this.maybeReconfigurePyth();
        })
        .catch((err) => console.error('[PriceService] probe chain failed', err));
    }
  }

  private async probeAdapters(): Promise<void> {
    const results = await Promise.all(
      this.adapters.map(async (a) => {
        try {
          const latency = await this.withTimeout(a.probe(), PROBE_TIMEOUT_MS, 'probe timeout');
          return { adapter: a, latency, ok: true as const };
        } catch (err) {
          return { adapter: a, latency: Infinity, ok: false as const, err };
        }
      }),
    );
    const ok = results.filter((r) => r.ok).sort((a, b) => a.latency - b.latency);
    const failed = results.filter((r) => !r.ok).map((r) => r.adapter);
    this.rankedAdapters = [...ok.map((r) => r.adapter), ...failed];
  }

  private async fetchOnce(targets: Set<string>, force = true): Promise<void> {
    if (targets.size === 0) return;
    const nextTargets = force ? targets : this.filterRecentlyRequestedTargets(targets);
    if (nextTargets.size === 0) return;

    for (const target of nextTargets) {
      this.pendingTargets.add(target);
    }

    if (this.restInFlight) {
      await this.restInFlight;
      return;
    }

    this.restInFlight = this.drainFetchQueue().finally(() => {
      this.restInFlight = null;
    });
    await this.restInFlight;
  }

  private async drainFetchQueue(): Promise<void> {
    while (true) {
      if (this.pendingTargets.size === 0) {
        await Promise.resolve();
        if (this.pendingTargets.size === 0) return;
      }

      const batch = new Set(this.pendingTargets);
      this.pendingTargets.clear();
      const startedAt = Date.now();
      for (const symbol of batch) {
        this.lastFetchAttemptAt.set(symbol, startedAt);
      }
      await this.doFetchOnce(batch);
    }
  }

  private filterRecentlyRequestedTargets(targets: Set<string>): Set<string> {
    const now = Date.now();
    const out = new Set<string>();
    for (const symbol of targets) {
      const lastAttempt = this.lastFetchAttemptAt.get(symbol) ?? 0;
      if (now - lastAttempt >= BACKGROUND_REFRESH_DEDUPE_MS) {
        out.add(symbol);
      }
    }
    return out;
  }

  private async doFetchOnce(targets: Set<string>): Promise<void> {
    const assets: AssetMeta[] = [];
    for (const sym of targets) {
      const m = getAssetMeta(sym);
      if (m) assets.push(m);
    }
    if (assets.length === 0) return;

    // CEX REST：按 ranked 顺序填补缺失 crypto symbol
    const ranked = this.rankedAdapters.length > 0 ? this.rankedAdapters : this.adapters;
    const remainingCexSymbols = new Set(
      assets.filter((a) => a.category === 'crypto' && a.cexPair).map((a) => a.symbol),
    );

    for (const adapter of ranked) {
      const adapterAssets = assets.filter((a) => remainingCexSymbols.has(a.symbol));
      if (adapterAssets.length === 0) break;

      try {
        const got = await this.withTimeout(
          adapter.fetchPrices(adapterAssets),
          FETCH_TIMEOUT_MS,
          `${adapter.name} fetch timeout`,
        );
        if (got.size > 0) {
          for (const [sym, snap] of got) {
            this.applySnapshot(sym, snap);
            remainingCexSymbols.delete(sym);
          }
        }
      } catch (err) {
        console.warn(`[PriceService] adapter ${adapter.name} failed`, err);
      }
    }

    // Pyth REST 兜底（覆盖 price，但保留 CEX 的 24h%）
    try {
      const pythResult = await this.withTimeout(
        fetchPythLatest(assets),
        FETCH_TIMEOUT_MS,
        'pyth latest timeout',
      );
      for (const [sym, pSnap] of pythResult) {
        this.mergePythPrice(sym, pSnap);
      }
    } catch (err) {
      console.warn('[PriceService] pyth latest failed', err);
    }

    // 给缺 24h% 的资产（主要是 stocks/ETFs，CEX 不支持）从 Pyth benchmarks 算 prevDayClose
    const needsChange = assets.filter((a) => {
      const snap = this.snapshots.get(a.symbol);
      return snap && snap.change24h == null && (a.category === 'stock' || a.category === 'etf');
    });
    if (needsChange.length > 0) {
      try {
        const prevCloses = await this.withTimeout(
          fetchPythPrevDayClose(needsChange),
          FETCH_TIMEOUT_MS,
          'pyth benchmark timeout',
        );
        for (const [sym, prevClose] of prevCloses) {
          const cur = this.snapshots.get(sym);
          if (!cur || prevClose <= 0) continue;
          const change = ((cur.price - prevClose) / prevClose) * 100;
          this.snapshots.set(sym, { ...cur, change24h: change });
        }
      } catch (err) {
        console.warn('[PriceService] pyth benchmark failed', err);
      }
    }

    void this.persistToStorage();
    this.notifyAll();
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private applySnapshot(symbol: string, snap: PriceSnapshot): void {
    const cur = this.snapshots.get(symbol);
    // 更新；若旧快照来自 pyth 且 ts 更近则保留 price 字段
    if (cur && cur.source === 'pyth' && cur.lastUpdate >= snap.lastUpdate - 10_000) {
      this.snapshots.set(symbol, {
        ...snap,
        price: cur.price,
        source: cur.source,
        lastUpdate: cur.lastUpdate,
      });
    } else {
      this.snapshots.set(symbol, snap);
    }
  }

  private mergePythPrice(symbol: string, pSnap: PriceSnapshot): void {
    const cur = this.snapshots.get(symbol);
    if (!cur) {
      this.snapshots.set(symbol, pSnap);
      return;
    }
    this.snapshots.set(symbol, {
      ...cur,
      price: pSnap.price,
      lastUpdate: pSnap.lastUpdate,
      source: 'pyth',
    });
  }

  private maybeReconfigurePyth(): void {
    if (typeof EventSource === 'undefined') return;
    if (this.pythCleanup) {
      this.pythCleanup();
      this.pythCleanup = null;
    }
    const union = this.unionSymbols();
    const assets: AssetMeta[] = [];
    for (const sym of union) {
      const m = getAssetMeta(sym);
      if (m && m.pythFeedId) assets.push(m);
    }
    if (assets.length === 0) return;
    this.pythCleanup = openPythStream(assets, (snap) => {
      this.mergePythPrice(snap.symbol, snap);
      this.notifyAll();
    });
  }

  private notifyAll(): void {
    for (const sub of Array.from(this.subscribers)) {
      try {
        sub.callback(this.snapshotsFor(sub.symbols));
      } catch (err) {
        console.error('[PriceService] subscriber callback failed', err);
      }
    }
  }

  private async restoreFromStorage(): Promise<void> {
    if (!isChromeStorageAvailable()) return;
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const cached = result?.[STORAGE_KEY] as PersistedCache | undefined;
      if (cached?.version === 'v1' && cached.snapshots) {
        for (const [sym, snap] of Object.entries(cached.snapshots)) {
          if (snap && typeof snap.price === 'number') {
            this.snapshots.set(sym, snap);
          }
        }
      }
    } catch (err) {
      console.error('[PriceService] restore failed', err);
    }
  }

  private async persistToStorage(): Promise<void> {
    if (!isChromeStorageAvailable()) return;
    try {
      const out: Record<string, PriceSnapshot> = {};
      for (const [k, v] of this.snapshots) out[k] = v;
      const payload: PersistedCache = { version: 'v1', snapshots: out };
      await chrome.storage.local.set({ [STORAGE_KEY]: payload });
    } catch (err) {
      console.error('[PriceService] persist failed', err);
    }
  }
}

/** 单例 */
export const priceService = new PriceService();

/** 便利导出：所有可用资产 */
export { ASSETS };
