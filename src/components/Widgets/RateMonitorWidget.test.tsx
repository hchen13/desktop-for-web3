import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { RateMonitorWidget } from './RateMonitorWidget';
import {
  rateMonitorService,
  type RateDataState,
  type RateStatus,
} from '../../services/rate-monitor';

function stateWith(status: RateStatus, error?: string): RateDataState {
  return {
    status,
    rates: {
      USDT: { USD: null, CNY: null, JPY: null, KRW: null },
      USDC: { USD: null, CNY: null, JPY: null, KRW: null },
    },
    lastSync: 0,
    error,
  };
}

function renderWithStatus(status: RateStatus, error?: string) {
  const initial = stateWith(status, error);
  vi.spyOn(rateMonitorService, 'getState').mockReturnValue(initial);
  vi.spyOn(rateMonitorService, 'subscribe').mockImplementation((cb) => {
    cb(initial);
    return () => {};
  });
  return render(() => <RateMonitorWidget />);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RateMonitorWidget 状态指示器', () => {
  it('live 显示绿色 LIVE', () => {
    const { container } = renderWithStatus('live');
    const content = container.querySelector('.rate-monitor__status-content')!;
    expect(container.querySelector('.rate-monitor__status-text')!.textContent).toBe('LIVE');
    expect(content.classList.contains('rate-monitor__status-content--live')).toBe(true);
  });

  it('degraded 显示 CACHED 且不标绿', () => {
    const { container } = renderWithStatus('degraded', 'CoinGecko 不可用，JPY/CNY 为上一轮缓存值');
    const content = container.querySelector('.rate-monitor__status-content')!;
    expect(container.querySelector('.rate-monitor__status-text')!.textContent).toBe('CACHED');
    expect(content.classList.contains('rate-monitor__status-content--live')).toBe(false);
    expect(content.getAttribute('title')).toBe('CoinGecko 不可用，JPY/CNY 为上一轮缓存值');
  });

  it('error 显示 RETRY 且不标绿', () => {
    const { container } = renderWithStatus('error', 'CoinGecko 与 Upbit 均不可用');
    const content = container.querySelector('.rate-monitor__status-content')!;
    expect(container.querySelector('.rate-monitor__status-text')!.textContent).toBe('RETRY');
    expect(content.classList.contains('rate-monitor__status-content--live')).toBe(false);
  });

  it('idle 与 syncing 都显示 SYNCING', () => {
    const idle = renderWithStatus('idle');
    expect(idle.container.querySelector('.rate-monitor__status-text')!.textContent).toBe('SYNCING');
    cleanup();
    vi.restoreAllMocks();

    const syncing = renderWithStatus('syncing');
    expect(syncing.container.querySelector('.rate-monitor__status-text')!.textContent).toBe(
      'SYNCING',
    );
  });
});
