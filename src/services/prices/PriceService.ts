/**
 * PriceService —— 交易所公开行情 orchestrator（singleton）
 *
 * 展示的是「Crypto 交易所提供的股票关联产品参考价」，不是 Nasdaq/NYSE consolidated
 * tape，也不等价于传统美股 NBBO。
 *
 * 数据流：
 *   AssetKey → instrument 解析（catalog 优先，冷启动用保守 candidate + targeted 验证）
 *            → targeted REST / 每 venue 一条 WebSocket
 *            → QuoteStore（每个 instrument 时间戳单调）
 *            → 同 Tier 同 PriceKind 聚合 → PriceSnapshot
 *
 * 周期报价只请求当前 active Watchlist union 的 selected AssetKeys，
 * 任何情况下都不请求全市场 ticker。
 */

import type {
  AssetKey,
  PriceCallback,
  PriceSnapshot,
  PriceSubscription,
  VenueInstrument,
  VenueQuote,
} from './types';
import { assetKeySymbol, migrateAssetKey } from './assetKey';
import { aggregateSnapshot, unavailableSnapshot } from './aggregate';
import { exchangeCatalog } from './exchangeCatalog';
import {
  candidateInstruments,
  catalogInstrumentsFor,
  fallbackMetaFor,
  instrumentTier,
  type SourceTier,
} from './instrumentResolver';
import { QuoteStore } from './quoteStore';
import { QuoteSocketPool } from './socket';
import { TransportLifecycle, type TransportMode } from './lifecycle';
import { fetchTargetedQuotes, SOCKET_ENDPOINTS } from './venues';

const SNAPSHOT_STORAGE_KEY = 'prices_cache_v2';
/** 上一代缓存 key，升级时直接清掉，绝不能当作 fresh exchange quote 复用 */
const OBSOLETE_STORAGE_KEYS = ['prices_cache_v1', 'pyth_catalog_v1'];

/** WebSocket 覆盖不到的 instrument（Binance TradFi 永续）的兜底刷新间隔 */
export const WS_UNCOVERED_REFRESH_MS = 60_000;
/** WebSocket 高频推送合并成 UI 通知的最小间隔 */
export const NOTIFY_COALESCE_MS = 250;
/** 各模式下报价的新鲜度窗口 */
export const FRESHNESS_WINDOW_MS: Record<TransportMode, number> = {
  off: 5 * 60_000,
  realtime: 3 * 60_000,
  'passive-visible': 5 * 60_000,
  'passive-hidden': 20 * 60_000,
};

interface PersistedSnapshots {
  version: 'v2';
  snapshots: Record<AssetKey, PriceSnapshot>;
}

interface SubscriptionRecord {
  assetKeys: Set<AssetKey>;
  active: boolean;
  callback: PriceCallback;
}

function isChromeStorageAvailable(): boolean {
  try {
    return typeof chrome !== 'undefined' && !!chrome.storage?.local?.get;
  } catch {
    return false;
  }
}

function normalizeKeys(assetKeys: Set<AssetKey>): Set<AssetKey> {
  const out = new Set<AssetKey>();
  for (const key of assetKeys) out.add(migrateAssetKey(key));
  return out;
}

export class PriceService {
  private snapshots = new Map<AssetKey, PriceSnapshot>();
  private subscriptions = new Set<SubscriptionRecord>();
  private quotes = new QuoteStore();
  private resolved = new Map<AssetKey, VenueInstrument[]>();
  private resolving = new Map<AssetKey, Promise<VenueInstrument[]>>();
  private tierFloor = new Map<AssetKey, SourceTier>();
  private unavailable = new Set<AssetKey>();
  private refreshInFlight = new Map<AssetKey, Promise<void>>();

  private pool = new QuoteSocketPool(SOCKET_ENDPOINTS, (quotes) => this.onSocketQuotes(quotes));
  private lifecycle = new TransportLifecycle({
    hasWork: () => this.desiredInstruments.length > 0,
    onModeChange: (mode, previous) => this.onModeChange(mode, previous),
    onPassiveTick: () => {
      void this.refreshAssets().catch(() => {});
    },
  });
  protected desiredInstruments: VenueInstrument[] = [];
  private currentUnion = new Set<AssetKey>();

