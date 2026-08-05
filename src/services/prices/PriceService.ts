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
import { QuoteSocketPool, WS_LIVENESS_TIMEOUT_MS } from './socket';
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
 * 同一个 candidate 两次定向验证之间的最小间隔。
 *
 * 瞬时失败不能被永久负缓存，但也不能每轮重打——PASSIVE_VISIBLE 每 60 秒就有一次
 * targeted tick，没有这个节流的话一个下线的 venue 会被反复敲。
 * 节流按「资产 + venue + instrumentId + productKind」计，不是按资产或按层，
 * 后加入的资产因此不会被别人的 timer 带着提前重试。
 */
export const CANDIDATE_RETRY_MS = 5 * 60_000;
/** 各模式下报价的新鲜度窗口；REALTIME 与 WS 静默判定共用同一个窗口 */
export const FRESHNESS_WINDOW_MS: Record<TransportMode, number> = {
  off: 5 * 60_000,
  realtime: WS_LIVENESS_TIMEOUT_MS,
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
  owner: OperationOwner;
  attempted: Set<SourceTier>;
  quotedTier: SourceTier | null;
}

/**
 * 一次异步操作的复合所有权。
 *
 * 三个维度缺一不可：assetEpoch 管「这个资产还有没有人要」，regimeEpoch 管
 * 「transport regime 有没有换过」（pagehide / freeze / REALTIME↔PASSIVE / stop），
 * wanted 管「它此刻是不是还在 active subscription union 里」。
 */
interface OperationOwner {
  assetKey: AssetKey;
  assetEpoch: number;
  regimeEpoch: number;
}

/** 单个 candidate 的重试节流状态 */
interface CandidateAttempt {
  lastAttemptAt: number;
  nextEligibleAt: number;
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

/** 完整 owner 相等：三个维度全都要对得上，少比一个就会让跨 regime 的旧操作蒙混过关 */
function sameOwner(a: OperationOwner, b: OperationOwner): boolean {
  return (
    a.assetKey === b.assetKey && a.assetEpoch === b.assetEpoch && a.regimeEpoch === b.regimeEpoch
  );
}

/** candidate 的稳定身份：资产 + venue + instrumentId + productKind */
function candidateIdentity(assetKey: AssetKey, instrument: VenueInstrument): string {
  return `${assetKey}|${instrument.venue}|${instrument.instrumentId}|${instrument.productKind}`;
}

function instrumentId(instrument: VenueInstrument): string {
  return `${instrument.venue}|${instrument.instrumentId}`;
}

export class PriceService {
  private snapshots = new Map<AssetKey, PriceSnapshot>();
  private subscriptions = new Set<SubscriptionRecord>();
  private quotes = new QuoteStore();
  private resolved = new Map<AssetKey, VenueInstrument[]>();
  private resolving = new Map<
    AssetKey,
    { owner: OperationOwner; promise: Promise<VenueInstrument[]> }
  >();
  private effectiveTier = new Map<AssetKey, SourceTier>();
  private unavailable = new Set<AssetKey>();
  private refreshInFlight = new Map<AssetKey, { owner: OperationOwner; run: Promise<void> }>();

