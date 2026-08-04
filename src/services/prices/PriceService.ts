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
/**
 * 同一（资产, 层）重新验证 candidate 的最小间隔。
 *
 * 瞬时失败不能被永久负缓存，但也不能每轮重打——PASSIVE_VISIBLE 每 60 秒就有一次
 * targeted tick，没有这个节流的话一个下线的 venue 会被反复敲。
 */
export const CANDIDATE_RETRY_MS = 5 * 60_000;
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

/** 一次 candidate 验证的结果；attempted 区分「这一层没请求过」和「请求了但没验上」 */
interface CandidateProbe {
  attempted: boolean;
  instruments: VenueInstrument[];
}

/** doResolve 交给紧随其后那次刷新的证据：本轮试过哪些层、在哪一层拿到了报价 */
interface ResolutionHandoff {
  epoch: number;
  attempted: Set<SourceTier>;
  quotedTier: SourceTier | null;
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

function probeKey(assetKey: AssetKey, tier: SourceTier): string {
  return `${assetKey}|${tier}`;
}

function instrumentId(instrument: VenueInstrument): string {
  return `${instrument.venue}|${instrument.instrumentId}`;
}

export class PriceService {
  private snapshots = new Map<AssetKey, PriceSnapshot>();
  private subscriptions = new Set<SubscriptionRecord>();
  private quotes = new QuoteStore();
  private resolved = new Map<AssetKey, VenueInstrument[]>();
  private resolving = new Map<AssetKey, { epoch: number; promise: Promise<VenueInstrument[]> }>();
  private effectiveTier = new Map<AssetKey, SourceTier>();
  private unavailable = new Set<AssetKey>();
  private refreshInFlight = new Map<AssetKey, Promise<void>>();

