/**
 * 行情传输的页面生命周期状态机
 *
 * 所有 focus / blur / visibilitychange / pagehide / freeze / pageshow / resume
 * 都汇总到 `reconcileDesiredMode()` 一处判定，不在各监听器里散落独立开关逻辑。
 *
 *   OFF              没有 active Watchlist 或没有 selected AssetKeys
 *   REALTIME         visible + focused（含两段宽限期）：WebSocket，无周期请求
 *   PASSIVE_VISIBLE  visible 且连续失焦满 5 分钟：关 WS，60 秒 targeted REST
 *   PASSIVE_HIDDEN   hidden 满 30 秒，或本来就是 passive 时进入 hidden：5 分钟 targeted REST
 *
 * 宽限期一律用绝对 deadline 判定，不依赖 setTimeout 准时——Chrome 后台会拉长 timer。
 */

export type TransportMode = 'off' | 'realtime' | 'passive-visible' | 'passive-hidden';

/** visible 但失焦后仍保持 REALTIME 的时长 */
export const BLUR_GRACE_MS = 5 * 60_000;
/** 从 REALTIME 进入 hidden 后保留原连接的时长，避免快速切 tab 造成连接风暴 */
export const HIDDEN_GRACE_MS = 30_000;
export const PASSIVE_VISIBLE_INTERVAL_MS = 60_000;
export const PASSIVE_HIDDEN_INTERVAL_MS = 5 * 60_000;

export interface ModeChangeContext {
  /** 这次模式变化是 pageshow / resume 引起的 */
  fromResume: boolean;
}

export interface TransportLifecycleOptions {
  /** 是否存在 active Watchlist 且有 selected AssetKeys */
  hasWork: () => boolean;
  onModeChange: (mode: TransportMode, previous: TransportMode, ctx: ModeChangeContext) => void;
  onPassiveTick: (mode: TransportMode) => void;
  /** 恢复后无论落到哪个模式都要立即刷新一次，不能等 60 秒或 5 分钟 */
  onResume: () => void;
}

function isVisible(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'hidden';
}

function isFocused(): boolean {
  if (typeof document === 'undefined') return true;
  return typeof document.hasFocus === 'function' ? document.hasFocus() : true;
}

export class TransportLifecycle {
  private mode: TransportMode = 'off';
  private blurredSince: number | null = null;
  private hiddenSince: number | null = null;
  private modeBeforeBlur: TransportMode = 'off';
  private modeBeforeHidden: TransportMode = 'off';
  private suspended = false;
  private started = false;
  private resuming = false;

  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private passiveTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners: Array<[string, EventListener]> = [];

  constructor(private readonly options: TransportLifecycleOptions) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    if (typeof window === 'undefined') return;

    const on = (target: EventTarget, type: string, handler: EventListener) => {
      target.addEventListener(type, handler);
      this.listeners.push([type, handler]);
    };

