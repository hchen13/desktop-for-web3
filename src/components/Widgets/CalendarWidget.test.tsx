import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { CalendarWidget } from './CalendarWidget';
import { getEventsForAdjacentMonths } from '../../services/coinmarketcalService';

vi.mock('../../services/coinmarketcalService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/coinmarketcalService')>();
  return { ...actual, getEventsForAdjacentMonths: vi.fn(async () => ({})) };
});

const fetchEventsMock = vi.mocked(getEventsForAdjacentMonths);

afterEach(() => {
  cleanup();
  fetchEventsMock.mockReset();
  fetchEventsMock.mockImplementation(async () => ({}));
});

/** 造一个落在指定月份 15 号的事件，保证它出现在该月的日期网格里 */
function eventsOn(year: number, month: number, count: number) {
  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-15`;
  return {
    [dateStr]: Array.from({ length: count }, (_, i) => ({ id: `e${i}`, date: dateStr })),
  } as never;
}

function dayCounts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.calendar-day__count')).map(
    (el) => el.textContent ?? '',
  );
}

describe('CalendarWidget 初始化', () => {
  it('挂载时只拉取一次事件数据', () => {
    render(() => <CalendarWidget />);
    expect(fetchEventsMock).toHaveBeenCalledTimes(1);
  });
});

describe('CalendarWidget 翻月竞态', () => {
  it('迟到的旧月响应不会覆盖已渲染的新月数据', async () => {
    const deferred: Array<(value: never) => void> = [];
    fetchEventsMock.mockImplementation(
      () => new Promise((resolve) => deferred.push(resolve as never)) as never,
    );

    const { container } = render(() => <CalendarWidget />);
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const next = container.querySelector('[aria-label="下一月"]') as HTMLElement;
    expect(next).toBeTruthy();
    next.click();
    await Promise.resolve();
    expect(deferred).toHaveLength(2);

    // 新月的响应先到
    deferred[1](eventsOn(nextMonth.getFullYear(), nextMonth.getMonth(), 3));
    await Promise.resolve();
    await Promise.resolve();
    expect(dayCounts(container)).toContain('3');

    // 旧月的响应后到，必须被丢弃
    deferred[0](eventsOn(now.getFullYear(), now.getMonth(), 7));
    await Promise.resolve();
    await Promise.resolve();

    expect(dayCounts(container)).toContain('3');
    expect(dayCounts(container)).not.toContain('7');
  });

  it('手动刷新期间翻月时，迟到的刷新响应不会覆盖新月数据', async () => {
    const deferred: Array<(value: never) => void> = [];
    fetchEventsMock.mockImplementation(
      () => new Promise((resolve) => deferred.push(resolve as never)) as never,
    );

    const { container } = render(() => (
      <div class="grid-element" data-element-id="calendar-test">
        <CalendarWidget />
      </div>
    ));
    await Promise.resolve();
    const root = container.querySelector('.calendar-widget') as HTMLElement;
    root.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));

    const refreshButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent === '刷新事件数据',
    );
    expect(refreshButton).toBeTruthy();
    refreshButton!.click();
    await Promise.resolve();
    expect(deferred).toHaveLength(2);

    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    (container.querySelector('[aria-label="下一月"]') as HTMLElement).click();
    await Promise.resolve();
    expect(deferred).toHaveLength(3);

    deferred[2](eventsOn(nextMonth.getFullYear(), nextMonth.getMonth(), 3));
    await Promise.resolve();
    await Promise.resolve();
    expect(dayCounts(container)).toContain('3');

    deferred[1](eventsOn(now.getFullYear(), now.getMonth(), 7));
    await Promise.resolve();
    await Promise.resolve();
    expect(dayCounts(container)).toContain('3');
    expect(dayCounts(container)).not.toContain('7');
  });
});