  private pool = new QuoteSocketPool(SOCKET_ENDPOINTS, (quotes) => this.onSocketQuotes(quotes));
  private lifecycle = new TransportLifecycle({
    // OFF 的判据是「没有 active Watchlist 或没有 selected AssetKey」。不能用
    // desiredInstruments，否则一个暂时没验证出 instrument 的资产会被当成没有工作，
    // 连低频恢复探测都排不上，永远停在 unavailable
    // OFF 的判据是「没有 active Watchlist 或没有 selected AssetKey」。用 wanted 而不是
    // currentUnion，才能在第一个 selected symbol 发出任何请求之前就装好监听
    hasWork: () => this.wanted.size > 0,
    onModeChange: (mode, previous, ctx) => this.onModeChange(mode, previous, ctx),
    onPassiveTick: () => {
      this.scheduleReconcile();
      void this.refreshAssets().catch(() => {});
    },
    onResume: () => {
      if (this.wanted.size === 0) return;
      // 跨过 suspend 的那一轮 reconcile 已经作废，当前 wanted union 需要重新对账；
      // 先同步登记这一轮 refresh，reconcile 的 microtask 只会并进来，不会另起一轮
      this.scheduleReconcile();
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
  /**
   * transport regime epoch。pagehide / freeze / REALTIME↔PASSIVE / PASSIVE↔PASSIVE /
   * stop 时递增，让所有跨越了这次转换的在飞操作失效。
   * 仅仅处在 blur grace 或 hidden grace 里（还没真的换 regime）不会递增。
   */
  private regimeEpoch = 0;
  /** doResolve 交给紧随其后那次刷新的一次性证据 */
  private resolutionHandoff = new Map<AssetKey, ResolutionHandoff>();
  /** 每个 candidate 一条重试节流记录 */
  private candidateAttempts = new Map<string, CandidateAttempt>();
  /** 当前 recovery timer 对应的绝对到期时刻 */
  private recoveryArmedFor: number | null = null;
  private freshnessTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshRunCount = 0;
  private resolveRunCount = 0;
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
      for (const identity of [...this.candidateAttempts.keys()]) {
        if (identity.startsWith(`${key}|`)) this.candidateAttempts.delete(identity);
      }
    }
    this.wanted = union;
    // 监听器必须早于第一个 resolver 请求装好，否则冷启动解析期间的 pagehide / freeze
    // 根本无人接收。模式判定留给 reconcile：订阅变化是成批发生的，同步判定会让
    // 「旧 layout 先失活、新 layout 再激活」中间出现一次空 union，把连接关掉又重开
    this.lifecycle.start();
  }

  private ownerFor(assetKey: AssetKey): OperationOwner {
    return {
      assetKey,
      assetEpoch: this.epochOf(assetKey),
      regimeEpoch: this.regimeEpoch,
    };
  }

  /** 复合所有权：regime 没换过、asset token 没变、且仍被某个 active subscriber 需要 */
  private ownsOperation(owner: OperationOwner): boolean {
    return (
      owner.regimeEpoch === this.regimeEpoch &&
      this.epochOf(owner.assetKey) === owner.assetEpoch &&
      this.wanted.has(owner.assetKey)
    );
  }

  /** transport regime 真的换了：所有跨越这次转换的在飞操作立即失效 */
  private invalidateRegime(): void {
    this.regimeEpoch += 1;
    this.enteredRealtimeDuringReconcile = false;
  }

  /** 对指定 AssetKey（默认为当前 active union）立即做一次 targeted 刷新 */
  async refreshAssets(assetKeys?: Set<AssetKey>): Promise<void> {
    // pagehide / freeze 之后不得再启动新的价格请求
    if (this.lifecycle.getMode() === 'off') return;
    const targets = assetKeys ? normalizeKeys(assetKeys) : this.activeUnion();
    if (targets.size === 0) return;

    const waiting: Array<Promise<void>> = [];
    const todo: AssetKey[] = [];
    for (const key of targets) {
      const inFlight = this.refreshInFlight.get(key);
      // 只能并进仍然有效的那一轮；跨过 regime 转换的旧 run 早就不作数了
      if (inFlight && this.ownsOperation(inFlight.owner)) waiting.push(inFlight.run);
      else todo.push(key);
    }

    if (todo.length > 0) {
      this.refreshRunCount += 1;
      const owners = todo.map((key) => this.ownerFor(key));
      const entries = new Map<AssetKey, { owner: OperationOwner; run: Promise<void> }>();
      // 旧 run 不能删掉后来者写进去的记录，否则同一资产会出现并发重复请求
      const run: Promise<void> = this.doRefresh(owners).finally(() => {
        for (const key of todo) {
          if (this.refreshInFlight.get(key) === entries.get(key)) this.refreshInFlight.delete(key);
        }
      });
      for (const owner of owners) {
        const entry = { owner, run };
        entries.set(owner.assetKey, entry);
        this.refreshInFlight.set(owner.assetKey, entry);
      }
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
        for (const identity of [...this.candidateAttempts.keys()]) {
          if (identity.startsWith(`${key}|`)) this.candidateAttempts.delete(identity);
        }
      }
      this.scheduleReconcile();
    });
  }

