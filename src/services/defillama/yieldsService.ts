/**
 * DefiLlama Yields 服务
 *
 * 数据源：https://yields.llama.fi/pools
 * 用于 StableYieldWidget — 筛选稳定币池 + TVL ≥ $10M，按 APY 倒序
 *
 * 缓存策略：
 * - in-memory cache + chrome.storage.local 持久化
 * - TTL = 5min
 */
import { isChromeStorageAvailable } from './shared';
import type { YieldPool, YieldsState, YieldsSubscriber } from './types';

const YIELDS_API = 'https://yields.llama.fi/pools';

const CACHE_TTL_MS = 5 * 60 * 1000;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const STORAGE_KEY = 'defillama_yields_cache_v1';

/** 视为「稳定币」token 的子串列表（用于 fallback 检测，DefiLlama stablecoin 字段优先） */
const STABLE_SYMBOL_TOKENS = [
  'USDC',
  'USDT',
  'USDE',
  'SUSDS',
  'SUSDE',
  'USDY',
  'DAI',
  'SDAI',
  'PYUSD',
  'FDUSD',
  'TUSD',
  'USDS',
  'USDM',
  'USDP',
  'GUSD',
  'CRVUSD',
  'GHO',
  'LUSD',
  'FRAX',
  'PUSD',
  'USR',
  'USDA',
  'USDF',
  'USD0',
  'USDX',
  'USD1',
  'RLUSD',
  'BUIDL',
  'USYC',
  'OUSG',
  'BENJI',
  'USDTB',
];

/** 非稳定币 token 黑名单（出现即视为含波动性资产，排除该池） */
const VOLATILE_TOKENS = [
  'WETH',
  'ETH',
  'WBTC',
  'BTC',
  'SOL',
  'WSOL',
  'AVAX',
  'BNB',
  'WBNB',
  'MATIC',
  'OP',
  'ARB',
  'LINK',
  'UNI',
  'AAVE',
  'MKR',
  'CRV',
  'CVX',
  'PENDLE',
  'STETH',
  'WSTETH',
  'CBETH',
  'RETH',
  'WEETH',
  'EZETH',
  'SWETH',
  'TIA',
  'INJ',
  'SUI',
  'APT',
  'NEAR',
  'FTM',
  'ATOM',
  'DOT',
  'HYPE',
  'LIGHTER',
  'TRUMP',
  'PEPE',
  'SHIB',
  'DOGE',
];

/** TVL 下限：避免假高 APY 池子 */
const TVL_FLOOR_USD = 10_000_000;

/** APY 上限：> 100% 的池子通常是短期 airdrop 农场或 ponzi，过滤 */
const APY_CEILING_PCT = 100;

interface PersistedCache {
  version: 'v1';
  timestamp: number;
  pools: YieldPool[];
}

interface RawYieldPool {
  pool?: string;
  project?: string;
  symbol?: string;
  chain?: string;
  apy?: number | null;
  apyBase?: number | null;
  apyReward?: number | null;
  tvlUsd?: number;
  ilRisk?: string;
  exposure?: string;
  stablecoin?: boolean;
}

interface RawYieldsResponse {
  data?: RawYieldPool[];
  status?: string;
}

/**
 * symbol 切分成 tokens（'USDC-USDT' / 'USDC_USDT' / 'USDC/USDT' 都拆开）
 */
function splitSymbolTokens(symbol: string): string[] {
  return symbol
    .toUpperCase()
    .split(/[-_/+,. ]+/)
    .filter(Boolean);
}

/**
 * 判断池子是否为「真·稳定币池」
 *
 * 规则：
 *   1. DefiLlama 自身 `stablecoin: true` 字段（最权威）
 *   2. ilRisk: 'no'（无 IL 风险，意味着 single-asset 或 stable-stable）
 *   3. 否则按 symbol 切 token：所有 token 都在稳定币列表内 + 无任何波动性 token
 *
 * 排除 stable-volatile LP（如 USDC-WETH、SOL-USDC 等）—— APY 主要来自 IL，不算 yield
 */
export function isStablecoinPool(p: RawYieldPool): boolean {
  if (p.stablecoin === true) return true;

  const sym = (p.symbol || '').toUpperCase();
  if (!sym) return false;

  const tokens = splitSymbolTokens(sym);
  if (tokens.length === 0) return false;

  // 任一 token 在波动性列表 → 排除
  for (const t of tokens) {
    if (VOLATILE_TOKENS.includes(t)) return false;
  }

  // ilRisk: 'no' 是强稳定信号
  if (p.ilRisk === 'no') {
    // 但仍要至少一个 token 像稳定币
    return tokens.some((t) => STABLE_SYMBOL_TOKENS.some((s) => t.includes(s)));
  }

  // 兜底：所有 token 都必须包含稳定币子串
  return tokens.every((t) => STABLE_SYMBOL_TOKENS.some((s) => t.includes(s)));
}

/**
 * 规范化 + 筛选稳定币 pool
 * - symbol 是稳定币
 * - TVL ≥ TVL_FLOOR_USD
 * - apy 有效
 *
 * 不在此处做 chain filter / topN —— 那是查询时的运行时操作
 */
