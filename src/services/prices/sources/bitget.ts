import type { AssetMeta } from '../types';
import type { LegacyPriceSnapshot as PriceSnapshot, SourceAdapter } from '../legacyTypes';

const BITGET_TICKERS_URL = 'https://api.bitget.com/api/v2/spot/market/tickers';
const BITGET_PING_URL = 'https://api.bitget.com/api/v2/spot/market/tickers?symbol=BTCUSDT';

interface RawBitgetTicker {
  symbol: string; // 'BTCUSDT'
  lastPr: string;
  open?: string;
  high24h?: string;
  low24h?: string;
  change24h?: string; // already decimal (e.g. '0.0123' = +1.23%)
  baseVolume?: string;
  quoteVolume?: string;
  ts?: string;
}

interface RawBitgetResponse {
  code: string;
  msg?: string;
  data: RawBitgetTicker[];
}

export function normalizeBitgetTicker(
  raw: RawBitgetTicker,
  pairToSymbol: Map<string, string>,
): PriceSnapshot | null {
  const symbol = pairToSymbol.get(raw.symbol);
  if (!symbol) return null;
  const price = Number(raw.lastPr);
  if (!Number.isFinite(price) || price <= 0) return null;
  const changeDec = raw.change24h != null ? Number(raw.change24h) : NaN;
  const change24h = Number.isFinite(changeDec) ? changeDec * 100 : null;
  const volQuote = Number(raw.quoteVolume ?? '');
  return {
    symbol,
    price,
    change24h,
    volume24h: Number.isFinite(volQuote) ? volQuote : null,
    lastUpdate: raw.ts ? Number(raw.ts) : Date.now(),
    source: 'bitget',
  };
}

class BitgetAdapter implements SourceAdapter {
  name = 'bitget';

  async probe(): Promise<number> {
    const start = Date.now();
    const resp = await fetch(BITGET_PING_URL);
    if (!resp.ok) throw new Error(`Bitget probe http ${resp.status}`);
    const json = (await resp.json()) as RawBitgetResponse;
    if (json.code !== '00000') throw new Error(`Bitget probe code ${json.code}`);
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
    const resp = await fetch(BITGET_TICKERS_URL);
    if (!resp.ok) throw new Error(`Bitget http ${resp.status}`);
    const json = (await resp.json()) as RawBitgetResponse;
    if (json.code !== '00000') throw new Error(`Bitget code ${json.code}`);
    if (!Array.isArray(json.data)) throw new Error('Bitget malformed data');
    for (const raw of json.data) {
      if (!pairToSymbol.has(raw.symbol)) continue;
      const snap = normalizeBitgetTicker(raw, pairToSymbol);
      if (snap) out.set(snap.symbol, snap);
    }
    return out;
  }
}

export const bitgetAdapter = new BitgetAdapter();