  private pool = new QuoteSocketPool(SOCKET_ENDPOINTS, (quotes) => this.onSocketQuotes(quotes));
  private lifecycle = new TransportLifecycle({
    // OFF 的判据是「没有 active Watchlist 或没有 selected AssetKey」。不能用
    // desiredInstruments，否则一个暂时没验证出 instrument 的资产会被当成没有工作，
    // 连低频恢复探测都排不上，永远停在 unavailable
    hasWork: () => this.currentUnion.size > 0,
    onModeChange: (mode, previous, ctx) => this.onModeChange(mode, previous, ctx),
    onPassiveTick: () => {
      void this.refreshAssets().catch(() => {});
    },
    onResume: () => {
      if (this.currentUnion.size === 0) return;
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
  /** 每个资产一个 owner token；资产不再被任何 active subscriber 需要时递增 */
  private assetEpoch = new Map<AssetKey, number>();
  /**
   * 实时的 active subscription union。订阅一变就同步更新，比 currentUnion 早一步：
   * 冷启动解析期间资产还没进 currentUnion，所有权只能以这里为准。
   */
  private wanted = new Set<AssetKey>();
  /** recovery 调度 epoch；离开 realtime / stop / freeze 时递增，防止 probe 完成后复活 timer */
  private recoveryEpoch = 0;
  /** doResolve 交给紧随其后那次刷新的一次性证据 */
  private resolutionHandoff = new Map<AssetKey, ResolutionHandoff>();
  /** `${assetKey}|${tier}` → 上次 candidate 验证时间，用于 5 分钟节流 */
  private candidateProbedAt = new Map<string, number>();
  private reconciling = false;
  private enteredRealtimeDuringReconcile = false;
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
    this.settleOwnership();
    void this.ensureRestored();
    this.watchCatalog();
    this.scheduleReconcile();
    this.pushTo(record);

    return {
      updateAssets: (next) => {
        record.assetKeys = normalizeKeys(next);
        this.settleOwnership();
        this.scheduleReconcile();
        this.pushTo(record);
      },
      setActive: (active) => {
        if (record.active === active) return;
        record.active = active;
        this.settleOwnership();
        this.scheduleReconcile();
      },
      unsubscribe: () => {
        this.subscriptions.delete(record);
        this.settleOwnership();
        this.scheduleReconcile();
      },
    };
  }

  /**
   * 订阅集合一变就结算所有权，不能等 reconcile 的 microtask。
   *
   * 冷启动首次解析时资产还没写进 currentUnion，这期间被移除的话 reconcile 的
   * removed 里根本看不到它，在飞的 resolver 会继续降层请求并写回状态。
   * union 是所有 active subscriber 的并集，所以移除其中一个 subscriber
   * 不会误伤仍被别人订阅的资产。
   */
  private settleOwnership(): void {
    const union = this.activeUnion();
    for (const key of this.wanted) {
      if (union.has(key)) continue;
      this.invalidateAsset(key);
      this.refreshInFlight.delete(key);
      this.resolutionHandoff.delete(key);
      // 重新选回来是用户动作，应当立刻重试，不该继承上一次的节流窗口
      for (const tier of [1, 2, 3] as const) this.candidateProbedAt.delete(probeKey(key, tier));
    }
    this.wanted = union;
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
      // 旧 run 不能删掉后来者写进去的记录，否则同一资产会出现并发重复请求
      const run: Promise<void> = this.doRefresh(todo).finally(() => {
        for (const key of todo) {
          if (this.refreshInFlight.get(key) === run) this.refreshInFlight.delete(key);
        }
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
        // 上一轮 resolution 的证据与节流窗口都是针对旧 mapping 的，必须一并作废
        this.resolutionHandoff.delete(key);
        for (const tier of [1, 2, 3] as const) this.candidateProbedAt.delete(probeKey(key, tier));
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
    this.assetEpoch.clear();
    this.wanted.clear();
    this.resolutionHandoff.clear();
    this.candidateProbedAt.clear();
    this.recoveryEpoch += 1;
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
      await Promise.all(Array.from(this.resolving.values(), (entry) => entry.promise));
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
      // settleOwnership 已经吊销了 owner token，这里只清残留状态
      this.quotes.dropAsset(key);
      this.refreshInFlight.delete(key);
      // 报价证据已丢弃，由它推导出的层级决定也不能留，否则重新选回来会永远停在下沉层
      this.effectiveTier.delete(key);
      this.resolved.delete(key);
      this.unavailable.delete(key);
      this.resolutionHandoff.delete(key);
    }

    if (union.size === 0) {
      this.desiredInstruments = [];
      this.desiredFingerprint = '';
      this.applyTransport();
      return;
    }

    for (const key of union) this.recompute(key);

    this.reconciling = true;
    this.enteredRealtimeDuringReconcile = false;
    try {
      this.syncDesiredInstruments();
    } finally {
      this.reconciling = false;
    }
    this.notifyNow();

    // 首刷只有这一个 owner：进入 realtime 时刷整个 union，否则只刷新加入的资产。
    // 刚由 candidate 验证取到报价的资产会在 refreshTiers 里被跳过，不会重复打请求
    const targets = this.enteredRealtimeDuringReconcile ? union : new Set(added);
    if (targets.size > 0) void this.refreshAssets(targets).catch(() => {});
  }

  private epochOf(assetKey: AssetKey): number {
    return this.assetEpoch.get(assetKey) ?? 0;
  }

  private invalidateAsset(assetKey: AssetKey): void {
    this.assetEpoch.set(assetKey, this.epochOf(assetKey) + 1);
  }

  /** 这次异步操作是否仍然拥有该资产：token 未变，且仍被某个 active subscriber 需要 */
  private ownsAsset(assetKey: AssetKey, epoch: number): boolean {
    return this.epochOf(assetKey) === epoch && this.wanted.has(assetKey);
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
      if (previous === 'realtime') return;
      // resume 已经统一刷过一次
      if (ctx.fromResume) return;
      // reconcile 触发的模式变化由 reconcile 自己负责首刷，这里只记账
      if (this.reconciling) {
        this.enteredRealtimeDuringReconcile = true;
        return;
      }
      void this.refreshAssets().catch(() => {});
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

  __recoveryTimerActiveForTest(): boolean {
    return this.recoveryTimer !== null;
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

    const epoch = this.epochOf(assetKey);
    const pending = this.resolving.get(assetKey);
    // 资产移除又重新加入后 owner token 已经变了，旧 resolver 的结果不能再交给新 owner
    if (pending && pending.epoch === epoch) return pending.promise;

    const entry: { epoch: number; promise: Promise<VenueInstrument[]> } = {
      epoch,
      promise: null as unknown as Promise<VenueInstrument[]>,
    };
    entry.promise = this.doResolve(assetKey, epoch).finally(() => {
      // 旧 resolver 不能删掉新 owner 建立的记录
      if (this.resolving.get(assetKey) === entry) this.resolving.delete(assetKey);
    });
    this.resolving.set(assetKey, entry);
    return entry.promise;
  }

  /**
   * 冷启动解析。每次 await 之后都要重新确认所有权：资产失效后既不请求下一层，
   * 也不写 QuoteStore / resolved / effectiveTier / unavailable / catalog 缓存。
   */
  private async doResolve(assetKey: AssetKey, epoch: number): Promise<VenueInstrument[]> {
    // 只读本地 catalog 缓存；解析永远不会触发远程 catalog 刷新
    await exchangeCatalog.loadCachedOnly();
    if (!this.ownsAsset(assetKey, epoch)) return [];

    const fromCatalog = catalogInstrumentsFor(assetKey);
    if (fromCatalog.length > 0) {
      this.resolved.set(assetKey, fromCatalog);
      this.unavailable.delete(assetKey);
      return fromCatalog;
    }

    // 冷启动只验证到第一个可用层为止；更低层留给 fallback 当轮按需验证，
    // 免得一上来就为用不到的层多打一轮请求
    const attempted = new Set<SourceTier>();
    let quotedTier: SourceTier | null = null;
    const verified: VenueInstrument[] = [];
    for (const tier of [1, 2] as const) {
      if (!this.ownsAsset(assetKey, epoch)) return [];
      const probe = await this.verifyCandidates(assetKey, tier, epoch);
      if (!this.ownsAsset(assetKey, epoch)) return [];
      if (probe.attempted) attempted.add(tier);
      if (probe.instruments.length === 0) continue;
      verified.push(...probe.instruments);
      quotedTier = tier;
      this.setEffectiveTier(assetKey, tier);
      break;
    }

    this.resolved.set(assetKey, verified);
    // 本轮试过的层（成功或失败）都不该被紧随其后的首刷重打一遍
    this.resolutionHandoff.set(assetKey, { epoch, attempted, quotedTier });
    if (verified.length === 0) {
      this.unavailable.add(assetKey);
    } else {
      this.unavailable.delete(assetKey);
      void exchangeCatalog.mergeResolvedInstruments(verified);
    }
    return verified;
  }

  /** 一次性取用 resolution 证据；owner 对不上说明是别人留下的，不能用 */
  private takeResolutionHandoff(assetKey: AssetKey, epoch: number): ResolutionHandoff | null {
    const handoff = this.resolutionHandoff.get(assetKey);
    if (!handoff) return null;
    this.resolutionHandoff.delete(assetKey);
    return handoff.epoch === epoch ? handoff : null;
  }

  /** 这一层能生成、但还没被验证进 resolved 的 candidate */
  private unresolvedCandidates(assetKey: AssetKey, tier: SourceTier): VenueInstrument[] {
    const resolvedIds = new Set((this.resolved.get(assetKey) ?? []).map(instrumentId));
    return candidateInstruments(assetKey, tier).filter((c) => !resolvedIds.has(instrumentId(c)));
  }

  /**
   * 值得反复低频重试的 candidate。
   *
   * 只保留 catalog 尚未真正刷新过的 venue：已经拉过完整 instrument 列表的 venue 就是
   * 「它到底挂没挂这个标的」的权威，没被它列出来的再怎么定向探测也不会有行情。
   * mergeResolvedInstruments 写回的自验证 mapping 不推进 venue 时间戳，
   * 所以冷启动自己发现的那几条不会被误当成权威。
   */
  private pendingCandidates(assetKey: AssetKey, tier: SourceTier): VenueInstrument[] {
    const unverifiedVenues = new Set(exchangeCatalog.staleVenues());
    if (unverifiedVenues.size === 0) return [];
    return this.unresolvedCandidates(assetKey, tier).filter((c) => unverifiedVenues.has(c.venue));
  }

  /** 首次尝试不限频；之后同一（资产, 层）的 candidate 验证最多 5 分钟一次 */
  private mayProbeCandidates(assetKey: AssetKey, tier: SourceTier): boolean {
    const at = this.candidateProbedAt.get(probeKey(assetKey, tier));
    return at == null || Date.now() - at >= CANDIDATE_RETRY_MS;
  }

  private markCandidateProbe(assetKey: AssetKey, tier: SourceTier): void {
    this.candidateProbedAt.set(probeKey(assetKey, tier), Date.now());
  }

  /**
   * 定向验证这一层还没验上的 candidate，只返回真的拿到可用报价的那些。
   * 未验证的 candidate 绝不会进入 resolved，也就不会被 WebSocket 订阅。
   */
  private async verifyCandidates(
    assetKey: AssetKey,
    tier: SourceTier,
    epoch: number,
    options: { throttle?: boolean } = {},
  ): Promise<CandidateProbe> {
    const candidates = this.unresolvedCandidates(assetKey, tier);
    // 结构性没有 candidate（crypto:USDT、FX）：稳定不可用，永远不产生请求
    if (candidates.length === 0) return { attempted: false, instruments: [] };
    if (options.throttle && !this.mayProbeCandidates(assetKey, tier)) {
      return { attempted: false, instruments: [] };
    }
    this.markCandidateProbe(assetKey, tier);

    const quotes = await fetchTargetedQuotes(candidates);
    if (!this.ownsAsset(assetKey, epoch)) return { attempted: true, instruments: [] };

    const now = Date.now();
    const usable = quotes.filter((quote) => isUsableQuote(quote, now, TRADABLE_MAX_AGE_MS));
    if (usable.length === 0) return { attempted: true, instruments: [] };

    const liveIds = new Set(usable.map((quote) => `${quote.venue}|${quote.instrumentId}`));
    for (const quote of usable) this.quotes.ingest(quote);
    return {
      attempted: true,
      instruments: candidates.filter((c) => liveIds.has(instrumentId(c))),
    };
  }

  private appendResolved(assetKey: AssetKey, instruments: VenueInstrument[]): void {
    if (instruments.length === 0) return;
    const existing = this.resolved.get(assetKey) ?? [];
    const seen = new Set(existing.map(instrumentId));
    const merged = existing.slice();
    for (const instrument of instruments) {
      if (seen.has(instrumentId(instrument))) continue;
      seen.add(instrumentId(instrument));
      merged.push(instrument);
    }
    this.resolved.set(assetKey, merged);
    this.unavailable.delete(assetKey);
    void exchangeCatalog.mergeResolvedInstruments(instruments);
  }

  // ============ 报价获取 ============

  private async doRefresh(assetKeys: AssetKey[]): Promise<void> {
    const owners = assetKeys.map((key) => ({ key, epoch: this.epochOf(key) }));
    await Promise.all(owners.map(({ key }) => this.ensureResolved(key)));
    await Promise.all(owners.map(({ key, epoch }) => this.refreshTiers(key, epoch)));

    const live = owners.filter((o) => this.ownsAsset(o.key, o.epoch)).map((o) => o.key);
    for (const key of live) this.recompute(key);
    if (live.length === 0) return;
    this.syncDesiredInstruments();
    this.notifyNow();
    void this.persist();
  }

  /**
   * 从 Tier 1 开始逐层定向请求，第一个拿到本轮可用报价的层就是这个资产当前的 effective tier。
   * 当前层在 resolved 里不存在时按需验证 candidate，验证通过才追加进 resolved。
   * 每次 await 之后都要重新确认所有权，失效后既不发下一层请求也不写任何状态。
   */
  private async refreshTiers(assetKey: AssetKey, epoch: number): Promise<void> {
    const handoff = this.takeResolutionHandoff(assetKey, epoch);

    for (const tier of [1, 2, 3] as const) {
      if (!this.ownsAsset(assetKey, epoch)) return;

      // 刚刚的 resolution 已经试过这一层：成功就直接收工，失败也不在同一轮重打
      if (handoff?.attempted.has(tier)) {
        if (handoff.quotedTier === tier && this.hasUsableQuote(assetKey, tier)) return;
        continue;
      }

      const instruments = this.instrumentsInTier(assetKey, tier);
      if (instruments.length > 0) {
        const quotes = await fetchTargetedQuotes(instruments);
        if (!this.ownsAsset(assetKey, epoch)) return;
        const now = Date.now();
        const usable = quotes.filter((quote) => isUsableQuote(quote, now, TRADABLE_MAX_AGE_MS));
        for (const quote of usable) this.quotes.ingest(quote);
        if (usable.length > 0) {
          this.setEffectiveTier(assetKey, tier);
          return;
        }
        // 同层缺失的 venue 留给低频恢复探测补，这里不追加请求
        continue;
      }

      // resolved 里没有这一层：按需验证候选。首次不限频，之后每 5 分钟一次，
      // 所以瞬时失败既不会永久负缓存，也不会被 60 秒的 passive tick 反复重打。
      // Hyperliquid 不产出 candidate，HIP-3 只能来自经过 deployer 校验的 catalog
      const probe = await this.verifyCandidates(assetKey, tier, epoch, { throttle: true });
      if (!this.ownsAsset(assetKey, epoch)) return;
      if (probe.instruments.length === 0) continue;
      this.appendResolved(assetKey, probe.instruments);
      this.setEffectiveTier(assetKey, tier);
      return;
    }
  }

  /** 换层时必须清掉别的层的残留报价，否则上一层的旧价会一直压住新层 */
  private setEffectiveTier(assetKey: AssetKey, tier: SourceTier): void {
    this.effectiveTier.set(assetKey, tier);
    this.unavailable.delete(assetKey);
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
    if (fingerprint !== this.desiredFingerprint) {
      this.desiredFingerprint = fingerprint;
      this.desiredInstruments = next;
    }
    // desired set 为空也要落地：一个还没验证出 instrument 的资产仍然需要
    // lifecycle 进入 REALTIME，才能排上 5 分钟的低频恢复探测
    this.applyTransport();
  }

  /**
   * REALTIME 下唯一的周期性 REST，5 分钟一轮，承担三件事：
   *  - effective tier 掉档后探测能否升回 Tier 1
   *  - 补验同层缺失的 venue（瞬时失败没验上的那些）
   *  - 完全没有可用报价的资产重试全部已知 instrument 与 candidate
   *
   * 结构性没有 candidate 的资产（crypto:USDT、FX）在这里返回空，因此不会成为 target，
   * 也就不会有 timer。
   */
  private recoveryProbeInstruments(assetKey: AssetKey): VenueInstrument[] {
    const out: VenueInstrument[] = [];
    const seen = new Set<string>();
    const push = (list: VenueInstrument[]) => {
      for (const instrument of list) {
        if (seen.has(instrumentId(instrument))) continue;
        seen.add(instrumentId(instrument));
        out.push(instrument);
      }
    };

    const effective = this.effectiveTier.get(assetKey);
    if (effective == null) {
      push(this.resolved.get(assetKey) ?? []);
      push(this.pendingCandidates(assetKey, 1));
      push(this.pendingCandidates(assetKey, 2));
      return out;
    }
    if (effective > 1) {
      // resolved 里没有 Tier 1 也要能恢复：冷启动直接降到 Tier 2 的资产就是这种情况
      const tierOne = this.instrumentsInTier(assetKey, 1);
      push(tierOne.length > 0 ? tierOne : this.pendingCandidates(assetKey, 1));
    }
    push(this.pendingCandidates(assetKey, effective));
    return out;
  }

  private recoveryTargets(): AssetKey[] {
    const out: AssetKey[] = [];
    for (const key of this.currentUnion) {
      if (this.recoveryProbeInstruments(key).length > 0) out.push(key);
    }
    return out;
  }

  protected startRecoveryTimer(): void {
    if (this.recoveryTimer) return;
    if (this.recoveryTargets().length === 0) return;
    const epoch = this.recoveryEpoch;
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      if (epoch !== this.recoveryEpoch) return;
      const targets = this.recoveryTargets();
      if (targets.length === 0) return;
      void this.probeRecovery(targets, epoch).finally(() => {
        // probe 执行期间可能已经进入 passive / freeze / off，这时绝不能再挂回 timer
        if (epoch !== this.recoveryEpoch) return;
        if (this.lifecycle.getMode() !== 'realtime') return;
        this.startRecoveryTimer();
      });
    }, TIER_RECOVERY_PROBE_MS);
  }

  private async probeRecovery(assetKeys: AssetKey[], epoch: number): Promise<void> {
    const owners = assetKeys
      .map((key) => ({
        key,
        assetEpoch: this.epochOf(key),
        probing: this.recoveryProbeInstruments(key),
      }))
      .filter((owner) => owner.probing.length > 0);
    const instruments = owners.flatMap((owner) => owner.probing);
    if (instruments.length === 0) return;

    // 这一轮就是 candidate 的 5 分钟重试窗口；记账后紧跟着的 passive tick 不会重复打
    for (const owner of owners) {
      for (const tier of new Set(owner.probing.map(instrumentTier))) {
        this.markCandidateProbe(owner.key, tier);
      }
    }

    const quotes = await fetchTargetedQuotes(instruments).catch(() => [] as VenueQuote[]);
    if (epoch !== this.recoveryEpoch) return;

    const now = Date.now();
    let changed = false;
    for (const owner of owners) {
      if (!this.ownsAsset(owner.key, owner.assetEpoch)) continue;
      const usable = quotes.filter(
        (quote) => quote.assetKey === owner.key && isUsableQuote(quote, now, TRADABLE_MAX_AGE_MS),
      );
      if (usable.length === 0) continue;

      // 只接受本轮最优（最低）层的结果，绝不把两层混进同一个资产
      const best = Math.min(...usable.map((quote) => productTier(quote.productKind))) as SourceTier;
      const current = this.effectiveTier.get(owner.key);
      if (current != null && current < best) continue;

      const liveIds = new Set(usable.map((quote) => `${quote.venue}|${quote.instrumentId}`));
      this.appendResolved(
        owner.key,
        owner.probing.filter((i) => liveIds.has(instrumentId(i))),
      );
      for (const quote of usable) {
        if (productTier(quote.productKind) !== best) continue;
        this.quotes.ingest(quote);
      }
      this.setEffectiveTier(owner.key, best);
      this.recompute(owner.key);
      changed = true;
    }
    if (!changed) return;
    this.syncDesiredInstruments();
    this.notifyNow();
  }

  protected clearRecoveryTimer(): void {
    // 递增 epoch 让正在执行的 probe 失效，否则它完成时会把 timer 重新挂回来
    this.recoveryEpoch += 1;
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
