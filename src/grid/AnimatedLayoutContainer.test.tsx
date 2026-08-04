/**
 * AnimatedLayoutContainer tests
 * 覆盖 keep-alive 切换动画期间的连续切换（displayLayoutId 与 currentLayoutId 必须最终一致）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { AnimatedLayoutContainer } from './AnimatedLayoutContainer';
import { gridStore, setGridStore, switchLayout } from './store';

const activeLayoutIndex = (container: HTMLElement): number =>
  Array.from(container.querySelectorAll('.layout-keep-alive-wrapper')).findIndex((el) =>
    el.classList.contains('layout-keep-alive-wrapper--active'),
  );

describe('AnimatedLayoutContainer 布局切换', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setGridStore({
      layouts: [
        { id: 'desktop-a', name: 'A', elements: [] },
        { id: 'desktop-b', name: 'B', elements: [] },
        { id: 'desktop-c', name: 'C', elements: [] },
      ],
      currentLayoutId: 'desktop-a',
      dragState: {
        isDragging: false,
        element: null,
        startPosition: null,
        currentPosition: null,
      },
      isInitialized: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('单次切换动画结束后显示目标 layout', () => {
    const { container } = render(() => <AnimatedLayoutContainer />);
    expect(activeLayoutIndex(container)).toBe(0);

    switchLayout('desktop-b');
    vi.advanceTimersByTime(1000);

    expect(activeLayoutIndex(container)).toBe(1);
  });

  it('A→B→C 快速切换时 B 从未 active 过', () => {
    const { container } = render(() => <AnimatedLayoutContainer />);

    // 逐帧记录整个时间序列，而不是只看 1 秒后的终态
    const timeline: number[] = [activeLayoutIndex(container)];
    const step = () => {
      vi.advanceTimersByTime(10);
      timeline.push(activeLayoutIndex(container));
    };

    switchLayout('desktop-b');
    for (let i = 0; i < 10; i += 1) step();
    switchLayout('desktop-c');
    for (let i = 0; i < 60; i += 1) step();

    expect(gridStore.currentLayoutId).toBe('desktop-c');
    expect(timeline[timeline.length - 1]).toBe(2);
    // 索引 1 是 desktop-B —— 它是已经过期的中间目标，任何一帧都不该被激活
    expect(timeline).not.toContain(1);
  });

  it('动画期间的第二次切换不会被丢弃', () => {
    const { container } = render(() => <AnimatedLayoutContainer />);

    switchLayout('desktop-b');
    vi.advanceTimersByTime(100);
    switchLayout('desktop-c');
    vi.advanceTimersByTime(1000);

    expect(gridStore.currentLayoutId).toBe('desktop-c');
    expect(activeLayoutIndex(container)).toBe(2);
  });
});
