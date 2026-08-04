import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BLUR_GRACE_MS,
  HIDDEN_GRACE_MS,
  PASSIVE_HIDDEN_INTERVAL_MS,
  PASSIVE_VISIBLE_INTERVAL_MS,
  TransportLifecycle,
  type TransportMode,
} from './lifecycle';

let visibility: DocumentVisibilityState = 'visible';
let focused = true;

function setVisibility(next: DocumentVisibilityState): void {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

function setFocus(next: boolean): void {
  focused = next;
  window.dispatchEvent(new Event(next ? 'focus' : 'blur'));
}

interface Harness {
  lifecycle: TransportLifecycle;
  modes: Array<{ mode: TransportMode; previous: TransportMode; fromResume: boolean }>;
  ticks: TransportMode[];
  resumes: number;
  setHasWork: (value: boolean) => void;
}

function createHarness(initialWork = true): Harness {
  let hasWork = initialWork;
  const modes: Array<{ mode: TransportMode; previous: TransportMode; fromResume: boolean }> = [];
  const ticks: TransportMode[] = [];
  const state = { resumes: 0 };
  const lifecycle = new TransportLifecycle({
    hasWork: () => hasWork,
    onModeChange: (mode, previous, ctx) =>
      modes.push({ mode, previous, fromResume: ctx.fromResume }),
    onPassiveTick: (mode) => ticks.push(mode),
    onResume: () => {
      state.resumes += 1;
    },
  });
  lifecycle.start();
  lifecycle.reconcileDesiredMode();
  return {
    lifecycle,
    modes,
    ticks,
    get resumes() {
      return state.resumes;
    },
    setHasWork: (value) => {
      hasWork = value;
      lifecycle.reconcileDesiredMode();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  focused = true;
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('OFF', () => {
  it('没有 active watchlist 或没有 selected assets 时为 OFF', () => {
    const h = createHarness(false);
    expect(h.lifecycle.getMode()).toBe('off');
    expect(vi.getTimerCount()).toBe(0);
    h.lifecycle.stop();
  });

  it('有工作后进入 REALTIME，工作消失后回到 OFF 并清空 timer', () => {
    const h = createHarness(false);
    h.setHasWork(true);
    expect(h.lifecycle.getMode()).toBe('realtime');

    h.setHasWork(false);
    expect(h.lifecycle.getMode()).toBe('off');
    expect(vi.getTimerCount()).toBe(0);
    h.lifecycle.stop();
  });
});

describe('REALTIME 与失焦宽限', () => {
  it('visible + focused 是 REALTIME', () => {
    const h = createHarness();
    expect(h.lifecycle.getMode()).toBe('realtime');
    h.lifecycle.stop();
  });

  it('失焦 4 分 59 秒仍保持 REALTIME', () => {
    const h = createHarness();
    setFocus(false);
    vi.advanceTimersByTime(BLUR_GRACE_MS - 1000);
    h.lifecycle.reconcileDesiredMode();

    expect(h.lifecycle.getMode()).toBe('realtime');
    expect(h.modes.filter((m) => m.mode !== 'realtime')).toHaveLength(0);
    h.lifecycle.stop();
  });

  it('失焦满 5 分钟才切到 PASSIVE_VISIBLE', () => {
    const h = createHarness();
    setFocus(false);
    vi.advanceTimersByTime(BLUR_GRACE_MS);

    expect(h.lifecycle.getMode()).toBe('passive-visible');
    h.lifecycle.stop();
  });

  it('宽限期内恢复 focus 不产生任何模式变化（不重连、不额外 refresh）', () => {
    const h = createHarness();
    const before = h.modes.length;
    setFocus(false);
    vi.advanceTimersByTime(60_000);
    setFocus(true);
    vi.advanceTimersByTime(BLUR_GRACE_MS * 2);

    expect(h.lifecycle.getMode()).toBe('realtime');
    expect(h.modes).toHaveLength(before);
    h.lifecycle.stop();
  });

  it('快速 focus / blur 抖动不产生连接风暴', () => {
    const h = createHarness();
    const before = h.modes.length;
    for (let i = 0; i < 20; i += 1) {
      setFocus(false);
      vi.advanceTimersByTime(50);
      setFocus(true);
      vi.advanceTimersByTime(50);
    }
    expect(h.modes).toHaveLength(before);
    h.lifecycle.stop();
  });
});

describe('PASSIVE_VISIBLE', () => {
  it('每 60 秒最多一次 targeted refresh', () => {
    const h = createHarness();
    setFocus(false);
    vi.advanceTimersByTime(BLUR_GRACE_MS);
    expect(h.lifecycle.getMode()).toBe('passive-visible');

    vi.advanceTimersByTime(PASSIVE_VISIBLE_INTERVAL_MS - 1);
    expect(h.ticks).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(h.ticks).toHaveLength(1);
    vi.advanceTimersByTime(PASSIVE_VISIBLE_INTERVAL_MS * 3);
    expect(h.ticks).toHaveLength(4);
    h.lifecycle.stop();
  });

  it('恢复 focus 后回到 REALTIME 且只触发一次模式变化', () => {
    const h = createHarness();
    setFocus(false);
    vi.advanceTimersByTime(BLUR_GRACE_MS);
    const before = h.modes.length;

    setFocus(true);

    expect(h.lifecycle.getMode()).toBe('realtime');
    expect(h.modes.slice(before)).toEqual([
      { mode: 'realtime', previous: 'passive-visible', fromResume: false },
    ]);
    h.lifecycle.stop();
  });
});

describe('hidden 宽限与 PASSIVE_HIDDEN', () => {
  it('从 REALTIME 进入 hidden 后 30 秒内保持原连接', () => {
    const h = createHarness();
    setVisibility('hidden');
    vi.advanceTimersByTime(HIDDEN_GRACE_MS - 1);
    h.lifecycle.reconcileDesiredMode();

    expect(h.lifecycle.getMode()).toBe('realtime');
    h.lifecycle.stop();
  });

  it('hidden 满 30 秒后切到 PASSIVE_HIDDEN', () => {
    const h = createHarness();
    setVisibility('hidden');
    vi.advanceTimersByTime(HIDDEN_GRACE_MS);

    expect(h.lifecycle.getMode()).toBe('passive-hidden');
    h.lifecycle.stop();
  });

  it('30 秒内恢复 visible + focused 时继续复用原连接', () => {
    const h = createHarness();
    const before = h.modes.length;
    setVisibility('hidden');
    vi.advanceTimersByTime(10_000);
    setVisibility('visible');
    vi.advanceTimersByTime(HIDDEN_GRACE_MS * 2);

    expect(h.lifecycle.getMode()).toBe('realtime');
    expect(h.modes).toHaveLength(before);
    h.lifecycle.stop();
  });

  it('失焦宽限期间转 hidden 时使用新的 30 秒 deadline', () => {
    const h = createHarness();
    setFocus(false);
    vi.advanceTimersByTime(60_000);
    setVisibility('hidden');

    // 还在新的 30 秒宽限内
    vi.advanceTimersByTime(HIDDEN_GRACE_MS - 1000);
    h.lifecycle.reconcileDesiredMode();
    expect(h.lifecycle.getMode()).toBe('realtime');

    // 满 30 秒立即降级，不会继续等原来的 5 分钟
    vi.advanceTimersByTime(1000);
    expect(h.lifecycle.getMode()).toBe('passive-hidden');
    h.lifecycle.stop();
  });

  it('本来就是 PASSIVE_VISIBLE 时进入 hidden 不重新开 WS', () => {
    const h = createHarness();
    setFocus(false);
    vi.advanceTimersByTime(BLUR_GRACE_MS);
    expect(h.lifecycle.getMode()).toBe('passive-visible');
    const before = h.modes.length;

    setVisibility('hidden');

    // 直接从 passive-visible 掉到 passive-hidden，中间不会回到 realtime
    expect(h.lifecycle.getMode()).toBe('passive-hidden');
    expect(h.modes.slice(before)).toEqual([
      { mode: 'passive-hidden', previous: 'passive-visible', fromResume: false },
    ]);
    vi.advanceTimersByTime(HIDDEN_GRACE_MS * 2);
    expect(h.modes.slice(before).map((m) => m.mode)).not.toContain('realtime');
    h.lifecycle.stop();
  });

  it('PASSIVE_HIDDEN 每 5 分钟最多一次 targeted refresh，后台延迟也不补发', () => {
    const h = createHarness();
    setVisibility('hidden');
    vi.advanceTimersByTime(HIDDEN_GRACE_MS);
    expect(h.lifecycle.getMode()).toBe('passive-hidden');

    vi.advanceTimersByTime(PASSIVE_HIDDEN_INTERVAL_MS);
    expect(h.ticks).toHaveLength(1);

    // 模拟被 Chrome 拉长的一大段时间：只会跑掉排好的那几次，不会一次性补发
    vi.advanceTimersByTime(PASSIVE_HIDDEN_INTERVAL_MS * 2);
    expect(h.ticks).toHaveLength(3);
    h.lifecycle.stop();
  });
});

describe('pagehide / freeze / pageshow / resume', () => {
  it('pagehide 立即进入 OFF 并清掉所有 timer', () => {
    const h = createHarness();
    window.dispatchEvent(new Event('pagehide'));

    expect(h.lifecycle.getMode()).toBe('off');
    expect(vi.getTimerCount()).toBe(0);
    h.lifecycle.stop();
  });

  // freeze / resume 在 document 上派发且不冒泡，这里必须按真实派发目标断言
  it('freeze 同样进入 OFF', () => {
    const h = createHarness();
    document.dispatchEvent(new Event('freeze'));
    expect(h.lifecycle.getMode()).toBe('off');
    h.lifecycle.stop();
  });

  it('pageshow 重新 reconcile，只触发一次进入 REALTIME', () => {
    const h = createHarness();
    window.dispatchEvent(new Event('pagehide'));
    const before = h.modes.length;

    window.dispatchEvent(new Event('pageshow'));

    expect(h.lifecycle.getMode()).toBe('realtime');
    expect(h.modes.slice(before)).toEqual([
      { mode: 'realtime', previous: 'off', fromResume: true },
    ]);
    h.lifecycle.stop();
  });

  it('resume 后按当前 visibility / focus 重新判定，不沿用挂起前的宽限期', () => {
    const h = createHarness();
    setFocus(false);
    vi.advanceTimersByTime(60_000);
    document.dispatchEvent(new Event('freeze'));

    document.dispatchEvent(new Event('resume'));

    expect(h.lifecycle.getMode()).toBe('passive-visible');
    h.lifecycle.stop();
  });
});

describe('恢复事件去重（组合顺序）', () => {
  it('初次加载的 pageshow 之前没有 suspend，必须是 no-op', () => {
    const h = createHarness();
    const before = h.modes.length;

    window.dispatchEvent(new Event('pageshow'));

    expect(h.resumes).toBe(0);
    expect(h.modes).toHaveLength(before);
    h.lifecycle.stop();
  });

  it('pagehide → pageshow 只恢复一次', () => {
    const h = createHarness();
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pageshow'));

    expect(h.resumes).toBe(1);
    h.lifecycle.stop();
  });

  it('freeze → resume 只恢复一次', () => {
    const h = createHarness();
    document.dispatchEvent(new Event('freeze'));
    document.dispatchEvent(new Event('resume'));

    expect(h.resumes).toBe(1);
    h.lifecycle.stop();
  });

  it('pagehide → freeze → resume → pageshow 整个序列只恢复一次', () => {
    const h = createHarness();

    window.dispatchEvent(new Event('pagehide'));
    document.dispatchEvent(new Event('freeze'));
    document.dispatchEvent(new Event('resume'));
    window.dispatchEvent(new Event('pageshow'));

    expect(h.resumes).toBe(1);
    expect(h.lifecycle.getMode()).toBe('realtime');
    h.lifecycle.stop();
  });

  it('重复的 pageshow 不会重复恢复', () => {
    const h = createHarness();
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(new Event('pageshow'));
    document.dispatchEvent(new Event('resume'));

    expect(h.resumes).toBe(1);
    h.lifecycle.stop();
  });

  it('没有 active symbol 时恢复不触发刷新', () => {
    const h = createHarness(false);
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pageshow'));

    expect(h.resumes).toBe(0);
    expect(h.lifecycle.getMode()).toBe('off');
    h.lifecycle.stop();
  });
});

describe('清理', () => {
  it('stop 之后不再有 timer 与 listener 残留', () => {
    const h = createHarness();
    setFocus(false);
    vi.advanceTimersByTime(BLUR_GRACE_MS);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    h.lifecycle.stop();
    expect(vi.getTimerCount()).toBe(0);

    const before = h.modes.length;
    setFocus(true);
    setVisibility('hidden');
    expect(h.modes).toHaveLength(before);
  });
});
