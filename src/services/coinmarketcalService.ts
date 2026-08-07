/**
 * 日历事件聚合服务。
 *
 * 事件源：
 * - CoinMarketCal V2：加密货币事件（由 Worker 代理）
 * - Wallstreetcn：最高重要性（3 星）的宏观事件（由 Worker 代理）
 *
 * 两个来源彼此独立。一个来源失败时，仍然返回另一个来源的数据；只有
 * 两个来源都失败时才认为本次请求失败，并且不写入长期缓存。
 */

import type { Web3Event, EventsByDate, eventType } from '../components/Widgets/calendarTypes';

const WORKER_API_BASE = 'https://desktop-for-web3-api-proxy.gradients-tech.workers.dev';
const CACHE_KEY = 'calendar_events_cache';
const CACHE_VERSION = 'v2';
const CACHE_TTL = 24 * 60 * 60 * 1000;

interface CoinMarketCalEvent {
  id: string | number;
  title: string | Record<string, string>;
  description?: string | Record<string, string> | null;
  date?: string;
  date_event?: string;
  displayedDate?: string;
  categories?: Array<string | { name: string }>;
  coins?: Array<{ symbol?: string; name?: string; slug?: string }>;
  sourceUrl?: string | null;
  source?: string;
  impact?: string | number | null;
  impactSummary?: string | null;
}

interface CoinMarketCalResponse {
  success: boolean;
  data?: CoinMarketCalEvent[];
  metadata?: { total?: number; total_count?: number };
  error?: { code: string; message: string };
}

interface WallstreetcnMacroEvent {
  id: number | string;
  public_date: number;
  country?: string;
  title: string;
  event?: string;
  importance: number;
  actual?: string;
  forecast?: string;
  previous?: string;
  revised?: string;
  unit?: string;
  period?: string;
  uri?: string;
}

interface WallstreetcnResponse {
  success: boolean;
  data?: WallstreetcnMacroEvent[];
  metadata?: { total?: number };
  error?: { code: string; message: string };
}

interface CachedEventsData {
  version: string;
  timestamp: number;
  year: number;
  month: number;
  eventsByDate: EventsByDate;
  events: Web3Event[];
}

interface MonthResult {
  events: Web3Event[];
  successfulSources: number;
}

const CATEGORY_TO_EVENT_TYPE: Record<string, eventType> = {
  Tokenomics: 'unlock',
  'Airdrop/Snapshot': 'airdrop',
  Release: 'unlock',
  Conference: 'conference',
  Meetup: 'conference',
  AMA: 'conference',
  Exchange: 'airdrop',
  Upgrade: 'upgrade',
  'Team Update': 'upgrade',
  Partnership: 'upgrade',
  Other: 'upgrade',
};

function mapCategoryToEventType(categoryName: string): eventType {
  return CATEGORY_TO_EVENT_TYPE[categoryName] || 'upgrade';
}

function firstLocalizedValue(value: string | Record<string, string> | null | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.en || Object.values(value)[0] || '';
}

function formatIsoDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function monthDateRange(year: number, month: number): { start: string; end: string } {
  return {
    start: formatIsoDate(new Date(Date.UTC(year, month, 1))),
    end: formatIsoDate(new Date(Date.UTC(year, month + 1, 0))),
  };
}

function getTimeFromIsoDate(value: string): string | undefined {
  const match = value.match(/T(\d{2}):(\d{2})/);
  if (!match || (match[1] === '00' && match[2] === '00')) return undefined;
  return `${match[1]}:${match[2]} UTC`;
}

function convertCoinMarketCalEvent(event: CoinMarketCalEvent): Web3Event {
  const category = event.categories?.[0];
  const categoryName = typeof category === 'string' ? category : category?.name || 'Other';
  const symbols = (event.coins || [])
    .map((coin) => coin.symbol || coin.name || coin.slug)
    .filter(Boolean)
    .join(', ');
  const title = firstLocalizedValue(event.title) || 'Crypto event';
  const description = firstLocalizedValue(event.description) || event.impactSummary || undefined;

  const eventDate = event.date || event.date_event || '';
  return {
    id: `cmc-${event.id}`,
    date: eventDate.slice(0, 10),
    time: getTimeFromIsoDate(eventDate),
    title: symbols ? `${title} (${symbols})` : title,
    type: mapCategoryToEventType(categoryName),
    description,
    url: event.sourceUrl || event.source || undefined,
  };
}

