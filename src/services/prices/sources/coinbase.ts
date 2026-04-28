import type { AssetMeta, PriceSnapshot, SourceAdapter } from '../types';

const COINBASE_BASE = 'https://api.exchange.coinbase.com';
const COINBASE_PING_URL = `${COINBASE_BASE}/products/BTC-USD/ticker`;

interface RawCoinbaseTicker {
  trade_id?: number;
  price: string;
  size?: string;
  bid?: string;
  ask?: string;
  volume?: string;
  time?: string;
}

interface RawCoinbaseStats {
  open?: string;
  high?: string;
  low?: string;
  last?: string;
  volume?: string;
  volume_30day?: string;
}

export function normalizeCoinbase(
  ticker: RawCoinbaseTicker,
  stats: RawCoinbaseStats | null,
  symbol: string,
): PriceSnapshot | null {
  const price = Number(ticker.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  const open = stats ? Number(stats.open) : NaN;
  const change24h = Number.isFinite(open) && open > 0 ? (price / open - 1) * 100 : null;
  const vol = Number(ticker.volume ?? stats?.volume ?? '');
  return {
    symbol,
    price,
    change24h,
    volume24h: Number.isFinite(vol) ? vol * price : null,
    lastUpdate: ticker.time ? Date.parse(ticker.time) : Date.now(),
    source: 'coinbase',
  };
}

/** Coinbase 没有批量 ticker，单个 fetch；并发数受限 */
const CONCURRENCY = 6;

async function fetchOne(productId: string, symbol: string): Promise<PriceSnapshot | null> {
  try {
    const [tickerResp, statsResp] = await Promise.all([
      fetch(`${COINBASE_BASE}/products/${productId}/ticker`),
      fetch(`${COINBASE_BASE}/products/${productId}/stats`),
    ]);
    if (!tickerResp.ok) return null;
    const ticker = (await tickerResp.json()) as RawCoinbaseTicker;
    const stats = statsResp.ok ? ((await statsResp.json()) as RawCoinbaseStats) : null;
    return normalizeCoinbase(ticker, stats, symbol);
  } catch {
    return null;
  }
}

class CoinbaseAdapter implements SourceAdapter {
  name = 'coinbase';

  async probe(): Promise<number> {
    const start = Date.now();
    const resp = await fetch(COINBASE_PING_URL);
    if (!resp.ok) throw new Error(`Coinbase probe http ${resp.status}`);
    const json = (await resp.json()) as RawCoinbaseTicker;
    if (!json.price) throw new Error('Coinbase probe no price');
    return Date.now() - start;
  }

  async fetchPrices(assets: AssetMeta[]): Promise<Map<string, PriceSnapshot>> {
    const out = new Map<string, PriceSnapshot>();
    const cryptos = assets.filter((a) => a.category === 'crypto' && a.cexPair);
    if (cryptos.length === 0) return out;

    // Coinbase 用 BASE-USD（不支持 USDT 大多数对）；fallback 到 BASE-USDT
    const tasks: Array<{ productId: string; symbol: string }> = cryptos.map((a) => ({
      productId: `${a.cexPair!.base}-USD`,
      symbol: a.symbol,
    }));

    // 简单并发池
    let i = 0;
    async function worker() {
      while (i < tasks.length) {
        const cur = tasks[i++];
        const snap = await fetchOne(cur.productId, cur.symbol);
        if (snap) out.set(snap.symbol, snap);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, () => worker()));
    return out;
  }
}

export const coinbaseAdapter = new CoinbaseAdapter();
