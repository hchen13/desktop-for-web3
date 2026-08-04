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
  productTier,
  type SourceTier,
} from './instrumentResolver';
import { QuoteStore } from './quoteStore';
import { QuoteSocketPool } from './socket';
import { TransportLifecycle, type ModeChangeContext, type TransportMode } from './lifecycle';
import { fetchTargetedQuotes, SOCKET_ENDPOINTS } from './venues';
import { isUsableQuote, TRADABLE_MAX_AGE_MS } from './venues/shared';

const SNAPSHOT_STORAGE_KEY = 'prices_cache_v2';
/** 上一代缓存 key，升级时直接清掉，绝不能当作 fresh exchange quote 复用 */
const OBSOLETE_STORAGE_KEYS = ['prices_cache_v1', 'pyth_catalog_v1'];

/** WebSocket 覆盖不到的 instrument（Binance TradFi 永续）的兜底刷新间隔 */
export const WS_UNCOVERED_REFRESH_MS = 60_000;
/** WebSocket 高频推送合并成 UI 通知的最小间隔 */
export const NOTIFY_COALESCE_MS = 250;
/** effective tier 掉档后重新定向探测 Tier 1 的间隔 */
export const TIER_RECOVERY_PROBE_MS = 5 * 60_000;
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
  private effectiveTier = new Map<AssetKey, SourceTier>();
  private unavailable = new Set<AssetKey>();
  private refreshInFlight = new Map<AssetKey, Promise<void>>();

  private pool = new QuoteSocketPool(SOCKET_ENDPOINTS, (quotes) => this.onSocketQuotes(quotes));
  private lifecycle = new TransportLifecycle({
    hasWork: () => this.desiredInstruments.length > 0,
    onModeChange: (mode, previous, ctx) => this.onModeChange(mode, previous, ctx),
    onPassiveTick: () => {
      void this.refreshAssets().catch(() => {});
    },
    onResume: () => {
      if (this.desiredInstruments.length === 0) return;
      void this.refreshAssets().catch(() => {});
    },
  });
  protected desiredInstruments: VenueInstrument[] = [];
  private currentUnion = new Set<AssetKey>();

  private reconcileScheduled = false;
  private reconcileGeneration = 0;
  private reconcilePromise: Promise<void> | null = null;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private uncoveredTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private desiredFingerprint = '';
  private restorePromise: Promise<void> | null = null;
  private catalogUnsubscribe: (() => void) | null = null;

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
    this.watchCatalog();
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

  /**
   * catalog 刷新后已选资产必须重新解析：冷启动时保存的 candidate mapping 可能只有
   * Tier 2，而完整 catalog 里已经有 Tier 1 instrument 了。
   */
  private watchCatalog(): void {
    if (this.catalogUnsubscribe) return;
    this.catalogUnsubscribe = exchangeCatalog.onUpdate(() => {
      for (const key of this.currentUnion) {
        this.resolved.delete(key);
        this.effectiveTier.delete(key);
        this.unavailable.delete(key);
      }
      this.scheduleReconcile();
    });
  }

  /** 关闭所有行情连接与 timer */
  stopTransport(): void {
    this.pool.closeAll();
    this.clearUncoveredTimer();
    this.clearRecoveryTimer();
  }

  __resetForTest(): void {
    this.lifecycle.stop();
    this.stopTransport();
    this.catalogUnsubscribe?.();
    this.catalogUnsubscribe = null;
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }
    this.snapshots.clear();
    this.subscriptions.clear();
    this.quotes.clear();
    this.resolved.clear();
    this.resolving.clear();
    this.effectiveTier.clear();
    this.unavailable.clear();
    this.refreshInFlight.clear();
    this.desiredInstruments = [];
    this.desiredFingerprint = '';
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
      const run: Promise<void> = this.reconcile().finally(() => {
        if (this.reconcilePromise === run) this.reconcilePromise = null;
      });
      this.reconcilePromise = run;
    });
  }

  private async reconcile(): Promise<void> {
    const generation = ++this.reconcileGeneration;
    await this.ensureRestored();
    const union = this.activeUnion();
    await Promise.all([...union].map((key) => this.ensureResolved(key)));

    // reconcile 可重入。解析期间可能已经有新一轮跑完，陈旧的这一轮必须整体作废：
    // 连 currentUnion 都不能写，否则新一轮算出的 added 会漏掉尚未首刷的资产
    if (generation !== this.reconcileGeneration) return;

    const added = [...union].filter((key) => !this.currentUnion.has(key));
    const removed = [...this.currentUnion].filter((key) => !union.has(key));
    this.currentUnion = union;

    for (const key of removed) {
      this.quotes.dropAsset(key);
      this.refreshInFlight.delete(key);
      // 报价证据已丢弃，由它推导出的层级决定也不能留，否则重新选回来会永远停在下沉层
      this.effectiveTier.delete(key);
      this.resolved.delete(key);
      this.unavailable.delete(key);
    }

    if (union.size === 0) {
      this.desiredInstruments = [];
      this.desiredFingerprint = '';
      this.applyTransport();
      return;
    }

    for (const key of union) this.recompute(key);
    this.syncDesiredInstruments();
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
      this.startRecoveryTimer();
    }
  }

  private onModeChange(mode: TransportMode, previous: TransportMode, ctx: ModeChangeContext): void {
    if (mode === 'realtime') {
      this.pool.setDesiredInstruments(this.desiredInstruments);
      this.startUncoveredTimer();
      this.startRecoveryTimer();
      // 从 passive / off 回到 REALTIME 时立即补一次；宽限期内根本不会走到这里，
      // 所以不会因为快速 focus/blur 抖动产生额外请求或重连。
      // resume 已经统一刷过一次，这里不能再刷第二轮
      if (previous !== 'realtime' && !ctx.fromResume) void this.refreshAssets().catch(() => {});
      return;
    }
    this.pool.closeAll();
    this.clearUncoveredTimer();
    this.clearRecoveryTimer();
  }

  protected freshnessWindowMs(): number {
    return FRESHNESS_WINDOW_MS[this.lifecycle.getMode()];
  }

  __transportModeForTest(): TransportMode {
    return this.lifecycle.getMode();
  }

  // ============ instrument 解析 ============

  /** 当前实际在用的那一层；effective tier 每轮由真实拿到的 fresh quote 决定 */
  private preferredInstruments(assetKey: AssetKey): VenueInstrument[] {
    const all = this.resolved.get(assetKey) ?? [];
    const effective = this.effectiveTier.get(assetKey);
    if (effective) {
      const inTier = all.filter((instrument) => instrumentTier(instrument) === effective);
      if (inTier.length > 0) return inTier;
    }
    for (const tier of [1, 2, 3] as const) {
      const inTier = all.filter((instrument) => instrumentTier(instrument) === tier);
      if (inTier.length > 0) return inTier;
    }
    return [];
  }

  private instrumentsInTier(assetKey: AssetKey, tier: SourceTier): VenueInstrument[] {
    return (this.resolved.get(assetKey) ?? []).filter((i) => instrumentTier(i) === tier);
  }

  private ensureResolved(assetKey: AssetKey): Promise<VenueInstrument[]> {
    // 否定结果同样要缓存，否则不可用资产每轮都会重跑一整套必然失败的 candidate 探测。
    // catalog 刷新时会由 onUpdate 主动失效，所以缓存空结果是安全的
    const existing = this.resolved.get(assetKey);
    if (existing) return Promise.resolve(existing);
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
      // 已退市的 symbol 照样会返回 200 + 旧的 lastPrice，所以「有正数价格」不足以确认 instrument 有效
      const now = Date.now();
      const usable = quotes.filter((quote) => isUsableQuote(quote, now, TRADABLE_MAX_AGE_MS));
      if (usable.length === 0) continue;
      const liveIds = new Set(usable.map((quote) => `${quote.venue}|${quote.instrumentId}`));
      verified.push(...candidates.filter((c) => liveIds.has(`${c.venue}|${c.instrumentId}`)));
      for (const quote of usable) this.quotes.ingest(quote);
      this.setEffectiveTier(assetKey, tier);
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
    // candidate 验证本身就会取一次报价，本次刷新不能对同一层再打一遍
    const justVerified = new Set<AssetKey>();
    await Promise.all(
      assetKeys.map(async (key) => {
        const alreadyResolved = this.resolved.has(key);
        await this.ensureResolved(key);
        if (!alreadyResolved && this.effectiveTier.has(key)) justVerified.add(key);
      }),
    );
    await Promise.all(assetKeys.map((key) => this.refreshTiers(key, justVerified.has(key))));

    for (const key of assetKeys) this.recompute(key);
    this.syncDesiredInstruments();
    this.notifyNow();
    void this.persist();
  }

  /**
   * 从 Tier 1 开始逐层定向请求，第一个拿到本轮可用报价的层就是这个资产当前的 effective tier。
   * 因为每轮都从 Tier 1 重新试，Tier 1 恢复后不需要用户重新添加标的就会自动升回去。
   */
  private async refreshTiers(assetKey: AssetKey, justVerified: boolean): Promise<void> {
    if ((this.resolved.get(assetKey) ?? []).length === 0) return;

    for (const tier of [1, 2, 3] as const) {
      const instruments = this.instrumentsInTier(assetKey, tier);
      if (instruments.length === 0) continue;

      if (
        justVerified &&
        this.effectiveTier.get(assetKey) === tier &&
        this.hasUsableQuote(assetKey, tier)
      ) {
        return;
      }

      const quotes = await fetchTargetedQuotes(instruments);
      const now = Date.now();
      const usable = quotes.filter((quote) => isUsableQuote(quote, now, TRADABLE_MAX_AGE_MS));
      for (const quote of usable) this.quotes.ingest(quote);
      if (usable.length > 0) {
        this.setEffectiveTier(assetKey, tier);
        return;
      }
    }
  }

  /** 换层时必须清掉别的层的残留报价，否则上一层的旧价会一直压住新层 */
  private setEffectiveTier(assetKey: AssetKey, tier: SourceTier): void {
    this.effectiveTier.set(assetKey, tier);
    this.quotes.dropWhere(assetKey, (quote) => productTier(quote.productKind) !== tier);
  }

  private hasUsableQuote(assetKey: AssetKey, tier: SourceTier): boolean {
    const now = Date.now();
    return this.quotes
      .quotesFor(assetKey)
      .some(
        (quote) =>
          productTier(quote.productKind) === tier && isUsableQuote(quote, now, TRADABLE_MAX_AGE_MS),
      );
  }

  private syncDesiredInstruments(): void {
    const next = [...this.currentUnion].flatMap((key) => this.preferredInstruments(key));
    const fingerprint = next
      .map((i) => `${i.venue}|${i.instrumentId}`)
      .sort()
      .join(',');
    if (fingerprint === this.desiredFingerprint) return;
    this.desiredFingerprint = fingerprint;
    this.desiredInstruments = next;
    this.applyTransport();
  }

  /**
   * effective tier 掉到 Tier 1 以下时的低频恢复探测。REALTIME 下没有周期性 REST，
   * 没有这个 timer 的话 Tier 1 恢复要等到用户下次操作才会被发现。
   */
  private recoveryTargets(): AssetKey[] {
    const out: AssetKey[] = [];
    for (const key of this.currentUnion) {
      const tier = this.effectiveTier.get(key);
      if (tier && tier > 1 && this.instrumentsInTier(key, 1).length > 0) out.push(key);
    }
    return out;
  }

  protected startRecoveryTimer(): void {
    if (this.recoveryTimer) return;
    if (this.recoveryTargets().length === 0) return;
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      const targets = this.recoveryTargets();
      if (targets.length === 0) return;
      void this.probeTierOne(targets).finally(() => this.startRecoveryTimer());
    }, TIER_RECOVERY_PROBE_MS);
  }

  private async probeTierOne(assetKeys: AssetKey[]): Promise<void> {
    const instruments = assetKeys.flatMap((key) => this.instrumentsInTier(key, 1));
    if (instruments.length === 0) return;
    const quotes = await fetchTargetedQuotes(instruments).catch(() => [] as VenueQuote[]);
    const now = Date.now();
    const recovered = new Set<AssetKey>();
    for (const quote of quotes) {
      if (!isUsableQuote(quote, now, TRADABLE_MAX_AGE_MS)) continue;
      if (this.quotes.ingest(quote)) recovered.add(quote.assetKey);
    }
    if (recovered.size === 0) return;
    for (const key of recovered) {
      this.setEffectiveTier(key, 1);
      this.recompute(key);
    }
    this.syncDesiredInstruments();
    this.notifyNow();
  }

  protected clearRecoveryTimer(): void {
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
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
      if (!covered.has(`${instrument.venue}|${instrument.instrumentId}`))
        out.add(instrument.assetKey);
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
