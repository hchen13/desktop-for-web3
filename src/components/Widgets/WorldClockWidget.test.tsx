import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { WorldClockWidget } from './WorldClockWidget';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('WorldClockWidget 生命周期', () => {
  it('组件卸载后 1 秒定时器被清除', () => {
    vi.useFakeTimers();

    const { unmount } = render(() => <WorldClockWidget />);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
