import type { AssetMeta } from '../types';
import type { LegacyPriceSnapshot as PriceSnapshot, SourceAdapter } from '../legacyTypes';

const BYBIT_TICKERS_URL = 'https://api.bybit.com/v5/market/tickers?category=spot';
const BYBIT_PING_URL = 'https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT';

interface RawBybitTicker {
  symbol: string; // 'BTCUSDT'
  lastPrice: string;
  prevPrice24h?: string;
  price24hPcnt?: string; // decimal e.g. '0.0123' = +1.23%
  highPrice24h?: string;
  lowPrice24h?: string;
  volume24h?: string;
  turnover24h?: string;
}

interface RawBybitResponse {
  retCode: number;
  retMsg?: string;
  result?: { list?: RawBybitTicker[] };
  time?: number;
}

export function normalizeBybitTicker(
  raw: RawBybitTicker,
  pairToSymbol: Map<string, string>,
  ts: number,
): PriceSnapshot | null {
  const symbol = pairToSymbol.get(raw.symbol);
  if (!symbol) return null;
  const price = Number(raw.lastPrice);
  if (!Number.isFinite(price) || price <= 0) return null;
  const pct = raw.price24hPcnt != null ? Number(raw.price24hPcnt) : NaN;
  const change24h = Number.isFinite(pct) ? pct * 100 : null;
  const turnover = Number(raw.turnover24h ?? '');
  return {
    symbol,
    price,
    change24h,
    volume24h: Number.isFinite(turnover) ? turnover : null,
    lastUpdate: ts,
    source: 'bybit',
  };
}

class BybitAdapter implements SourceAdapter {
  name = 'bybit';

  async probe(): Promise<number> {
    const start = Date.now();
    const resp = await fetch(BYBIT_PING_URL);
    if (!resp.ok) throw new Error(`Bybit probe http ${resp.status}`);
    const json = (await resp.json()) as RawBybitResponse;
    if (json.retCode !== 0) throw new Error(`Bybit probe code ${json.retCode}`);
    return Date.now() - start;
  }

  async fetchPrices(assets: AssetMeta[]): Promise<Map<string, PriceSnapshot>> {
    const out = new Map<string, PriceSnapshot>();
    const cryptos = assets.filter((a) => a.category === 'crypto' && a.cexPair);
    if (cryptos.length === 0) return out;
    const pairToSymbol = new Map<string, string>();
    for (const a of cryptos) {
      pairToSymbol.set(`${a.cexPair!.base}${a.cexPair!.quote}`, a.symbol);
    }
    const resp = await fetch(BYBIT_TICKERS_URL);
    if (!resp.ok) throw new Error(`Bybit http ${resp.status}`);
    const json = (await resp.json()) as RawBybitResponse;
    if (json.retCode !== 0) throw new Error(`Bybit code ${json.retCode}`);
    const list = json.result?.list;
    if (!Array.isArray(list)) throw new Error('Bybit malformed data');
    const ts = typeof json.time === 'number' ? json.time : Date.now();
    for (const raw of list) {
      if (!pairToSymbol.has(raw.symbol)) continue;
      const snap = normalizeBybitTicker(raw, pairToSymbol, ts);
      if (snap) out.set(snap.symbol, snap);
    }
    return out;
  }
}

export const bybitAdapter = new BybitAdapter();
