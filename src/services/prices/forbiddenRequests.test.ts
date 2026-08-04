/**
 * 运行时代码不得存在全市场价格请求。
 *
 * Hyperliquid 的 allMids / metaAndAssetCtxs 和交易所的无 symbol ticker 一样都是全市场
 * 价格接口，但它们复用同一个 /info URL，只能靠 POST body 区分——URL 层面的门禁看不到，
 * 所以这里直接对源码做静态断言。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fetchTargetedQuotes } from './venues';
import { makeInstrument } from './venues/shared';
import type { VenueInstrument } from './types';

const SRC = path.resolve(__dirname, '..', '..');

/** 全市场价格请求的特征：交易所侧的无 symbol ticker + Hyperliquid 的全量 info 查询 */
const FORBIDDEN_REQUEST_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'Hyperliquid allMids', pattern: /['"]allMids['"]/ },
  { name: 'Hyperliquid metaAndAssetCtxs', pattern: /['"]metaAndAssetCtxs['"]/ },
  { name: 'Hyperliquid spotMetaAndAssetCtxs', pattern: /['"]spotMetaAndAssetCtxs['"]/ },
  { name: 'OKX 全市场 tickers', pattern: /market\/tickers\?instType=/ },
  { name: 'Binance 无 symbol 24hr ticker', pattern: /ticker\/24hr['"`]/ },
  { name: 'Binance 全市场 price', pattern: /ticker\/price['"`]\s*[,)]/ },
];

/**
 * Bitget 的全市场 ticker 和定向 ticker 是同一个路径，只差一个 `symbol=`，
 * 正则很难既覆盖又不误报。这里改成位置断言：源码里每一处 `market/tickers`
 * 后面很短的距离内必须出现 `symbol=`。
 */
const BITGET_TICKER_PATH = '/api/v3/market/tickers';
const BITGET_SYMBOL_WINDOW = 160;

function bitgetTickerOffenders(text: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(BITGET_TICKER_PATH, from);
    if (at < 0) return out;
    const window = text.slice(at, at + BITGET_SYMBOL_WINDOW);
    if (!window.includes('symbol=')) out.push(window.split('\n')[0]);
    from = at + BITGET_TICKER_PATH.length;
  }
}

function targetedInstrument(
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

function runtimeSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  walk(SRC);
  return out;
}

describe('运行时代码不得包含全市场价格请求', () => {
  const files = runtimeSourceFiles();

  it('扫描到了运行时源码', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(FORBIDDEN_REQUEST_PATTERNS)('不存在 $name', ({ pattern }) => {
    const offenders = files.filter((file) => pattern.test(fs.readFileSync(file, 'utf8')));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it('Hyperliquid adapter 只用 catalog 与按 coin 定向的查询', () => {
    const source = fs.readFileSync(path.join(SRC, 'services/prices/venues/hyperliquid.ts'), 'utf8');
    const types = [...source.matchAll(/type:\s*'([A-Za-z0-9]+)'/g)].map((m) => m[1]);
    // perpDexs / meta 是 catalog 元数据；l2Book 与 activeAssetCtx 都按 coin 定向
    expect([...new Set(types)].sort()).toEqual(['activeAssetCtx', 'l2Book', 'meta', 'perpDexs']);
  });

  it('Bitget ticker 路径每一处都带 symbol=', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const line of bitgetTickerOffenders(fs.readFileSync(file, 'utf8'))) {
        offenders.push(`${path.relative(SRC, file)}: ${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('没有 Pyth/Hermes endpoint、EventSource 或 feed id', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      if (/hermes\.pyth\.network|benchmarks\.pyth\.network/.test(text)) offenders.push(file);
      if (/\bnew EventSource\b/.test(text)) offenders.push(file);
      if (/pythFeedId|price_feeds/.test(text)) offenders.push(file);
    }
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});

/**
 * 静态扫描只能看源码字面量。这里再从真实的 fetch 调用侧确认一遍：
 * 走一次覆盖四家 venue 的 targeted 取价，每一个请求都必须带明确的标的参数。
 */
describe('targeted 取价的请求契约', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('四家 venue 的每一个报价请求都带明确标的，没有全市场查询', async () => {
    const seen: Array<{ url: string; body: string }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      seen.push({
        url: String(input),
        body: String((init as RequestInit)?.body ?? ''),
      });
      return new Response('{}', { status: 200 });
    });

    await fetchTargetedQuotes([
      targetedInstrument('bitget', 'RAAPLUSDT', 'tokenized_stock_spot'),
      targetedInstrument('bitget', 'AAPLUSDT', 'equity_perp'),
      targetedInstrument('okx', 'XAAPL-USDT', 'tokenized_stock_spot'),
      targetedInstrument('okx', 'AAPL-USDT-SWAP', 'equity_perp'),
      targetedInstrument('binance', 'AAPLBUSDT', 'tokenized_stock_spot'),
      targetedInstrument('binance', 'AAPLUSDT', 'equity_perp'),
      targetedInstrument('hyperliquid', 'xyz:AAPL', 'hip3_perp'),
    ]);

    expect(seen.length).toBeGreaterThan(0);
    for (const { url, body } of seen) {
      const detail = `${url} ${body}`;
      if (url.includes('bitget.com')) {
        // 两种 category 都必须带 symbol，缺一个就是全市场查询
        expect(/[?&]symbol=[^&\s]+/.test(url), detail).toBe(true);
      } else if (url.includes('okx.com')) {
        expect(/[?&]instId=[^&\s]+/.test(url), detail).toBe(true);
      } else if (url.includes('binance')) {
        expect(/[?&]symbols?=[^&\s]+/.test(url), detail).toBe(true);
      } else if (url.includes('hyperliquid')) {
        expect(/"coin"\s*:\s*"[^"]+"/.test(body), detail).toBe(true);
        expect(/"type"\s*:\s*"(allMids|metaAndAssetCtxs|spotMetaAndAssetCtxs)"/.test(body)).toBe(
          false,
        );
      } else {
        throw new Error(`未预期的行情 host: ${detail}`);
      }
    }
  });
});
