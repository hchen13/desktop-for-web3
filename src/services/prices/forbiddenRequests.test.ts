/**
 * 行情请求与凭据的确定性门禁。
 *
 * 分两层：
 *  1. 行为契约 —— 直接调用生产 adapter，用 mocked fetch 记录真实请求，再用 URL /
 *     searchParams / POST body 结构化断言。源码字面量扫描做不到这一点：Bitget 的全市场
 *     ticker 和定向 ticker 是同一个 path，只差一个 symbol=，靠「path 后 N 个字符里有没有
 *     symbol=」既会误报（参数拼在很远的地方）也会漏报（symbol= 其实属于隔壁那段代码）。
 *  2. 凭据/Pyth 扫描 —— 范围只限行情运行时代码与行情相关 manifest 配置，且必须放行
 *     PYTH 币种元数据、Pyth Network 资产名和旧缓存迁移 key。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fetchTargetedQuotes } from './venues';
import { makeInstrument } from './venues/shared';
import type { VenueInstrument } from './types';

const REPO = path.resolve(__dirname, '..', '..', '..');
const SRC = path.join(REPO, 'src');
const PRICES_DIR = path.join(SRC, 'services', 'prices');

// ============ 1. 行为契约 ============

interface SeenRequest {
  url: URL;
  method: string;
  body: string;
}

function instrument(
  venue: VenueInstrument['venue'],
  instrumentId: string,
  productKind: VenueInstrument['productKind'],
): VenueInstrument {
  return makeInstrument({
    venue,
    instrumentId,
    symbol: 'AAPL',
    base: 'AAPL',
    quote: 'USDT',
    category: 'stock',
    productKind,
    preferredPriceKind: productKind === 'tokenized_stock_spot' ? 'last' : 'index',
  });
}

/** 覆盖四家 venue 的现货 + 衍生品，确保两类 Bitget category 都被触发 */
const TARGETED_FIXTURE: VenueInstrument[] = [
  instrument('bitget', 'RAAPLUSDT', 'tokenized_stock_spot'),
  instrument('bitget', 'AAPLUSDT', 'equity_perp'),
  instrument('okx', 'XAAPL-USDT', 'tokenized_stock_spot'),
  instrument('okx', 'AAPL-USDT-SWAP', 'equity_perp'),
  instrument('binance', 'AAPLBUSDT', 'tokenized_stock_spot'),
  instrument('binance', 'AAPLUSDT', 'equity_perp'),
  instrument('hyperliquid', 'xyz:AAPL', 'hip3_perp'),
];

async function captureTargetedRequests(): Promise<SeenRequest[]> {
  const seen: SeenRequest[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    seen.push({
      url: new URL(String(input)),
      method: (init as RequestInit)?.method ?? 'GET',
      body: String((init as RequestInit)?.body ?? ''),
    });
    return new Response('{}', { status: 200 });
  });
  await fetchTargetedQuotes(TARGETED_FIXTURE);
  return seen;
}

function nonEmptyParam(url: URL, name: string): string | null {
  const value = url.searchParams.get(name);
  return value && value.length > 0 ? value : null;
}

describe('targeted 取价的请求契约', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Bitget 的 SPOT 与 USDT-FUTURES 都被触发，且每条都带非空 category + symbol', async () => {
    const seen = await captureTargetedRequests();
    const bitget = seen.filter((r) => r.url.host === 'api.bitget.com');
    expect(bitget.length).toBeGreaterThan(0);

    for (const request of bitget) {
      const detail = request.url.href;
      expect(request.url.pathname, detail).toBe('/api/v3/market/tickers');
      expect(nonEmptyParam(request.url, 'category'), detail).not.toBeNull();
      expect(nonEmptyParam(request.url, 'symbol'), detail).not.toBeNull();
    }

    const categories = bitget.map((r) => r.url.searchParams.get('category')).sort();
    expect(categories).toEqual(['SPOT', 'USDT-FUTURES']);
    expect(bitget.map((r) => r.url.searchParams.get('symbol')).sort()).toEqual([
      'AAPLUSDT',
      'RAAPLUSDT',
    ]);
  });

  it('OKX 现货与指数请求都带非空 instId', async () => {
    const seen = await captureTargetedRequests();
    const okx = seen.filter((r) => r.url.host === 'www.okx.com');
    expect(okx.length).toBe(2);
    for (const request of okx) {
      expect(request.url.pathname, request.url.href).toMatch(
        /^\/api\/v5\/market\/(ticker|index-tickers)$/,
      );
      expect(nonEmptyParam(request.url, 'instId'), request.url.href).not.toBeNull();
    }
    expect(okx.map((r) => r.url.searchParams.get('instId')).sort()).toEqual([
      'AAPL-USDT',
      'XAAPL-USDT',
    ]);
  });

  it('Binance 现货 batch 与永续单 symbol 都带非空标的参数', async () => {
    const seen = await captureTargetedRequests();
    const binance = seen.filter((r) => r.url.host.includes('binance'));
    expect(binance.length).toBeGreaterThan(0);
    for (const request of binance) {
      const detail = request.url.href;
      const single = nonEmptyParam(request.url, 'symbol');
      const batch = nonEmptyParam(request.url, 'symbols');
      expect(single || batch, detail).toBeTruthy();
      if (batch) expect(JSON.parse(batch).length, detail).toBeGreaterThan(0);
    }
    // 现货走 batch，永续走单 symbol，两条路径都要被覆盖
    expect(binance.some((r) => r.url.searchParams.has('symbols'))).toBe(true);
    expect(binance.some((r) => r.url.searchParams.has('symbol'))).toBe(true);
  });

  it('Hyperliquid 定向价格请求带非空 coin，且不是任何全市场查询', async () => {
    const seen = await captureTargetedRequests();
    const hyperliquid = seen.filter((r) => r.url.host === 'api.hyperliquid.xyz');
    expect(hyperliquid.length).toBeGreaterThan(0);
    for (const request of hyperliquid) {
      const payload = JSON.parse(request.body) as { type?: string; coin?: string };
      expect(request.method).toBe('POST');
      expect(['allMids', 'metaAndAssetCtxs', 'spotMetaAndAssetCtxs']).not.toContain(payload.type);
      expect(payload.coin, request.body).toBeTruthy();
    }
  });

  it('整轮 targeted 取价只落在四家已知行情 host 上', async () => {
    const seen = await captureTargetedRequests();
    const hosts = [...new Set(seen.map((r) => r.url.host))].sort();
    expect(hosts).toEqual([
      'api.bitget.com',
      'api.hyperliquid.xyz',
      'data-api.binance.vision',
      'fapi.binance.com',
      'www.okx.com',
    ]);
  });
});

