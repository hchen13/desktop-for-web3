export interface BtcRealizedPriceSnapshot {
  realizedPrice: number;
  change24hPct: number | null;
  latestDate: string;
  previousDate: string | null;
  fetchedAt: number;
  source: 'BGeometrics';
  stale: boolean;
}

interface RealizedPricePoint {
  date: string;
  unixTs: number;
  realizedPrice: number;
}

interface CachePayload {
  version: 'v1';
  snapshot: BtcRealizedPriceSnapshot;
}

const API_URL = 'https://api.bitcoin-data.com/v1/realized-price';
const CACHE_KEY = 'btc_realized_price_cache_v1';
const CACHE_TTL_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

let memoryCache: CachePayload | null = null;

const toNumber = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatUtcDate = (date: Date): string => date.toISOString().slice(0, 10);

const getDateRange = () => {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * DAY_MS);
  return {
    startday: formatUtcDate(start),
    endday: formatUtcDate(end),
  };
};

const readCache = (): CachePayload | null => {
  if (memoryCache) return memoryCache;
  if (typeof localStorage === 'undefined') return null;

  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw) as CachePayload;
    if (payload.version !== 'v1') return null;
    memoryCache = payload;
    return payload;
  } catch {
    return null;
  }
};

const writeCache = (snapshot: BtcRealizedPriceSnapshot) => {
  const payload: CachePayload = {
    version: 'v1',
    snapshot,
  };
  memoryCache = payload;

  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    return;
  }
};

const isFresh = (payload: CachePayload): boolean =>
  Date.now() - payload.snapshot.fetchedAt < CACHE_TTL_MS;

const getPayloadRows = (payload: unknown): unknown[] => {
  if (Array.isArray(payload)) return payload;
  if (
    payload &&
    typeof payload === 'object' &&
    Array.isArray((payload as { data?: unknown }).data)
  ) {
    return (payload as { data: unknown[] }).data;
  }
  return [];
};

const normalizePoint = (row: unknown): RealizedPricePoint | null => {
  if (!row || typeof row !== 'object') return null;

  const raw = row as Record<string, unknown>;
  const date = typeof raw.d === 'string' ? raw.d : typeof raw.date === 'string' ? raw.date : null;
  const realizedPrice = toNumber(raw.realizedPrice ?? raw.realized_price ?? raw.value);
  const unixTs = toNumber(raw.unixTs ?? raw.timestamp);

  if (!date || realizedPrice === null) return null;

  return {
    date,
    realizedPrice,
    unixTs: unixTs ?? Date.parse(`${date}T00:00:00Z`) / 1000,
  };
};

export const parseBtcRealizedPricePayload = (
  payload: unknown,
  fetchedAt = Date.now(),
): BtcRealizedPriceSnapshot => {
  const points = getPayloadRows(payload)
    .map(normalizePoint)
    .filter((point): point is RealizedPricePoint => point !== null)
    .sort((a, b) => a.unixTs - b.unixTs);

  const latest = points[points.length - 1];
  if (!latest) {
    throw new Error('No realized price data');
  }

  const previous = points.length > 1 ? points[points.length - 2] : null;
  const change24hPct = previous
    ? ((latest.realizedPrice - previous.realizedPrice) / previous.realizedPrice) * 100
    : null;

  return {
    realizedPrice: latest.realizedPrice,
    change24hPct,
    latestDate: latest.date,
    previousDate: previous?.date ?? null,
    fetchedAt,
    source: 'BGeometrics',
    stale: false,
  };
};

export const fetchBtcRealizedPrice = async (force = false): Promise<BtcRealizedPriceSnapshot> => {
  const cached = readCache();
  if (!force && cached && isFresh(cached)) {
    return { ...cached.snapshot, stale: false };
  }

  const { startday, endday } = getDateRange();
  const url = `${API_URL}?startday=${encodeURIComponent(startday)}&endday=${encodeURIComponent(endday)}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`BGeometrics API error: ${response.status}`);
    }

    const data = await response.json();
    const snapshot = parseBtcRealizedPricePayload(data);
    writeCache(snapshot);
    return snapshot;
  } catch (error) {
    if (cached) {
      return { ...cached.snapshot, stale: true };
    }
    throw error;
  }
};

export const __resetBtcRealizedPriceCacheForTest = () => {
  memoryCache = null;
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(CACHE_KEY);
  }
};