  /** 关闭所有行情连接与 timer */
  stopTransport(): void {
    this.invalidateRegime();
    this.pool.closeAll();
    this.clearUncoveredTimer();
    this.clearRecoveryTimer();
    this.clearFreshnessTimer();
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
    this.candidateAttempts.clear();
    this.recoveryArmedFor = null;
    this.clearFreshnessTimer();
    this.regimeEpoch += 1;
    this.refreshRunCount = 0;
    this.resolveRunCount = 0;
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
      await Promise.all(Array.from(this.refreshInFlight.values(), (entry) => entry.run));
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

    // 先判定模式，再发第一个 resolver 请求：listener 与 visibility/focus/suspended
    // 必须早于网络。这一步在 reconcile 里做，订阅抖动已经被 microtask 合并过了
    // 注意不要在这里清 enteredRealtimeDuringReconcile：onModeChange 可能在 reconcile
    // 的 microtask 排队之后、执行之前就把首刷的责任记到了这里
    this.reconciling = true;
    try {
      this.lifecycle.start();
      this.lifecycle.reconcileDesiredMode();
    } finally {
      this.reconciling = false;
    }
    const regime = this.regimeEpoch;

    await Promise.all([...union].map((key) => this.ensureResolved(key)));

    // reconcile 可重入，而且解析期间还可能跨过一次 suspend/resume。陈旧的这一轮必须
    // 整体作废：连 currentUnion 都不能写，否则新一轮算出的 added 会漏掉尚未首刷的资产，
    // 更不能在新一轮已经刷过之后再补一轮 REST
    if (generation !== this.reconcileGeneration || regime !== this.regimeEpoch) return;

    // 首刷责任是一次性的，取用后立刻清掉
    const ownsFirstRefresh = this.enteredRealtimeDuringReconcile;
    this.enteredRealtimeDuringReconcile = false;

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
    try {
      this.syncDesiredInstruments();
    } finally {
      this.reconciling = false;
    }
    this.notifyNow();

    // 首刷只有这一个 owner：进入 realtime 时刷整个 union，否则只刷新加入的资产。
    // 刚由 candidate 验证取到报价的资产会在 refreshTiers 里被跳过，不会重复打请求
    const targets = ownsFirstRefresh ? union : new Set(added);
    if (targets.size > 0) void this.refreshAssets(targets).catch(() => {});
  }

  private epochOf(assetKey: AssetKey): number {
    return this.assetEpoch.get(assetKey) ?? 0;
  }

