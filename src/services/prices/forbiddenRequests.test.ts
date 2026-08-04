/**
 * 运行时代码不得存在全市场价格请求。
 *
 * Hyperliquid 的 allMids / metaAndAssetCtxs 和交易所的无 symbol ticker 一样都是全市场
 * 价格接口，但它们复用同一个 /info URL，只能靠 POST body 区分——URL 层面的门禁看不到，
 * 所以这里直接对源码做静态断言。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

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
