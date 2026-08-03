/**
 * Venue 注册表 —— PriceService 只通过这里访问各家交易所
 */

import type { Venue, VenueInstrument, VenueQuote } from '../types';
import type { SocketEndpoint } from '../socket';
import { binanceSpotSocketEndpoint, fetchBinanceQuotes } from './binance';
import { bitgetSocketEndpoint, fetchBitgetQuotes } from './bitget';
import { fetchHyperliquidQuotes, hyperliquidSocketEndpoint } from './hyperliquid';
import { fetchOkxQuotes, okxSocketEndpoint } from './okx';

export const SUPPORTED_VENUES: readonly Venue[] = ['okx', 'bitget', 'binance', 'hyperliquid'];

/**
 * 每个 venue 一条公开行情连接。Binance 只有 Spot 一条——Futures 侧的
 * markPrice / ticker stream 实测不推送，TradFi 永续改由 targeted REST 供给。
 */
export const SOCKET_ENDPOINTS: SocketEndpoint[] = [
  okxSocketEndpoint,
  bitgetSocketEndpoint,
  binanceSpotSocketEndpoint,
  hyperliquidSocketEndpoint,
];

const QUOTE_FETCHERS: Record<Venue, (instruments: VenueInstrument[]) => Promise<VenueQuote[]>> = {
  okx: fetchOkxQuotes,
  bitget: fetchBitgetQuotes,
  binance: fetchBinanceQuotes,
  hyperliquid: fetchHyperliquidQuotes,
};

/** 按 venue 分组做 targeted REST；单个 venue 失败不影响其他 venue */
export async function fetchTargetedQuotes(instruments: VenueInstrument[]): Promise<VenueQuote[]> {
  const byVenue = new Map<Venue, VenueInstrument[]>();
  for (const instrument of instruments) {
    const list = byVenue.get(instrument.venue);
    if (list) list.push(instrument);
    else byVenue.set(instrument.venue, [instrument]);
  }

  const results = await Promise.allSettled(
    Array.from(byVenue.entries()).map(([venue, list]) => QUOTE_FETCHERS[venue](list)),
  );

  const out: VenueQuote[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') out.push(...result.value);
    else console.warn('[prices] venue quote fetch failed', result.reason);
  }
  return out;
}