  private invalidateAsset(assetKey: AssetKey): void {
    this.assetEpoch.set(assetKey, this.epochOf(assetKey) + 1);
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

  private onModeChange(mode: TransportMode, previous: TransportMode, ctx: ModeChangeContext): void {
    // off → 非 off 只是「开始干活」，没有旧 operation 需要作废；其余转换都是真的换 regime
    if (!(previous === 'off' && mode !== 'off')) {
      this.invalidateRegime();
    }

    if (mode === 'realtime') {
      const returningFromPassive = previous === 'passive-visible' || previous === 'passive-hidden';
      if (
        returningFromPassive &&
        this.wanted.size > 0 &&
        !this.reconciling &&
        !this.reconcileScheduled
      ) {
        this.scheduleReconcile();
      }
      this.pool.setDesiredInstruments(this.desiredInstruments);
      this.startUncoveredTimer();
      this.scheduleRecovery();
      this.scheduleFreshnessRecompute();
      if (previous === 'realtime') return;
      // resume 已经统一刷过一次
      if (ctx.fromResume) return;
      // reconcile 会负责首刷，这里只记账，避免两个 owner 各刷一轮
      if (this.reconciling || this.reconcileScheduled) {
        this.enteredRealtimeDuringReconcile = true;
        return;
      }
      void this.refreshAssets().catch(() => {});
      return;
    }
    this.pool.closeAll();
    this.clearUncoveredTimer();
    this.clearRecoveryTimer();
    if (mode === 'off') this.clearFreshnessTimer();
    else this.scheduleFreshnessRecompute();
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

  /** 累计启动过多少个并发 refresh run；用于断言「没有第三个并发 run」 */
  __refreshRunCountForTest(): number {
    return this.refreshRunCount;
  }

  /** 累计启动过多少次冷启动解析 */
  __resolveRunCountForTest(): number {
    return this.resolveRunCount;
  }

  /** 某个资产此刻是否还留着未被消费的 resolution handoff */
  __hasResolutionHandoffForTest(assetKey: AssetKey): boolean {
    return this.resolutionHandoff.has(migrateAssetKey(assetKey));
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

    const owner = this.ownerFor(assetKey);
    const pending = this.resolving.get(assetKey);
    // 只有完整 owner 相同才能复用在飞的解析。只比 assetEpoch 的话，
    // suspend 期间发出的旧 resolver 会被 resume 当成自己那一轮，
    // 结果既不重新取价、又要等一个已经失效的 Promise
    if (pending && sameOwner(pending.owner, owner)) return pending.promise;

    const entry: { owner: OperationOwner; promise: Promise<VenueInstrument[]> } = {
      owner,
      promise: null as unknown as Promise<VenueInstrument[]>,
    };
    this.resolveRunCount += 1;
    entry.promise = this.doResolve(owner).finally(() => {
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
  private async doResolve(owner: OperationOwner): Promise<VenueInstrument[]> {
    const assetKey = owner.assetKey;
    // 只读本地 catalog 缓存；解析永远不会触发远程 catalog 刷新
    await exchangeCatalog.loadCachedOnly();
    if (!this.ownsOperation(owner)) return [];

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
      if (!this.ownsOperation(owner)) return [];
      const probe = await this.verifyCandidates(owner, tier);
      if (!this.ownsOperation(owner)) return [];
      if (probe.attempted) attempted.add(tier);
      if (probe.instruments.length === 0) continue;
      verified.push(...probe.instruments);
      quotedTier = tier;
      this.setEffectiveTier(assetKey, tier);
      break;
    }

    if (!this.ownsOperation(owner)) return [];
    this.resolved.set(assetKey, verified);
    // 本轮试过的层（成功或失败）都不该被紧随其后的首刷重打一遍。
    // 证据绑定完整 owner：换了 regime 之后它就作废，不能拿来跳过 resume 那一轮
    this.resolutionHandoff.set(assetKey, { owner, attempted, quotedTier });
    if (verified.length === 0) {
      this.unavailable.add(assetKey);
    } else {
      this.unavailable.delete(assetKey);
      void exchangeCatalog.mergeResolvedInstruments(verified);
    }
    return verified;
  }

  /** 一次性取用 resolution 证据；owner 对不上说明是别人留下的，不能用 */
  private takeResolutionHandoff(owner: OperationOwner): ResolutionHandoff | null {
    const handoff = this.resolutionHandoff.get(owner.assetKey);
    if (!handoff) return null;
    // owner 对不上就原样留着：旧 regime 的 run 不能删掉新 regime 留下的证据
    if (!sameOwner(handoff.owner, owner)) return null;
    this.resolutionHandoff.delete(owner.assetKey);
    return handoff;
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

  /** 首次尝试不限频；之后同一个 candidate 的两次验证至少间隔 CANDIDATE_RETRY_MS */
  private candidateEligibleAt(assetKey: AssetKey, instrument: VenueInstrument): number {
    return this.candidateAttempts.get(candidateIdentity(assetKey, instrument))?.nextEligibleAt ?? 0;
  }

  private eligibleCandidates(
    assetKey: AssetKey,
    candidates: VenueInstrument[],
    now: number,
  ): VenueInstrument[] {
    return candidates.filter((c) => this.candidateEligibleAt(assetKey, c) <= now);
  }

  /**
   * 记账必须发生在请求发出之前：即使结果因为 regime 失效被丢弃，这次网络请求也确实
   * 发生过，resume 之后不能立刻原样重来一遍。
   */
  private markCandidateAttempts(
    assetKey: AssetKey,
    instruments: VenueInstrument[],
    now: number,
  ): void {
    for (const instrument of instruments) {
      this.candidateAttempts.set(candidateIdentity(assetKey, instrument), {
        lastAttemptAt: now,
        nextEligibleAt: now + CANDIDATE_RETRY_MS,
      });
    }
  }

  /**
   * 定向验证这一层还没验上的 candidate，只返回真的拿到可用报价的那些。
   * 未验证的 candidate 绝不会进入 resolved，也就不会被 WebSocket 订阅。
   */
  private async verifyCandidates(
    owner: OperationOwner,
    tier: SourceTier,
    options: { throttle?: boolean; missingVenuesOnly?: boolean } = {},
  ): Promise<CandidateProbe> {
    const assetKey = owner.assetKey;
    const all = options.missingVenuesOnly
      ? this.pendingCandidates(assetKey, tier)
      : this.unresolvedCandidates(assetKey, tier);
    // 结构性没有 candidate（crypto:USDT、FX）：稳定不可用，永远不产生请求
    if (all.length === 0) return { attempted: false, instruments: [] };

    const now = Date.now();
    const candidates = options.throttle ? this.eligibleCandidates(assetKey, all, now) : all;
    if (candidates.length === 0) return { attempted: false, instruments: [] };
    this.markCandidateAttempts(assetKey, candidates, now);

    const quotes = await fetchTargetedQuotes(candidates);
    if (!this.ownsOperation(owner)) return { attempted: true, instruments: [] };

    const usable = quotes.filter((quote) => isUsableQuote(quote, Date.now(), TRADABLE_MAX_AGE_MS));
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

  private async doRefresh(owners: OperationOwner[]): Promise<void> {
    await Promise.all(owners.map((owner) => this.ensureResolved(owner.assetKey)));
    await Promise.all(owners.map((owner) => this.refreshTiers(owner)));

    const live = owners.filter((owner) => this.ownsOperation(owner)).map((o) => o.assetKey);
    for (const key of live) this.recompute(key);
    if (live.length === 0) return;
    this.syncDesiredInstruments();
    this.notifyNow();
    this.scheduleFreshnessRecompute();
    void this.persist();
  }

  /**
   * 从 Tier 1 开始逐层定向请求，第一个拿到本轮可用报价的层就是这个资产当前的 effective tier。
   * 当前层在 resolved 里不存在时按需验证 candidate，验证通过才追加进 resolved。
   * 每次 await 之后都要重新确认所有权，失效后既不发下一层请求也不写任何状态。
   */
  private async refreshTiers(owner: OperationOwner): Promise<void> {
    // 先确认所有权，再碰 handoff：失效的 run 连读都不该读，更不能把它删掉
    if (!this.ownsOperation(owner)) return;
    const assetKey = owner.assetKey;
    const handoff = this.takeResolutionHandoff(owner);

    for (const tier of [1, 2, 3] as const) {
      if (!this.ownsOperation(owner)) return;

      // 刚刚的 resolution 已经试过这一层：成功就直接收工，失败也不在同一轮重打
      if (handoff?.attempted.has(tier)) {
        if (handoff.quotedTier === tier && this.hasUsableQuote(assetKey, tier)) return;
        continue;
      }

      const instruments = this.instrumentsInTier(assetKey, tier);
      if (instruments.length > 0) {
        // 这一层刚被定向请求过，掉档后的恢复探测不能马上把同样的请求再打一遍
        this.markCandidateAttempts(assetKey, instruments, Date.now());
        const quotes = await fetchTargetedQuotes(instruments);
        if (!this.ownsOperation(owner)) return;
        const now = Date.now();
        const usable = quotes.filter((quote) => isUsableQuote(quote, now, TRADABLE_MAX_AGE_MS));
        for (const quote of usable) this.quotes.ingest(quote);
        if (usable.length > 0) {
          this.setEffectiveTier(assetKey, tier);
          // 同层还缺的 venue 顺带补验一次，但要等它自己的 5 分钟窗口到期
          await this.topUpMissingVenues(owner, tier);
          return;
        }
        continue;
      }

      // resolved 里没有这一层：按需验证候选，同样受每个 candidate 自己的窗口约束。
      // Hyperliquid 不产出 candidate，HIP-3 只能来自经过 deployer 校验的 catalog
      const probe = await this.verifyCandidates(owner, tier, { throttle: true });
      if (!this.ownsOperation(owner)) return;
      if (probe.instruments.length === 0) continue;
      this.appendResolved(assetKey, probe.instruments);
      this.setEffectiveTier(assetKey, tier);
      return;
    }
  }

  /** 当前层已经出价，但同层还有没验上的 venue —— PASSIVE 模式靠这里补回来 */
  private async topUpMissingVenues(owner: OperationOwner, tier: SourceTier): Promise<void> {
    const probe = await this.verifyCandidates(owner, tier, {
      throttle: true,
      missingVenuesOnly: true,
    });
    if (!this.ownsOperation(owner)) return;
    if (probe.instruments.length === 0) return;
    this.appendResolved(owner.assetKey, probe.instruments);
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
    // lifecycle 进入 REALTIME，才能排上低频恢复探测
    this.applyTransport();
    this.scheduleRecovery();
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
    // 首次解析还没落地时不插手：那一轮本来就在打同一批 candidate
    if (!this.resolved.has(assetKey)) return [];
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

  /** 还需要低频探测、且各自窗口已经到期的资产 */
  private recoveryTargets(
    now: number,
  ): Array<{ owner: OperationOwner; probing: VenueInstrument[] }> {
    const out: Array<{ owner: OperationOwner; probing: VenueInstrument[] }> = [];
    for (const key of this.wanted) {
      const probing = this.eligibleCandidates(key, this.recoveryProbeInstruments(key), now);
      if (probing.length > 0) out.push({ owner: this.ownerFor(key), probing });
    }
    return out;
  }

  /** 下一个 candidate 到期的绝对时刻；没有任何待探测目标时返回 null */
  private nextRecoveryDueAt(): number | null {
    let due: number | null = null;
    for (const key of this.wanted) {
      for (const instrument of this.recoveryProbeInstruments(key)) {
        const at = this.candidateEligibleAt(key, instrument);
        if (due == null || at < due) due = at;
      }
    }
    return due;
  }

  /**
   * REALTIME 下唯一的低频恢复调度：全局只有一个 wake-up timer，但唤醒后只挑
   * 自己窗口到期的 candidate。一个旧资产到期不代表所有资产都到期。
   */
  protected scheduleRecovery(): void {
    if (this.lifecycle.getMode() !== 'realtime') {
      this.clearRecoveryTimer();
      return;
    }
    const due = this.nextRecoveryDueAt();
    if (due == null) {
      this.clearRecoveryTimer();
      return;
    }
    // 已经排在更早或同一时刻的 timer 不能被推后，否则先到期的资产会被拖着走
    if (this.recoveryTimer && this.recoveryArmedFor != null && this.recoveryArmedFor <= due) return;
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);

    const epoch = this.regimeEpoch;
    this.recoveryArmedFor = due;
    this.recoveryTimer = setTimeout(
      () => {
        this.recoveryTimer = null;
        this.recoveryArmedFor = null;
        if (epoch !== this.regimeEpoch) return;
        void this.runRecovery(epoch).finally(() => {
          if (epoch !== this.regimeEpoch) return;
          if (this.lifecycle.getMode() !== 'realtime') return;
          this.scheduleRecovery();
        });
      },
      Math.max(0, due - Date.now()),
    );
  }

  /** 兼容旧调用点：模式进入 REALTIME 时重新排一次 */
  protected startRecoveryTimer(): void {
    this.scheduleRecovery();
  }

  private async runRecovery(epoch: number): Promise<void> {
    const now = Date.now();
    const targets = this.recoveryTargets(now);
    if (targets.length === 0) return;
    for (const target of targets) {
      this.markCandidateAttempts(target.owner.assetKey, target.probing, now);
    }

    const quotes = await fetchTargetedQuotes(targets.flatMap((t) => t.probing)).catch(
      () => [] as VenueQuote[],
    );
    if (epoch !== this.regimeEpoch) return;

    const at = Date.now();
    let changed = false;
    for (const { owner, probing } of targets) {
      if (!this.ownsOperation(owner)) continue;
      const usable = quotes.filter(
        (quote) =>
          quote.assetKey === owner.assetKey && isUsableQuote(quote, at, TRADABLE_MAX_AGE_MS),
      );
      if (usable.length === 0) continue;

      // 只接受本轮最优（最低）层的结果，绝不把两层混进同一个资产
      const best = Math.min(...usable.map((quote) => productTier(quote.productKind))) as SourceTier;
      const current = this.effectiveTier.get(owner.assetKey);
      if (current != null && current < best) continue;

      const liveIds = new Set(usable.map((quote) => `${quote.venue}|${quote.instrumentId}`));
      this.appendResolved(
        owner.assetKey,
        probing.filter((i) => liveIds.has(instrumentId(i))),
      );
      for (const quote of usable) {
        if (productTier(quote.productKind) !== best) continue;
        this.quotes.ingest(quote);
      }
      this.setEffectiveTier(owner.assetKey, best);
      this.recompute(owner.assetKey);
      changed = true;
    }
    if (!changed) return;
    this.syncDesiredInstruments();
    this.notifyNow();
    this.scheduleFreshnessRecompute();
  }

  protected clearRecoveryTimer(): void {
    this.recoveryArmedFor = null;
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  /**
   * 报价过期是时间到了就发生的事，不该等下一条报价或用户操作才被发现。
   * 这个 timer 只做本地 recompute + 通知，绝不产生 HTTP。
   */
  private scheduleFreshnessRecompute(): void {
    this.clearFreshnessTimer();
    if (this.currentUnion.size === 0) return;
    const window = this.freshnessWindowMs();
    const now = Date.now();
    let due: number | null = null;
    for (const key of this.currentUnion) {
      for (const quote of this.quotes.quotesFor(key)) {
        const expiresAt = quote.receivedAt + window;
        if (expiresAt > now && (due == null || expiresAt < due)) due = expiresAt;
      }
    }
    if (due == null) return;
    // +1ms：正好等于窗口时还算 fresh，跨过去才会变 stale
    this.freshnessTimer = setTimeout(
      () => {
        this.freshnessTimer = null;
        for (const key of this.currentUnion) this.recompute(key);
        this.notifyNow();
        this.scheduleFreshnessRecompute();
      },
      Math.max(1, due + 1 - now),
    );
  }

  private clearFreshnessTimer(): void {
    if (this.freshnessTimer) {
      clearTimeout(this.freshnessTimer);
      this.freshnessTimer = null;
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
    this.scheduleFreshnessRecompute();
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