export function normalizeYields(raw: RawYieldsResponse): YieldPool[] {
  const list = Array.isArray(raw?.data) ? raw.data : [];
  const out: YieldPool[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const tvl = typeof item.tvlUsd === 'number' && Number.isFinite(item.tvlUsd) ? item.tvlUsd : 0;
    if (tvl < TVL_FLOOR_USD) continue;
    if (!isStablecoinPool(item)) continue;

    const apy = typeof item.apy === 'number' && Number.isFinite(item.apy) ? item.apy : null;
    if (apy == null) continue;
    // 排除 APY 离谱高的池（airdrop / ponzi 农场）
    if (apy > APY_CEILING_PCT) continue;
    // 排除负 APY 的池
    if (apy < 0) continue;

    out.push({
      pool: String(item.pool || ''),
      project: String(item.project || 'unknown'),
      symbol: String(item.symbol || '').toUpperCase(),
      chain: String(item.chain || '').toLowerCase(),
      apy,
      apyBase: typeof item.apyBase === 'number' ? item.apyBase : null,
      apyReward: typeof item.apyReward === 'number' ? item.apyReward : null,
      tvlUsd: tvl,
      ilRisk: item.ilRisk,
      exposure: item.exposure,
      stablecoin: item.stablecoin === true,
    });
  }

  // APY 倒序
  out.sort((a, b) => (b.apy ?? 0) - (a.apy ?? 0));
  return out;
}

/**
 * 在 normalize 之后做 chain 过滤 & topN
 */
export function selectYields(
  pools: YieldPool[],
  options: { chain?: string | 'all'; topN?: number } = {},
): YieldPool[] {
  const chain = (options.chain || 'all').toLowerCase();
  let filtered = pools;
  if (chain && chain !== 'all') {
    filtered = pools.filter((p) => p.chain === chain);
  }
  if (options.topN && options.topN > 0) {
    return filtered.slice(0, options.topN);
  }
  return filtered;
}

class YieldsService {
  private state: YieldsState = {
    pools: [],
    lastUpdated: null,
    status: 'idle',
    error: null,
  };

  private subscribers = new Set<YieldsSubscriber>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<YieldPool[]> | null = null;
  private restoredFromStorage = false;

  getData(): YieldsState {
    return this.state;
  }

  subscribe(callback: YieldsSubscriber): () => void {
    this.subscribers.add(callback);
    try {
      callback(this.state);
    } catch (err) {
      console.error('[YieldsService] subscriber initial notify failed', err);
    }
    this.ensureBackgroundStarted();
    return () => {
      this.subscribers.delete(callback);
    };
  }

  async refresh(force = false): Promise<YieldPool[]> {
    if (!force && this.isFresh()) {
      return this.state.pools;
    }
    return this.fetchAndUpdate();
  }

  __resetForTest(): void {
    this.state = { pools: [], lastUpdated: null, status: 'idle', error: null };
    this.subscribers.clear();
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.inFlight = null;
    this.restoredFromStorage = false;
  }

  private isFresh(): boolean {
    if (!this.state.lastUpdated) return false;
    return Date.now() - this.state.lastUpdated < CACHE_TTL_MS;
  }

  private ensureBackgroundStarted(): void {
    if (!this.restoredFromStorage) {
      this.restoredFromStorage = true;
      void this.restoreFromStorage();
    }
    if (this.refreshTimer == null && typeof setInterval === 'function') {
      this.refreshTimer = setInterval(() => {
        void this.fetchAndUpdate().catch(() => {
          /* swallowed */
        });
      }, REFRESH_INTERVAL_MS);
    }
    if (!this.isFresh() && !this.inFlight) {
      void this.fetchAndUpdate().catch(() => {
        /* swallowed */
      });
    }
  }

  private async restoreFromStorage(): Promise<void> {
    if (!isChromeStorageAvailable()) return;
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const cached = result?.[STORAGE_KEY] as PersistedCache | undefined;
      if (cached?.version === 'v1' && Array.isArray(cached.pools) && cached.pools.length > 0) {
        if (this.state.pools.length === 0) {
          this.updateState({
            pools: cached.pools,
            lastUpdated: cached.timestamp,
            status: 'success',
            error: null,
          });
        }
      }
    } catch (err) {
      console.error('[YieldsService] restore from storage failed', err);
    }
  }

  private async persistToStorage(pools: YieldPool[], timestamp: number): Promise<void> {
    if (!isChromeStorageAvailable()) return;
    try {
      const payload: PersistedCache = { version: 'v1', timestamp, pools };
      await chrome.storage.local.set({ [STORAGE_KEY]: payload });
    } catch (err) {
      console.error('[YieldsService] persist failed', err);
    }
  }

  private async fetchAndUpdate(): Promise<YieldPool[]> {
    if (this.inFlight) return this.inFlight;

    this.updateState({ ...this.state, status: 'loading' });

    const promise = (async () => {
      try {
        const resp = await fetch(YIELDS_API);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = (await resp.json()) as RawYieldsResponse;
        const pools = normalizeYields(json);
        const ts = Date.now();
        this.updateState({
          pools,
          lastUpdated: ts,
          status: 'success',
          error: null,
        });
        void this.persistToStorage(pools, ts);
        return pools;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        // 保留旧数据
        this.updateState({
          ...this.state,
          status: 'error',
          error: errorMsg,
        });
        return this.state.pools;
      } finally {
        this.inFlight = null;
      }
    })();

    this.inFlight = promise;
    return promise;
  }

  private updateState(next: YieldsState): void {
    this.state = next;
    for (const cb of Array.from(this.subscribers)) {
      try {
        cb(next);
      } catch (err) {
        console.error('[YieldsService] subscriber callback failed', err);
      }
    }
  }
}

export const yieldsService = new YieldsService();