// ============ 2. 凭据 / Pyth 门禁 ============

/**
 * 只扫行情运行时代码。允许 PYTH 作为币种、Pyth Network 作为资产名、
 * pyth_catalog_v1 这类旧缓存迁移 key——它们既不是 endpoint 也不是凭据。
 */
const CREDENTIAL_RULES: Array<{ name: string; pattern: RegExp }> = [
  { name: 'Pyth/Hermes endpoint', pattern: /\b(hermes|benchmarks)\.pyth\.network\b/ },
  { name: 'Pyth runtime import', pattern: /from\s+['"][^'"]*(pyth|hermes)[^'"]*['"]/i },
  { name: 'EventSource', pattern: /\bnew\s+EventSource\b/ },
  { name: 'Pyth feed id', pattern: /\bpythFeedId\b/ },
  { name: 'Pyth price_feeds', pattern: /\bprice_feeds\b/ },
  { name: '环境变量凭据', pattern: /(import\.meta\.env|process\.env)\s*[.[]/ },
  {
    name: '硬编码凭据',
    pattern:
      /["'`]?(api[-_]?key|apikey|authorization|bearer|secret|access[-_]?token)["'`]?\s*[:=]\s*["'`][^"'`]{8,}/i,
  },
  {
    name: '要求调用方提供 API Key 的行情客户端',
    pattern: /\b(apiKey|accessToken)\s*[?]?\s*:\s*string/,
  },
];

export function scanForCredentialViolations(text: string): string[] {
  return CREDENTIAL_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.name);
}

function priceRuntimeFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  walk(PRICES_DIR);
  return out;
}

/** 行情相关的 manifest 配置：四家 venue 的 host 与扩展页 CSP */
function priceManifestSurface(): { hosts: string[]; csp: string } {
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8')) as {
    host_permissions?: string[];
    content_security_policy?: { extension_pages?: string };
  };
  const hosts = (manifest.host_permissions ?? []).filter((h) =>
    /okx|bitget|binance|hyperliquid|pyth|hermes/i.test(h),
  );
  return { hosts, csp: manifest.content_security_policy?.extension_pages ?? '' };
}

describe('行情链路不得引入凭据或 Pyth 依赖', () => {
  const files = priceRuntimeFiles();

  it('扫描到了行情运行时源码', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('门禁能识别违规输入', () => {
    const violating = [
      `const url = 'https://hermes.pyth.network/v2/updates';`,
      `import { parse } from 'hermes-client';`,
      `const es = new EventSource(url);`,
      `const id = asset.pythFeedId;`,
      `const qs = 'ids[]=' + price_feeds.join();`,
      `const key = import.meta.env.VITE_MARKET_KEY;`,
      `const headers = { Authorization: 'Bearer sk-live-0123456789abcdef' };`,
      `export interface Options { apiKey: string }`,
    ];
    for (const sample of violating) {
      expect(scanForCredentialViolations(sample), sample).not.toEqual([]);
    }
  });

  it('合法的 PYTH 币种元数据与旧缓存迁移 key 不得误报', () => {
    const legitimate = [
      `{ symbol: 'PYTH', name: 'Pyth Network', cexPair: { base: 'PYTH', quote: 'USDT' } }`,
      `const OBSOLETE_STORAGE_KEYS = ['prices_cache_v1', 'pyth_catalog_v1'];`,
      `const REST_BASE = 'https://www.okx.com';`,
      `export const BITGET_WS_URL = 'wss://ws.bitget.com/v3/ws/public';`,
      `const logo = 'pyth-network.svg';`,
      `fetchJson(url, { headers: { 'Content-Type': 'application/json' } })`,
    ];
    for (const sample of legitimate) {
      expect(scanForCredentialViolations(sample), sample).toEqual([]);
    }
  });

  it('行情运行时代码全部通过', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const violation of scanForCredentialViolations(fs.readFileSync(file, 'utf8'))) {
        offenders.push(`${path.relative(REPO, file)}: ${violation}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('行情相关 manifest host 与 CSP 不含 Pyth/Hermes 或凭据', () => {
    const { hosts, csp } = priceManifestSurface();
    expect(hosts.filter((h) => /pyth|hermes/i.test(h))).toEqual([]);
    expect(hosts.length).toBeGreaterThanOrEqual(4);
    expect(scanForCredentialViolations(hosts.join('\n'))).toEqual([]);
    expect(csp).not.toMatch(/pyth|hermes/i);
    // MV3 的 extension_pages 默认 CSP 本来就没有 connect-src，这里是收紧不是放宽
    expect(csp).toContain("connect-src 'self'");
  });
});
