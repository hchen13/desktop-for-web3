/**
 * 后台被挂起后的 overdue callback（L8）
 *
 * Chrome 把标签页丢到后台时会直接停掉 event loop：wall clock 照走，排好的 timer 一个
 * 都不执行，恢复时只把最后那次唤醒补上。`advanceTimersByTime` 会老老实实逐个补跑中间
 * 的周期，`setSystemTime + advanceTimersToNextTimer` 又根本造不出 overdue callback，
 * 两者都证明不了「不补发」。这里改用可控 scheduler：自己持有已排定的 callback，
 * 只推进 wall clock，再手动唤醒一次。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PASSIVE_HIDDEN_INTERVAL_MS, TransportLifecycle, type TransportMode } from './lifecycle';

interface ScheduledTask {
  id: number;
  fn: () => void;
  at: number;
}

let now: number;
let seq: number;
let tasks: Map<number, ScheduledTask>;
let visibility: DocumentVisibilityState;
let focused: boolean;

/** 接管 setTimeout / clearTimeout / Date.now，callback 只在测试显式唤醒时才执行 */
function installScheduler(): void {
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, delay = 0) => {
    seq += 1;
    tasks.set(seq, { id: seq, fn, at: now + delay });
    return seq as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);
  vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((id: number) => {
    tasks.delete(id);
  }) as typeof clearTimeout);
}

/** 只推进 wall clock，不执行任何 callback —— 这就是后台挂起 */
function advanceWallClock(ms: number): void {
  now += ms;
}

function pending(): ScheduledTask[] {
  return [...tasks.values()];
}

/** 手动唤醒一个已排定的 callback，且只唤醒这一次 */
function wakeOnce(task: ScheduledTask): void {
  tasks.delete(task.id);
  task.fn();
}

beforeEach(() => {
  now = 1_700_000_000_000;
  seq = 0;
  tasks = new Map();
  visibility = 'hidden';
  focused = false;
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  installScheduler();
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface Harness {
  lifecycle: TransportLifecycle;
  ticks: TransportMode[];
  setHasWork: (value: boolean) => void;
}

function createHiddenHarness(): Harness {
  let hasWork = true;
  const ticks: TransportMode[] = [];
  const lifecycle = new TransportLifecycle({
    hasWork: () => hasWork,
    onModeChange: () => {},
    onPassiveTick: (mode) => ticks.push(mode),
    onResume: () => {},
  });
  lifecycle.start();
  lifecycle.reconcileDesiredMode();
  return {
    lifecycle,
    ticks,
    setHasWork: (value) => {
      hasWork = value;
      lifecycle.reconcileDesiredMode();
    },
  };
}

describe('探针本身要能识别补发', () => {
  it('会补跑错过周期的实现在同一套驱动下会跑很多次', () => {
    const ticks: number[] = [];
    let last = Date.now();
    const arm = () => {
      setTimeout(() => {
        // 典型的「补齐错过的周期」写法
        while (Date.now() - last >= PASSIVE_HIDDEN_INTERVAL_MS) {
          last += PASSIVE_HIDDEN_INTERVAL_MS;
          ticks.push(Date.now());
        }
        arm();
      }, PASSIVE_HIDDEN_INTERVAL_MS);
    };
    arm();

    const scheduled = pending();
    expect(scheduled).toHaveLength(1);
    advanceWallClock(PASSIVE_HIDDEN_INTERVAL_MS * 20);
    wakeOnce(scheduled[0]);

    expect(ticks.length).toBe(20);
  });
});

describe('L8 passive tick 在后台挂起后不补发', () => {
  it('挂起 20 个周期后只唤醒一次：一轮 tick、一个新 timer', () => {
    const h = createHiddenHarness();
    expect(h.lifecycle.getMode()).toBe('passive-hidden');

    const scheduled = pending();
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].at).toBe(now + PASSIVE_HIDDEN_INTERVAL_MS);

    advanceWallClock(PASSIVE_HIDDEN_INTERVAL_MS * 20);
    expect(h.ticks).toHaveLength(0);

    wakeOnce(scheduled[0]);

    expect(h.ticks).toEqual(['passive-hidden']);
    const after = pending();
    expect(after).toHaveLength(1);
    expect(after[0].at).toBe(now + PASSIVE_HIDDEN_INTERVAL_MS);

    // 下一次也只在完整一个周期之后
    advanceWallClock(PASSIVE_HIDDEN_INTERVAL_MS);
    wakeOnce(after[0]);
    expect(h.ticks).toHaveLength(2);

    h.lifecycle.stop();
  });

  it('唤醒前已经进入 OFF：callback 被叫起来也不 tick、不重新排 timer', () => {
    const h = createHiddenHarness();
    const scheduled = pending();
    expect(scheduled).toHaveLength(1);

    advanceWallClock(PASSIVE_HIDDEN_INTERVAL_MS * 20);
    window.dispatchEvent(new Event('pagehide'));
    expect(h.lifecycle.getMode()).toBe('off');

    // 浏览器可能已经把这个 callback 派发出去了，守卫必须在 callback 里面
    wakeOnce(scheduled[0]);

    expect(h.ticks).toHaveLength(0);
    expect(pending()).toHaveLength(0);

    h.lifecycle.stop();
  });
});