function convertWallstreetcnEvent(event: WallstreetcnMacroEvent): Web3Event | null {
  const timestamp = Number(event.public_date);
  if (!Number.isFinite(timestamp) || !event.title) return null;
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return null;

  const observations = [
    event.actual ? `实际 ${event.actual}` : '',
    event.forecast ? `预期 ${event.forecast}` : '',
    event.previous ? `前值 ${event.previous}` : '',
    event.revised ? `修正 ${event.revised}` : '',
  ].filter(Boolean);
  const description =
    [
      event.country ? `国家/地区：${event.country}` : '',
      event.event || '',
      event.period ? `周期：${event.period}` : '',
      event.unit ? `单位：${event.unit}` : '',
      observations.join(' · '),
    ]
      .filter(Boolean)
      .join(' | ') || undefined;

  return {
    id: `wscn-${event.id}`,
    date: formatIsoDate(date),
    time:
      date.getUTCHours() || date.getUTCMinutes()
        ? `${date.getUTCHours().toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')} UTC`
        : undefined,
    title: event.country ? `${event.country} · ${event.title}` : event.title,
    type: 'macro',
    description,
    url: event.uri?.startsWith('http') ? event.uri : 'https://wallstreetcn.com/calendar',
  };
}

function getCache(): CachedEventsData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data: CachedEventsData = JSON.parse(raw);
    if (data.version !== CACHE_VERSION) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return data;
  } catch (error) {
    console.error('[Calendar] Cache read error:', error);
    return null;
  }
}

function setCache(
  eventsByDate: EventsByDate,
  events: Web3Event[],
  year: number,
  month: number,
): void {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        version: CACHE_VERSION,
        timestamp: Date.now(),
        year,
        month,
        eventsByDate,
        events,
      } satisfies CachedEventsData),
    );
  } catch (error) {
    console.error('[Calendar] Cache write error:', error);
  }
}

function isCacheValid(cache: CachedEventsData): boolean {
  return Date.now() - cache.timestamp < CACHE_TTL;
}

export function clearCache(): void {
  localStorage.removeItem(CACHE_KEY);
}

export function getCacheStatus(): { hasCache: boolean; isExpired: boolean; age: number } | null {
  const cache = getCache();
  if (!cache) return { hasCache: false, isExpired: false, age: 0 };
  const age = Date.now() - cache.timestamp;
  return { hasCache: true, isExpired: age >= CACHE_TTL, age };
}

async function fetchCoinMarketCalEvents(params: {
  dateRangeStart?: string;
  dateRangeEnd?: string;
  max?: number;
  coins?: string;
  categories?: string;
  sortBy?: string;
}): Promise<{ events: Web3Event[]; totalCount: number }> {
  const searchParams = new URLSearchParams();
  if (params.dateRangeStart) searchParams.set('dateRangeStart', params.dateRangeStart);
  if (params.dateRangeEnd) searchParams.set('dateRangeEnd', params.dateRangeEnd);
  if (params.max) searchParams.set('max', params.max.toString());
  if (params.coins) searchParams.set('coins', params.coins);
  if (params.categories) searchParams.set('categories', params.categories);
  if (params.sortBy) searchParams.set('sortBy', params.sortBy);

  const response = await fetch(`${WORKER_API_BASE}/api/coinmarketcal/events?${searchParams}`);
  const data: CoinMarketCalResponse = await response.json();
  if (!response.ok || !data.success || !Array.isArray(data.data)) {
    throw new Error(data.error?.message || `CoinMarketCal request failed (${response.status})`);
  }
  return {
    events: data.data.map(convertCoinMarketCalEvent),
    totalCount: data.metadata?.total ?? data.metadata?.total_count ?? data.data.length,
  };
}