    on(window, 'focus', () => {
      this.blurredSince = null;
      this.reconcileDesiredMode();
    });
    on(window, 'blur', () => {
      if (this.blurredSince == null) {
        this.blurredSince = Date.now();
        this.modeBeforeBlur = this.mode;
      }
      this.reconcileDesiredMode();
    });
    on(document, 'visibilitychange', () => {
      if (isVisible()) {
        this.hiddenSince = null;
      } else if (this.hiddenSince == null) {
        this.hiddenSince = Date.now();
        this.modeBeforeHidden = this.mode;
      }
      this.reconcileDesiredMode();
    });
    on(window, 'pagehide', () => this.suspend());
    on(window, 'pageshow', () => this.resume());
    // freeze / resume 由 Page Lifecycle API 派发在 document 上且不冒泡，挂在 window 上收不到
    on(document, 'freeze', () => this.suspend());
    on(document, 'resume', () => this.resume());
  }

  stop(): void {
    this.clearTimers();
    if (typeof window !== 'undefined') {
      for (const [type, handler] of this.listeners) {
        window.removeEventListener(type, handler);
        document.removeEventListener(type, handler);
      }
    }
    this.listeners = [];
    this.started = false;
    this.mode = 'off';
    this.blurredSince = null;
    this.hiddenSince = null;
    this.suspended = false;
  }

  getMode(): TransportMode {
    return this.mode;
  }

  /** 唯一的模式判定入口 */
  reconcileDesiredMode(): void {
    const next = this.computeMode(Date.now());
    if (next !== this.mode) {
      const previous = this.mode;
      this.mode = next;
      this.restartPassiveTimer();
      this.options.onModeChange(next, previous, { fromResume: this.resuming });
    }
    this.scheduleDeadline();
  }

  private computeMode(now: number): TransportMode {
    if (this.suspended || !this.options.hasWork()) return 'off';

    if (!isVisible()) {
      const inGrace =
        this.hiddenSince != null &&
        now - this.hiddenSince < HIDDEN_GRACE_MS &&
        this.modeBeforeHidden === 'realtime';
      return inGrace ? 'realtime' : 'passive-hidden';
    }

    if (isFocused()) return 'realtime';

    const inGrace =
      this.blurredSince != null &&
      now - this.blurredSince < BLUR_GRACE_MS &&
      this.modeBeforeBlur === 'realtime';
    return inGrace ? 'realtime' : 'passive-visible';
  }

  /** 宽限期结束时重新判定；deadline 是绝对时间，timer 迟到也不会误判 */
  private scheduleDeadline(): void {
    if (this.deadlineTimer) {
      clearTimeout(this.deadlineTimer);
      this.deadlineTimer = null;
    }
    if (this.suspended || this.mode !== 'realtime') return;

    let deadline: number | null = null;
    if (!isVisible() && this.hiddenSince != null) {
      deadline = this.hiddenSince + HIDDEN_GRACE_MS;
    } else if (isVisible() && !isFocused() && this.blurredSince != null) {
      deadline = this.blurredSince + BLUR_GRACE_MS;
    }
    if (deadline == null) return;

    this.deadlineTimer = setTimeout(
      () => {
        this.deadlineTimer = null;
        this.reconcileDesiredMode();
      },
      Math.max(0, deadline - Date.now()),
    );
  }

  /**
   * passive 模式的 targeted REST 节奏。用自重排的 setTimeout 而不是 setInterval：
   * 后台 timer 被拉长时只跑一次，不会补发多轮请求。
   */
  private restartPassiveTimer(): void {
    if (this.passiveTimer) {
      clearTimeout(this.passiveTimer);
      this.passiveTimer = null;
    }
    const interval = this.passiveInterval();
    if (interval == null) return;

    const tick = () => {
      this.passiveTimer = setTimeout(() => {
        this.passiveTimer = null;
        const current = this.passiveInterval();
        if (current == null) return;
        this.options.onPassiveTick(this.mode);
        tick();
      }, interval);
    };
    tick();
  }

  private passiveInterval(): number | null {
    if (this.mode === 'passive-visible') return PASSIVE_VISIBLE_INTERVAL_MS;
    if (this.mode === 'passive-hidden') return PASSIVE_HIDDEN_INTERVAL_MS;
    return null;
  }

  private suspend(): void {
    if (this.suspended) return;
    this.suspended = true;
    this.reconcileDesiredMode();
  }

  private resume(): void {
    // 一次真实恢复可能先后收到 resume 和 pageshow；页面首次加载的 pageshow
    // 之前根本没有 suspend 过，必须是 no-op
    if (!this.suspended) return;
    this.suspended = false;
    // 重新读取当前 visibility / focus，不沿用挂起前的宽限期
    this.blurredSince = null;
    this.hiddenSince = null;
    this.resuming = true;
    try {
      this.reconcileDesiredMode();
      // 恢复只在这里刷新一次；onModeChange 看到 fromResume 就不会再刷一轮
      if (this.mode !== 'off') this.options.onResume();
    } finally {
      this.resuming = false;
    }
  }

  private clearTimers(): void {
    if (this.deadlineTimer) {
      clearTimeout(this.deadlineTimer);
      this.deadlineTimer = null;
    }
    if (this.passiveTimer) {
      clearTimeout(this.passiveTimer);
      this.passiveTimer = null;
    }
  }
}