  private reconcileScheduled = false;
  private reconcilePromise: Promise<void> | null = null;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private uncoveredTimer: ReturnType<typeof setTimeout> | null = null;
  private restorePromise: Promise<void> | null = null;

  getSnapshot(assetKey: AssetKey): PriceSnapshot | null {
    return this.snapshots.get(migrateAssetKey(assetKey)) ?? null;
  }

  /**
   * 稳定订阅 handle —— 换币只调 updateAssets，不重建 subscriber，
   * 避免 union 瞬间清空导致所有连接被关掉又重连。
   */
  subscribe(assetKeys: Set<AssetKey>, callback: PriceCallback): PriceSubscription {
    const record: SubscriptionRecord = {
      assetKeys: normalizeKeys(assetKeys),
      active: true,
      callback,
    };
    this.subscriptions.add(record);
    void this.ensureRestored();
    this.scheduleReconcile();
    this.pushTo(record);

    return {
      updateAssets: (next) => {
        record.assetKeys = normalizeKeys(next);
        this.scheduleReconcile();
        this.pushTo(record);
      },
      setActive: (active) => {
        if (record.active === active) return;
        record.active = active;
        this.scheduleReconcile();
      },
      unsubscribe: () => {
        this.subscriptions.delete(record);
        this.scheduleReconcile();
      },
    };
  }

  /** 对指定 AssetKey（默认为当前 active union）立即做一次 targeted 刷新 */
  async refreshAssets(assetKeys?: Set<AssetKey>): Promise<void> {
    const targets = assetKeys ? normalizeKeys(assetKeys) : this.activeUnion();
    if (targets.size === 0) return;

    const waiting: Array<Promise<void>> = [];
    const todo: AssetKey[] = [];
    for (const key of targets) {
      const inFlight = this.refreshInFlight.get(key);
      if (inFlight) waiting.push(inFlight);
      else todo.push(key);
    }

    if (todo.length > 0) {
      const run = this.doRefresh(todo).finally(() => {
        for (const key of todo) this.refreshInFlight.delete(key);
      });
      for (const key of todo) this.refreshInFlight.set(key, run);
      waiting.push(run);
    }

    await Promise.all(waiting);
  }

  /** 关闭所有行情连接与 timer */
  stopTransport(): void {
    this.pool.closeAll();
    this.clearUncoveredTimer();
  }

