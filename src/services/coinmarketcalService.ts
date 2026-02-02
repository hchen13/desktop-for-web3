/**
 * CoinMarketCal API 服务
 * 通过 Cloudflare Worker 代理获取加密货币事件数据
 * 支持 localStorage 缓存（24小时保质期）
 */

import type { Web3Event, EventsByDate, eventType } from '../components/Widgets/calendarTypes';
import { EVENT_TYPE_CONFIG } from '../components/Widgets/calendarTypes';

// Worker API 基础 URL
const WORKER_API_BASE = 'https://desktop-for-web3-api-proxy.gradients-tech.workers.dev';

// localStorage 缓存键
const CACHE_KEY = 'coinmarketcal_events_cache';
const CACHE_VERSION = 'v1'; // 版本号，用于清除旧缓存

// 缓存保质期：24小时（毫秒）
const CACHE_TTL = 24 * 60 * 60 * 1000;

// CoinMarketCal API 响应类型
interface CoinMarketCalEvent {
  id: number;
  title: Record<string, string>;
  coins: Array<{
    id: string;
    name: string;
    symbol: string;
  }>;
  date_event: string;
  displayed_date: string;
  can_occur_before: boolean;
  categories: Array<{
    id: number;
    name: string;
  }>;
  proof: string;
  source: string;
  created_date: string;
  description: Record<string, string>;
  percentage: number;
  vote_count: number;
  is_trending: boolean;
  is_popular: boolean;
  influential_score?: number;
  catalyst_score?: number;
  confirmed_by_officials?: boolean;
}

interface CoinMarketCalResponse {
  success: boolean;
  data?: CoinMarketCalEvent[];
  metadata?: {
    max: number;
    page: number;
    page_count: number;
    total_count: number;
  };
  error?: {
    code: string;
    message: string;
  };
  cached?: boolean;
  timestamp?: number;
}

/**
 * localStorage 缓存数据结构
 */
interface CachedEventsData {
  version: string;
  timestamp: number;
  eventsByDate: EventsByDate;
  events: Web3Event[];
}

/**
 * CoinMarketCal 分类到事件类型的映射
 */
const CATEGORY_TO_EVENT_TYPE: Record<string, eventType> = {
  'Tokenomics': 'unlock',      // 代币经济相关
  'Airdrop/Snapshot': 'airdrop', // 空投
  'Release': 'unlock',         // 发布/解锁
  'Conference': 'conference',  // 会议
  'Meetup': 'conference',      // 聚会
  'AMA': 'conference',         // AMA
  'Exchange': 'airdrop',       // 交易所相关（listing等）
  'Upgrade': 'upgrade',        // 升级
  'Team Update': 'upgrade',    // 团队更新
  'Partnership': 'upgrade',    // 合作
  'Other': 'upgrade',          // 其他
};

/**
 * 将 CoinMarketCal 分类映射到事件类型
 */
function mapCategoryToEventType(categoryName: string): eventType {
  return CATEGORY_TO_EVENT_TYPE[categoryName] || 'upgrade';
}

/**
 * 从 CoinMarketCal 事件转换为 Web3Event
 */
function convertToWeb3Event(event: CoinMarketCalEvent): Web3Event {
  // 获取第一个分类
  const category = event.categories[0]?.name || 'Other';
  const type = mapCategoryToEventType(category);

  // 获取关联币种符号
  const coinSymbols = event.coins.map(c => c.symbol).join(', ');

  // 格式化标题（包含币种）
  const title = coinSymbols
    ? `${event.title.en || event.title['en'] || event.title[Object.keys(event.title)[0]]} (${coinSymbols})`
    : event.title.en || event.title['en'] || event.title[Object.keys(event.title)[0]];

  // 解析日期（CoinMarketCal 返回 ISO 格式）
  const dateMatch = event.date_event.match(/(\d{4})-(\d{2})-(\d{2})/);
  const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : event.date_event;

  // 解析时间（从 date_event 中提取时分秒）
  let time: string | undefined;
  if (event.date_event) {
    const timeMatch = event.date_event.match(/T(\d{2}):(\d{2}):/);
    if (timeMatch) {
      const hour = parseInt(timeMatch[1], 10);
      const minute = timeMatch[2];
      // 只有当时间不是 00:00 时才显示（整天事件）
      if (hour !== 0 || minute !== '00') {
        time = `${hour.toString().padStart(2, '0')}:${minute} UTC`;
      }
    }
  }

  // 安全获取 description
  let description: string | undefined;
  if (event.description) {
    description = event.description.en || event.description['en'] || Object.values(event.description)[0];
  }

  return {
    id: `cmc-${event.id}`,
    date,
    time,
    title,
    type,
    description,
    url: event.source,
  };
}

/**
 * 从 localStorage 读取缓存
 */
function getCache(): CachedEventsData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) {
      return null;
    }
    const data: CachedEventsData = JSON.parse(raw);

    // 检查版本号
    if (data.version !== CACHE_VERSION) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }

    return data;
  } catch (error) {
    console.error('[CoinMarketCal] Cache read error:', error);
    return null;
  }
}

/**
 * 写入 localStorage 缓存
 */
