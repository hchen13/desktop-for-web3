/**
 * coinmarketcalService 缓存行为测试
 *
 * 覆盖：
 *  - 缓存按年月绑定，翻月不会复用其它月份的数据
 *  - 网络失败产生的空结果不写入 24 小时缓存
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getEventsForAdjacentMonths, clearCache, getCacheStatus } from './coinmarketcalService';

function rawEvent(id: number, date: string) {
  return {
    id,
    title: { en: `Event ${id}` },
    coins: [{ id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC' }],
    date_event: `${date}T00:00:00Z`,
    displayed_date: date,
    can_occur_before: false,
    categories: [{ id: 1, name: 'Release' }],
    proof: '',
    source: 'https://example.com',
    created_date: date,
    description: { en: 'desc' },
    percentage: 0,
    vote_count: 0,
    is_trending: false,
    is_popular: false,
  };
}

/** 按请求的 dateRangeStart 所在月份返回事件，模拟真实的按月分段接口 */
function mockEventsByMonth(byMonth: Record<string, ReturnType<typeof rawEvent>[]>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const start = new URL(String(input)).searchParams.get('dateRangeStart') ?? '';
    const data = byMonth[start.slice(0, 7)] ?? [];
    return new Response(JSON.stringify({ success: true, data }), { status: 200 });
  });
}

beforeEach(() => {
  clearCache();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  clearCache();
});

describe('getEventsForAdjacentMonths 缓存', () => {
  it('切换到未覆盖的月份时重新拉取，而不是返回上一次缓存', async () => {
    const fetchSpy = mockEventsByMonth({ '2026-03': [rawEvent(1, '2026-03-10')] });
    await getEventsForAdjacentMonths(2026, 2);
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    mockEventsByMonth({ '2026-06': [rawEvent(2, '2026-06-10')] });
    const june = await getEventsForAdjacentMonths(2026, 5);
    expect(june['2026-06-10']).toHaveLength(1);
  });

  it('同一月份重复请求命中缓存', async () => {
    const fetchSpy = mockEventsByMonth({ '2026-03': [rawEvent(1, '2026-03-10')] });
    await getEventsForAdjacentMonths(2026, 2);
    fetchSpy.mockClear();

    await getEventsForAdjacentMonths(2026, 2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('网络失败产生的空结果不写入缓存', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const empty = await getEventsForAdjacentMonths(2026, 2);
    expect(empty).toEqual({});
    expect(getCacheStatus()?.hasCache).toBe(false);

    mockEventsByMonth({ '2026-03': [rawEvent(1, '2026-03-10')] });
    const retried = await getEventsForAdjacentMonths(2026, 2);
    expect(retried['2026-03-10']).toHaveLength(1);
  });
});