/** 获取 Crypto 事件；保留旧导出名供其它调用方使用。 */
export async function getCoinMarketCalEvents(params: {
  dateRangeStart?: string;
  dateRangeEnd?: string;
  max?: number;
  coins?: string;
  categories?: string;
  sortBy?: string;
}): Promise<{ events: Web3Event[]; totalCount: number }> {
  try {
    return await fetchCoinMarketCalEvents(params);
  } catch (error) {
    console.error('[CoinMarketCal] Fetch error:', error);
    return { events: [], totalCount: 0 };
  }
}

async function fetchWallstreetcnEvents(start: string, end: string): Promise<Web3Event[]> {
  const searchParams = new URLSearchParams({ start, end });
  const response = await fetch(`${WORKER_API_BASE}/api/wallstreetcn/calendar?${searchParams}`);
  const data: WallstreetcnResponse = await response.json();
  if (!response.ok || !data.success || !Array.isArray(data.data)) {
    throw new Error(data.error?.message || `Wallstreetcn request failed (${response.status})`);
  }
  return data.data
    .filter((event) => event.importance === 3)
    .map(convertWallstreetcnEvent)
    .filter((event): event is Web3Event => event !== null);
}

export async function getWallstreetcnEvents(params: {
  dateRangeStart: string;
  dateRangeEnd: string;
}): Promise<Web3Event[]> {
  try {
    return await fetchWallstreetcnEvents(params.dateRangeStart, params.dateRangeEnd);
  } catch (error) {
    console.error('[Wallstreetcn] Fetch error:', error);
    return [];
  }
}

async function getEventsForMonthWithStatus(year: number, month: number): Promise<MonthResult> {
  const { start, end } = monthDateRange(year, month);
  const [cryptoResult, macroResult] = await Promise.allSettled([
    fetchCoinMarketCalEvents({ dateRangeStart: start, dateRangeEnd: end, max: 100 }),
    fetchWallstreetcnEvents(start, end),
  ]);
  const events: Web3Event[] = [];
  let successfulSources = 0;

  if (cryptoResult.status === 'fulfilled') {
    successfulSources += 1;
    events.push(...cryptoResult.value.events);
  } else {
    console.error('[CoinMarketCal] Month fetch failed:', cryptoResult.reason);
  }
  if (macroResult.status === 'fulfilled') {
    successfulSources += 1;
    events.push(...macroResult.value);
  } else {
    console.error('[Wallstreetcn] Month fetch failed:', macroResult.reason);
  }

  return { events, successfulSources };
}

export async function getEventsForMonth(year: number, month: number): Promise<Web3Event[]> {
  return (await getEventsForMonthWithStatus(year, month)).events;
}

export async function getTodayEvents(): Promise<Web3Event[]> {
  const today = formatIsoDate(new Date());
  const result = await getEventsForMonthWithStatus(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
  );
  return result.events.filter((event) => event.date === today);
}

export function groupEventsByDate(events: Web3Event[]): EventsByDate {
  return events.reduce<EventsByDate>((grouped, event) => {
    (grouped[event.date] ||= []).push(event);
    return grouped;
  }, {});
}

export async function getEventsForAdjacentMonths(
  year: number,
  month: number,
): Promise<EventsByDate> {
  const cache = getCache();
  if (cache && isCacheValid(cache) && cache.year === year && cache.month === month) {
    console.debug('[Calendar] Using cached data');
    return cache.eventsByDate;
  }

  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const nextMonth = month === 11 ? 0 : month + 1;
  const nextYear = month === 11 ? year + 1 : year;
  const results = await Promise.all([
    getEventsForMonthWithStatus(year, month),
    getEventsForMonthWithStatus(prevYear, prevMonth),
    getEventsForMonthWithStatus(nextYear, nextMonth),
  ]);
  const allEvents = results.flatMap((result) => result.events);
  const eventsByDate = groupEventsByDate(allEvents);

  // 只要至少一个来源成功，就缓存聚合结果；双源同时失败时必须允许下次重试。
  if (results.some((result) => result.successfulSources > 0)) {
    setCache(eventsByDate, allEvents, year, month);
  }
  return eventsByDate;
}