function setCache(eventsByDate: EventsByDate, events: Web3Event[]): void {
  try {
    const data: CachedEventsData = {
      version: CACHE_VERSION,
      timestamp: Date.now(),
      eventsByDate,
      events,
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error('[CoinMarketCal] Cache write error:', error);
  }
}

/**
 * 检查缓存是否有效（在保质期内）
 */
function isCacheValid(cache: CachedEventsData): boolean {
  const now = Date.now();
  return (now - cache.timestamp) < CACHE_TTL;
}

/**
 * 清除缓存
 */
export function clearCache(): void {
  localStorage.removeItem(CACHE_KEY);
}

/**
 * 获取缓存状态（用于调试）
 */
export function getCacheStatus(): { hasCache: boolean; isExpired: boolean; age: number } | null {
  const cache = getCache();
  if (!cache) {
    return { hasCache: false, isExpired: false, age: 0 };
  }
  const now = Date.now();
  const age = now - cache.timestamp;
  return {
    hasCache: true,
    isExpired: age >= CACHE_TTL,
    age,
  };
}

/**
 * 获取指定日期范围的事件
 */
export async function getCoinMarketCalEvents(params: {
  dateRangeStart?: string;
  dateRangeEnd?: string;
  max?: number;
  coins?: string;
  categories?: string;
  sortBy?: string;
}): Promise<{ events: Web3Event[]; totalCount: number }> {
  try {
    const searchParams = new URLSearchParams();

    // 设置默认日期范围（未来7天）
    if (!params.dateRangeStart) {
      const today = new Date();
      const startDate = today.toISOString().split('T')[0];
      searchParams.append('dateRangeStart', startDate);
    } else {
      searchParams.append('dateRangeStart', params.dateRangeStart);
    }

    if (params.dateRangeEnd) {
      searchParams.append('dateRangeEnd', params.dateRangeEnd);
    }

    if (params.max) {
      searchParams.append('max', params.max.toString());
    }

    if (params.coins) {
      searchParams.append('coins', params.coins);
    }

    if (params.categories) {
      searchParams.append('categories', params.categories);
    }

    if (params.sortBy) {
      searchParams.append('sortBy', params.sortBy);
    }

    const url = `${WORKER_API_BASE}/api/coinmarketcal/events?${searchParams.toString()}`;

    const response = await fetch(url);
    const data: CoinMarketCalResponse = await response.json();

    if (!data.success || !data.data) {
      console.error('[CoinMarketCal] API error:', data.error);
      return { events: [], totalCount: 0 };
    }

    // 转换为 Web3Event 格式
    const events = data.data.map(convertToWeb3Event);
    const totalCount = data.metadata?.total_count || events.length;

    return { events, totalCount };
  } catch (error) {
    console.error('[CoinMarketCal] Fetch error:', error);
    return { events: [], totalCount: 0 };
  }
}

/**
 * 获取指定月份的事件
 */
export async function getEventsForMonth(year: number, month: number): Promise<Web3Event[]> {
  // 计算月份的开始和结束日期
  const startDate = new Date(year, month, 1);
  const endDate = new Date(year, month + 1, 0);

  const formatDate = (d: Date) => d.toISOString().split('T')[0];

  const { events } = await getCoinMarketCalEvents({
    dateRangeStart: formatDate(startDate),
    dateRangeEnd: formatDate(endDate),
    max: 75, // CoinMarketCal API 最大值
  });

  return events;
}

/**
 * 获取今天的事件
 */
export async function getTodayEvents(): Promise<Web3Event[]> {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];

  const { events } = await getCoinMarketCalEvents({
    dateRangeStart: dateStr,
    dateRangeEnd: dateStr,
    max: 20,
  });

  return events;
}

/**
 * 将事件数组按日期分组
 */
export function groupEventsByDate(events: Web3Event[]): EventsByDate {
  const grouped: EventsByDate = {};

  for (const event of events) {
    if (!grouped[event.date]) {
      grouped[event.date] = [];
    }
    grouped[event.date].push(event);
  }

  return grouped;
}

/**
 * 获取多个相邻月份的事件（包括前后月）
 * 支持 localStorage 缓存（24小时保质期）
 */
export async function getEventsForAdjacentMonths(
  year: number,
  month: number
): Promise<EventsByDate> {
  // 尝试从缓存读取
  const cache = getCache();

  // 如果缓存存在且有效，直接返回
  if (cache && isCacheValid(cache)) {
    console.log('[CoinMarketCal] Using cached data');
    return cache.eventsByDate;
  }

  // 缓存不存在或已过期，重新获取数据
  console.log('[CoinMarketCal] Fetching fresh data');

  // 计算前一个月
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;

  // 计算后一个月
  const nextMonth = month === 11 ? 0 : month + 1;
  const nextYear = month === 11 ? year + 1 : year;

  // 并行获取三个月的数据
  const [currentMonthEvents, prevMonthEvents, nextMonthEvents] = await Promise.all([
    getEventsForMonth(year, month),
    getEventsForMonth(prevYear, prevMonth),
    getEventsForMonth(nextYear, nextMonth),
  ]);

  // 合并所有事件
  const allEvents = [...currentMonthEvents, ...prevMonthEvents, ...nextMonthEvents];
  const eventsByDate = groupEventsByDate(allEvents);

  // 写入缓存
  setCache(eventsByDate, allEvents);

  return eventsByDate;
}
