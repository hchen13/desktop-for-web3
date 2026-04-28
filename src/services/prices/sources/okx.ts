import type { AssetMeta, PriceSnapshot, SourceAdapter } from '../types';

const OKX_TICKERS_URL = 'https://www.okx.com/api/v5/market/tickers?instType=SPOT';
const OKX_PING_URL = 'https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT';

interface RawOkxTicker {
  instId: string; // 'BTC-USDT'
  last: string;
  vol24h?: string;
  volCcy24h?: string;
  sodUtc8?: string; // 24h base price
  open24h?: string;
  ts?: string;
}

interface RawOkxResponse {
  code: string;
  msg?: string;
  data: RawOkxTicker[];
}

/** 把 OKX 一行 ticker normalize 成 PriceSnapshot；找不到 base 资产则返回 null */
export function normalizeOkxTicker(
  raw: RawOkxTicker,
  pairToSymbol: Map<string, string>,
): PriceSnapshot | null {
  const symbol = pairToSymbol.get(raw.instId);
  if (!symbol) return null;
  const price = Number(raw.last);
  if (!Number.isFinite(price) || price <= 0) return null;
  const open = Number(raw.open24h ?? raw.sodUtc8 ?? '');
  let change24h: number | null = null;
  if (Number.isFinite(open) && open > 0) {
    change24h = (price / open - 1) * 100;
  }
  const volQuote = Number(raw.volCcy24h ?? '');
  return {
    symbol,
    price,
    change24h,
    volume24h: Number.isFinite(volQuote) ? volQuote : null,
    lastUpdate: raw.ts ? Number(raw.ts) : Date.now(),
    source: 'okx',
  };
}

class OkxAdapter implements SourceAdapter {
  name = 'okx';

  async probe(): Promise<number> {
    const start = Date.now();
    const resp = await fetch(OKX_PING_URL);
    if (!resp.ok) throw new Error(`OKX probe http ${resp.status}`);
    const json = (await resp.json()) as RawOkxResponse;
    if (json.code !== '0') throw new Error(`OKX probe code ${json.code}`);
    return Date.now() - start;
  }

  async fetchPrices(assets: AssetMeta[]): Promise<Map<string, PriceSnapshot>> {
    const out = new Map<string, PriceSnapshot>();
    const cryptos = assets.filter((a) => a.category === 'crypto' && a.cexPair);
    if (cryptos.length === 0) return out;

    // OKX 用 BASE-QUOTE
    const pairToSymbol = new Map<string, string>();
    for (const a of cryptos) {
      const base = a.cexPair!.base;
      const quote = a.cexPair!.quote;
      pairToSymbol.set(`${base}-${quote}`, a.symbol);
      // USDT 退化处理
      if (a.symbol === 'USDT') pairToSymbol.set('USDT-USDC', a.symbol);
    }

    const resp = await fetch(OKX_TICKERS_URL);
    if (!resp.ok) throw new Error(`OKX http ${resp.status}`);
    const json = (await resp.json()) as RawOkxResponse;
    if (json.code !== '0') throw new Error(`OKX code ${json.code}`);
    if (!Array.isArray(json.data)) throw new Error('OKX malformed data');

    for (const raw of json.data) {
      if (!pairToSymbol.has(raw.instId)) continue;
      const snap = normalizeOkxTicker(raw, pairToSymbol);
      if (snap) out.set(snap.symbol, snap);
    }
    return out;
  }
}

export const okxAdapter = new OkxAdapter();