  __resetForTest(): void {
    this.lifecycle.stop();
    this.stopTransport();
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }
    this.snapshots.clear();
    this.subscriptions.clear();
    this.quotes.clear();
    this.resolved.clear();
    this.resolving.clear();
    this.tierFloor.clear();
    this.unavailable.clear();
    this.refreshInFlight.clear();
    this.desiredInstruments = [];
    this.currentUnion.clear();
    this.reconcileScheduled = false;
    this.reconcilePromise = null;
    this.restorePromise = null;
  }

  __desiredInstrumentsForTest(): VenueInstrument[] {
    return this.desiredInstruments.slice();
  }

  __connectionCountForTest(): number {
    return this.pool.connectionCount();
  }

  /** 等待订阅变化、instrument 解析与刷新全部落定 */
  async __settleForTest(): Promise<void> {
    for (let i = 0; i < 8; i += 1) {
      await this.ensureRestored();
      await Promise.resolve();
      if (this.reconcilePromise) await this.reconcilePromise;
      await Promise.all(Array.from(this.resolving.values()));
      await Promise.all(Array.from(this.refreshInFlight.values()));
      if (!this.reconcileScheduled && this.refreshInFlight.size === 0 && !this.reconcilePromise) {
        return;
      }
    }
  }

  // ============ union / reconcile ============

  protected activeUnion(): Set<AssetKey> {
    const out = new Set<AssetKey>();
    for (const record of this.subscriptions) {
      if (!record.active) continue;
      for (const key of record.assetKeys) out.add(key);
    }
    return out;
  }

  /**
   * 所有 subscriber / layout 变化合并到一个 microtask 里处理，
   * 否则「旧 layout 先 unsubscribe、新 layout 再 subscribe」会在中间产生空 union，
   * 导致所有连接被关掉又立刻重建。
   */
  protected scheduleReconcile(): void {
    if (this.reconcileScheduled) return;
    this.reconcileScheduled = true;
    queueMicrotask(() => {
      this.reconcileScheduled = false;
      this.reconcilePromise = this.reconcile().finally(() => {
        this.reconcilePromise = null;
      });
    });
  }

  private async reconcile(): Promise<void> {
    await this.ensureRestored();
    const union = this.activeUnion();
    const added = [...union].filter((key) => !this.currentUnion.has(key));
    const removed = [...this.currentUnion].filter((key) => !union.has(key));
    this.currentUnion = union;

    for (const key of removed) {
      this.quotes.dropAsset(key);
      this.refreshInFlight.delete(key);
    }

    if (union.size === 0) {
      this.desiredInstruments = [];
      this.applyTransport();
      return;
    }

    await Promise.all([...union].map((key) => this.ensureResolved(key)));
    for (const key of union) this.recompute(key);
    this.desiredInstruments = [...union].flatMap((key) => this.preferredInstruments(key));
    this.applyTransport();
    this.notifyNow();

    if (added.length > 0) {
      void this.refreshAssets(new Set(added)).catch(() => {});
    }
  }

  /** 传输层落地：先让状态机判定模式，再把当前 desired set 应用到已开的连接上 */
  protected applyTransport(): void {
    this.lifecycle.start();
    this.lifecycle.reconcileDesiredMode();
    if (this.lifecycle.getMode() === 'realtime' && this.desiredInstruments.length > 0) {
      this.pool.setDesiredInstruments(this.desiredInstruments);
      this.startUncoveredTimer();
    }
  }

  private onModeChange(mode: TransportMode, previous: TransportMode): void {
    if (mode === 'realtime') {
      this.pool.setDesiredInstruments(this.desiredInstruments);
      this.startUncoveredTimer();
      // 从 passive / off 回到 REALTIME 时立即补一次；宽限期内根本不会走到这里，
      // 所以不会因为快速 focus/blur 抖动产生额外请求或重连
      if (previous !== 'realtime') void this.refreshAssets().catch(() => {});
      return;
    }
    this.pool.closeAll();
    this.clearUncoveredTimer();
  }

  protected freshnessWindowMs(): number {
    return FRESHNESS_WINDOW_MS[this.lifecycle.getMode()];
  }

  __transportModeForTest(): TransportMode {
    return this.lifecycle.getMode();
  }

  // ============ instrument 解析 ============

  private preferredInstruments(assetKey: AssetKey): VenueInstrument[] {
    const all = this.resolved.get(assetKey) ?? [];
    const floor = this.tierFloor.get(assetKey) ?? 1;
    for (const tier of [1, 2, 3] as const) {
      if (tier < floor) continue;
      const inTier = all.filter((instrument) => instrumentTier(instrument) === tier);
      if (inTier.length > 0) return inTier;
    }
    return [];
  }

  private ensureResolved(assetKey: AssetKey): Promise<VenueInstrument[]> {
    const existing = this.resolved.get(assetKey);
    if (existing && existing.length > 0) return Promise.resolve(existing);
    const pending = this.resolving.get(assetKey);
    if (pending) return pending;

    const promise = this.doResolve(assetKey).finally(() => {
      this.resolving.delete(assetKey);
    });
    this.resolving.set(assetKey, promise);
    return promise;
  }

  private async doResolve(assetKey: AssetKey): Promise<VenueInstrument[]> {
    // 只读本地 catalog 缓存；解析永远不会触发远程 catalog 刷新
    await exchangeCatalog.loadCachedOnly();

    const fromCatalog = catalogInstrumentsFor(assetKey);
    if (fromCatalog.length > 0) {
      this.resolved.set(assetKey, fromCatalog);
      this.unavailable.delete(assetKey);
      return fromCatalog;
    }

    const verified: VenueInstrument[] = [];
    for (const tier of [1, 2] as const) {
      const candidates = candidateInstruments(assetKey, tier);
      if (candidates.length === 0) continue;
      const quotes = await fetchTargetedQuotes(candidates);
      if (quotes.length === 0) continue;
      const liveIds = new Set(quotes.map((quote) => `${quote.venue}|${quote.instrumentId}`));
      verified.push(...candidates.filter((c) => liveIds.has(`${c.venue}|${c.instrumentId}`)));
      for (const quote of quotes) this.quotes.ingest(quote);
      break;
    }

    this.resolved.set(assetKey, verified);
    if (verified.length === 0) {
      this.unavailable.add(assetKey);
    } else {
      this.unavailable.delete(assetKey);
      void exchangeCatalog.mergeResolvedInstruments(verified);
    }
    return verified;
  }

  // ============ 报价获取 ============

  private async doRefresh(assetKeys: AssetKey[]): Promise<void> {
    await Promise.all(assetKeys.map((key) => this.ensureResolved(key)));

    const instruments = assetKeys.flatMap((key) => this.preferredInstruments(key));
    if (instruments.length > 0) {
      const quotes = await fetchTargetedQuotes(instruments);
      for (const quote of quotes) this.quotes.ingest(quote);
    }

    for (const key of assetKeys) this.promoteTierIfEmpty(key);
    for (const key of assetKeys) this.recompute(key);
    this.notifyNow();
    void this.persist();
  }

  /** 首选层完全拿不到报价时，下沉到下一个有 instrument 的层 */
  private promoteTierIfEmpty(assetKey: AssetKey): void {
    const preferred = this.preferredInstruments(assetKey);
    if (preferred.length === 0) return;
    const ids = new Set(preferred.map((i) => `${i.venue}|${i.instrumentId}`));
    const hasQuote = this.quotes
      .quotesFor(assetKey)
      .some((quote) => ids.has(`${quote.venue}|${quote.instrumentId}`));
    if (hasQuote) return;

    const currentTier = instrumentTier(preferred[0]);
    const all = this.resolved.get(assetKey) ?? [];
    for (const tier of [1, 2, 3] as const) {
      if (tier <= currentTier) continue;
      if (all.some((instrument) => instrumentTier(instrument) === tier)) {
        this.tierFloor.set(assetKey, tier);
        this.desiredInstruments = [...this.currentUnion].flatMap((key) =>
          this.preferredInstruments(key),
        );
        this.applyTransport();
        return;
      }
    }
  }

  private onSocketQuotes(quotes: VenueQuote[]): void {
    const touched = new Set<AssetKey>();
    for (const quote of quotes) {
      if (this.quotes.ingest(quote)) touched.add(quote.assetKey);
    }
    if (touched.size === 0) return;
    for (const key of touched) this.recompute(key);
    this.scheduleNotify();
  }

  private recompute(assetKey: AssetKey): void {
    const meta = fallbackMetaFor(assetKey);
    if (!meta) return;

    const quotes = this.quotes.quotesFor(assetKey);
    if (quotes.length === 0) {
      if (this.unavailable.has(assetKey)) {
        this.snapshots.set(
          assetKey,
          unavailableSnapshot(assetKey, meta.symbol, this.snapshots.get(assetKey)),
        );
      }
      return;
    }

    const snapshot = aggregateSnapshot({
      assetKey,
      symbol: meta.symbol,
      category: meta.category,
      quotes,
      now: Date.now(),
      freshnessWindowMs: this.freshnessWindowMs(),
    });
    if (snapshot) this.snapshots.set(assetKey, snapshot);
  }

  // ============ WS 未覆盖兜底 ============

  protected uncoveredAssets(): Set<AssetKey> {
    const covered = this.pool.coveredInstrumentIds(this.desiredInstruments);
    const out = new Set<AssetKey>();
    for (const instrument of this.desiredInstruments) {
      if (!covered.has(instrument.instrumentId)) out.add(instrument.assetKey);
    }
    return out;
  }

  private startUncoveredTimer(): void {
    if (this.uncoveredTimer) return;
    if (this.uncoveredAssets().size === 0) return;
    this.uncoveredTimer = setTimeout(() => {
      this.uncoveredTimer = null;
      const targets = this.uncoveredAssets();
      if (targets.size === 0) return;
      void this.refreshAssets(targets).catch(() => {});
      this.startUncoveredTimer();
    }, WS_UNCOVERED_REFRESH_MS);
  }

  protected clearUncoveredTimer(): void {
    if (this.uncoveredTimer) {
      clearTimeout(this.uncoveredTimer);
      this.uncoveredTimer = null;
    }
  }

  // ============ 通知 ============

  /** WebSocket 高频推送合并成最多每 250ms 一次 UI 通知 */
  private scheduleNotify(): void {
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.notifyNow();
    }, NOTIFY_COALESCE_MS);
  }

  protected notifyNow(): void {
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }
    for (const record of Array.from(this.subscriptions)) this.pushTo(record);
  }

  private pushTo(record: SubscriptionRecord): void {
    try {
      record.callback(this.snapshotsFor(record.assetKeys));
    } catch (err) {
      console.error('[PriceService] subscriber callback failed', err);
    }
  }

  private snapshotsFor(assetKeys: Set<AssetKey>): Map<AssetKey, PriceSnapshot> {
    const out = new Map<AssetKey, PriceSnapshot>();
    for (const key of assetKeys) {
      const snapshot = this.snapshots.get(key);
      if (snapshot) out.set(key, snapshot);
    }
    return out;
  }

  // ============ 持久化 ============

  private ensureRestored(): Promise<void> {
    if (!this.restorePromise) {
      this.restorePromise = this.restore().catch((err) => {
        console.error('[PriceService] restore failed', err);
      });
    }
    return this.restorePromise;
  }

  private async restore(): Promise<void> {
    if (!isChromeStorageAvailable()) return;
    void chrome.storage.local.remove(OBSOLETE_STORAGE_KEYS);

    const result = await chrome.storage.local.get(SNAPSHOT_STORAGE_KEY);
    const cached = result?.[SNAPSHOT_STORAGE_KEY] as PersistedSnapshots | undefined;
    if (cached?.version !== 'v2' || !cached.snapshots) return;

    for (const [rawKey, snapshot] of Object.entries(cached.snapshots)) {
      if (!snapshot || typeof snapshot.price !== 'number') continue;
      const key = migrateAssetKey(rawKey);
      const existing = this.snapshots.get(key);
      // 迁移后的 XYZ 已有更新数据时，旧的 SQ 缓存不得覆盖
      if (existing && existing.lastUpdate >= snapshot.lastUpdate) continue;
      this.snapshots.set(key, {
        ...snapshot,
        assetKey: key,
        symbol: assetKeySymbol(key),
        // 冷启动缓存只用于立即渲染，永远不是 fresh exchange quote
        quality: 'stale',
        coverageTier: 'stale',
      });
    }
    this.notifyNow();
  }

  private async persist(): Promise<void> {
    if (!isChromeStorageAvailable()) return;
    try {
      const snapshots: Record<AssetKey, PriceSnapshot> = {};
      for (const [key, snapshot] of this.snapshots) snapshots[key] = snapshot;
      const payload: PersistedSnapshots = { version: 'v2', snapshots };
      await chrome.storage.local.set({ [SNAPSHOT_STORAGE_KEY]: payload });
    } catch (err) {
      console.error('[PriceService] persist failed', err);
    }
  }
}

export const priceService = new PriceService();
export { SNAPSHOT_STORAGE_KEY as PRICES_STORAGE_KEY, OBSOLETE_STORAGE_KEYS };
