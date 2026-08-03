/**
 * Pyth Hermes 实时层
 *
 * - REST `latest` 端点：批量拉取最新价，作为初始化 + REST 兜底
 * - SSE stream（生产环境使用）：推送实时更新
 *
 * 测试只覆盖 normalize / latest。SSE 由 PriceService 集成时使用。
 */
import type { AssetMeta } from '../types';
import type { LegacyPriceSnapshot as PriceSnapshot } from '../legacyTypes';
import { getPythBenchmarkSymbol } from '../assets';

const HERMES_BASE = 'https://hermes.pyth.network';
const BENCHMARKS_BASE = 'https://benchmarks.pyth.network';

export interface PythRawPrice {
  price: string | number; // integer
  conf?: string | number;
  expo: number; // typically negative (e.g. -8)
  publish_time: number;
}

export interface PythRawUpdate {
  id: string; // feed id (no 0x prefix in some envs)
  price: PythRawPrice;
  ema_price?: PythRawPrice;
}

export interface PythRawResponse {
  parsed?: PythRawUpdate[];
}

/** 把 Pyth 价格反序列化为 number；price * 10^expo */
export function pythToNumber(p: PythRawPrice): number {
  const base = typeof p.price === 'number' ? p.price : Number(p.price);
  if (!Number.isFinite(base)) return NaN;
  return base * Math.pow(10, p.expo);
}

/** 给定 feedId→symbol 映射，把 Pyth update normalize 成 snapshot */
export function normalizePythUpdate(
  update: PythRawUpdate,
  feedToSymbol: Map<string, string>,
): PriceSnapshot | null {
  const id = update.id?.startsWith('0x')
    ? update.id.toLowerCase()
    : `0x${(update.id || '').toLowerCase()}`;
  const symbol = feedToSymbol.get(id);
  if (!symbol) return null;
  const price = pythToNumber(update.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    symbol,
    price,
    change24h: null, // Pyth 不直接给 24h%
    volume24h: null,
    lastUpdate: (update.price.publish_time || 0) * 1000 || Date.now(),
    source: 'pyth',
  };
}

function buildFeedToSymbol(assets: AssetMeta[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of assets) {
    if (a.pythFeedId) map.set(a.pythFeedId.toLowerCase(), a.symbol);
  }
  return map;
}

/** REST 拉取最新价（批量） */
export async function fetchPythLatest(assets: AssetMeta[]): Promise<Map<string, PriceSnapshot>> {
  const out = new Map<string, PriceSnapshot>();
  const withFeed = assets.filter((a) => !!a.pythFeedId);
  if (withFeed.length === 0) return out;
  const feedToSymbol = buildFeedToSymbol(withFeed);

  // Hermes 限制单次 query 长度，分块
  const CHUNK = 30;
  for (let i = 0; i < withFeed.length; i += CHUNK) {
    const slice = withFeed.slice(i, i + CHUNK);
    const params = slice.map((a) => `ids[]=${a.pythFeedId}`).join('&');
    const url = `${HERMES_BASE}/v2/updates/price/latest?${params}`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const json = (await resp.json()) as PythRawResponse;
      const parsed = Array.isArray(json.parsed) ? json.parsed : [];
      for (const upd of parsed) {
        const snap = normalizePythUpdate(upd, feedToSymbol);
        if (snap) out.set(snap.symbol, snap);
      }
    } catch {
      // ignore chunk failure
    }
  }
  return out;
}

/**
 * 用 Pyth benchmarks（TradingView UDF 协议）拉历史日线，返回 prevDayClose。
 * 用于给 stocks/ETFs（CEX 不支持）算 24h%——也可作为 crypto 的备用。
 *
 * 注：Pyth 的 D 分辨率以 UTC 日为界；周末/节假日没有新蜡烛，所以最近一根 close 即"昨日 close"。
 */
export async function fetchPythPrevDayClose(assets: AssetMeta[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  // 一次拉一个 symbol（benchmarks 不支持批量）— 但只有 stock/etf 会调，量不大
  const now = Math.floor(Date.now() / 1000);
  const from = now - 86400 * 7; // 7 天窗口够拿到周末跨过的最近 close
  await Promise.all(
    assets.map(async (a) => {
      const benchSym = getPythBenchmarkSymbol(a);
      if (!benchSym) return;
      try {
        const url = `${BENCHMARKS_BASE}/v1/shims/tradingview/history?symbol=${encodeURIComponent(
          benchSym,
        )}&from=${from}&to=${now}&resolution=D`;
        const resp = await fetch(url);
        if (!resp.ok) return;
        const json = (await resp.json()) as { s: string; t?: number[]; c?: number[] };
        if (json.s !== 'ok' || !json.c || json.c.length === 0) return;
        // 倒数第二根日线 = "昨日 close"（最后一根可能是今日尚未收盘的实时聚合）
        // 若只有 1 根，就用那根
        const idx = json.c.length >= 2 ? json.c.length - 2 : 0;
        const prevClose = json.c[idx];
        if (Number.isFinite(prevClose) && prevClose > 0) {
          out.set(a.symbol, prevClose);
        }
      } catch {
        /* swallow per-asset failure */
      }
    }),
  );
  return out;
}

/**
 * 打开一个 SSE 流，订阅一组 feed_id。返回 close 函数。
 * 生产环境使用；测试不直接覆盖（依赖 EventSource 浏览器对象）。
 */
export function openPythStream(
  assets: AssetMeta[],
  onUpdate: (snap: PriceSnapshot) => void,
  onError?: (err: unknown) => void,
): () => void {
  const withFeed = assets.filter((a) => !!a.pythFeedId);
  if (withFeed.length === 0) return () => {};
  if (typeof EventSource === 'undefined') return () => {};

  const feedToSymbol = buildFeedToSymbol(withFeed);
  const params = withFeed.map((a) => `ids[]=${a.pythFeedId}`).join('&');
  const url = `${HERMES_BASE}/v2/updates/price/stream?${params}`;

  const es = new EventSource(url);
  es.onmessage = (ev) => {
    try {
      const json = JSON.parse(ev.data) as PythRawResponse;
      const parsed = Array.isArray(json.parsed) ? json.parsed : [];
      for (const upd of parsed) {
        const snap = normalizePythUpdate(upd, feedToSymbol);
        if (snap) onUpdate(snap);
      }
    } catch (err) {
      onError?.(err);
    }
  };
  es.onerror = (err) => {
    onError?.(err);
  };

  return () => {
    try {
      es.close();
    } catch {
      /* ignore */
    }
  };
}
