/**
 * coinmarketcalService 缓存行为测试
 *
 * 覆盖：
 *  - 缓存按年月绑定，翻月不会复用其它月份的数据
 *  - 网络失败产生的空结果不写入 24 小时缓存
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getEventsForAdjacentMonths,
  getCoinMarketCalEvents,
  clearCache,
  getCacheStatus,
} from './coinmarketcalService';

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

function rawMacroEvent(id: number, timestamp: number) {
  return {
    id,
    public_date: timestamp,
    country: '美国',
    title: `CPI ${id}`,
    event: '消费者物价指数',
    importance: 3,
    forecast: '3.0%',
    previous: '2.9%',
  };
}

/** 按请求的 dateRangeStart 所在月份返回事件，模拟真实的按月分段接口 */
function mockEventsByMonth(byMonth: Record<string, ReturnType<typeof rawEvent>[]>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes('wallstreetcn')) {
      return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 });
    }
    const start = url.searchParams.get('dateRangeStart') ?? '';
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
  it('解析 CoinMarketCal V2 的 data/meta 结构', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: [
            {
              id: '48291',
              title: 'Ethereum Pectra Upgrade',
              description: 'A major upgrade',
              date: '2026-03-10T12:00:00Z',
              displayedDate: '10 Mar 2026',
              categories: ['Release'],
              coins: [{ slug: 'ethereum', symbol: 'eth', name: 'Ethereum' }],
              sourceUrl: 'https://example.com/pectra',
            },
          ],
          metadata: { total: 1 },
        }),
        { status: 200 },
      ),
    );

    const result = await getCoinMarketCalEvents({
      dateRangeStart: '2026-03-01',
      dateRangeEnd: '2026-03-31',
      max: 100,
    });
    expect(result.totalCount).toBe(1);
    expect(result.events[0]).toEqual(
      expect.objectContaining({
        id: 'cmc-48291',
        date: '2026-03-10',
        time: '12:00 UTC',
        title: 'Ethereum Pectra Upgrade (eth)',
      }),
    );
  });

  it('切换到未覆盖的月份时重新拉取，而不是返回上一次缓存', async () => {
    const fetchSpy = mockEventsByMonth({ '2026-03': [rawEvent(1, '2026-03-10')] });
    await getEventsForAdjacentMonths(2026, 2);
    expect(fetchSpy).toHaveBeenCalledTimes(6);

    mockEventsByMonth({ '2026-06': [rawEvent(2, '2026-06-10')] });
    const june = await getEventsForAdjacentMonths(2026, 5);
    expect(june['2026-06-10']).toHaveLength(1);
  });

  it('合并 Wallstreetcn 的最高重要性宏观事件', async () => {
    const macro = rawMacroEvent(7, Date.parse('2026-03-12T13:30:00Z') / 1000);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.includes('wallstreetcn') && url.searchParams.get('start') === '2026-03-01') {
        return new Response(
          JSON.stringify({ success: true, data: [macro, { ...macro, id: 8, importance: 2 }] }),
          { status: 200 },
        );
      }
      if (url.pathname.includes('wallstreetcn')) {
        return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 });
    });

    const march = await getEventsForAdjacentMonths(2026, 2);
    expect(march['2026-03-12']).toEqual([
      expect.objectContaining({
        id: 'wscn-7',
        type: 'macro',
        title: '美国 · CPI 7',
        time: '13:30 UTC',
      }),
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(6);
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
