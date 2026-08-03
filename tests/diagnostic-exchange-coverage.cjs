/**
 * 用真实 catalog 统计 curated 股票 / ETF 的覆盖情况，并验证两个网络边界场景：
 *  - 单个 venue 失败时其他 venue 继续更新
 *  - active layout 没有 Watchlist 时价格网络活动为零
 *
 * 用法：rm -rf dist && npm run build && node tests/diagnostic-exchange-coverage.cjs
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const DIST = path.resolve(__dirname, '..', 'dist');
const PROFILE = path.resolve(__dirname, 'playwright-profile-coverage');

(async () => {
  if (fs.existsSync(PROFILE)) fs.rmSync(PROFILE, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-position=-3000,-3000',
    ],
    viewport: { width: 1600, height: 1000 },
  });

  const warmup = await ctx.newPage();
  await warmup.goto('chrome://newtab/').catch(() => {});
  const extId = warmup.url().match(/^chrome-extension:\/\/([a-z]{32})\//)?.[1];
  await warmup.close();
  const url = `chrome-extension://${extId}/src/newtab/index.html`;

  const page = await ctx.newPage();
  const requests = [];
  page.on('request', (r) => {
    // 只统计行情 endpoint；favicon 之类带 domain= 参数的请求不算
    if (/^https:\/\/(www\.okx\.com|api\.bitget\.com|data-api\.binance\.vision|fapi\.binance\.com|api\.hyperliquid\.xyz)\//.test(r.url())) {
      requests.push(r.url());
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-element-id="widget-watchlist"]');
  await page.click('[data-element-id="widget-watchlist"] .price-item__main');
  await page.waitForSelector('.watchlist-edit-dialog__input');
  await page.waitForTimeout(18000);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  const coverage = await page.evaluate(async () => {
    const r = await new Promise((res) => window.chrome.storage.local.get('exchange_catalog_v1', res));
    const list = r?.exchange_catalog_v1?.instruments ?? [];
    const byKey = new Map();
    for (const i of list) {
      if (!byKey.has(i.assetKey)) byKey.set(i.assetKey, []);
      byKey.get(i.assetKey).push(i);
    }
    return { total: list.length, keys: [...byKey.entries()].map(([k, v]) => [k, v.map((x) => `${x.venue}:${x.productKind}`)]) };
  });

  const assetsSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'services', 'prices', 'assets.ts'),
    'utf8',
  );
  const curated = [];
  const assetRe = /\{\s*(?:\/\/[^\n]*\n\s*)?symbol: '([^']+)',\s*name: (?:'[^']*'|"[^"]*"),\s*category: '([^']+)'/g;
  let match;
  while ((match = assetRe.exec(assetsSource))) curated.push({ symbol: match[1], category: match[2] });
  const map = new Map(coverage.keys);
  const rows = [];
  for (const a of curated) {
    const key = `${a.category}:${a.symbol}`;
    const insts = map.get(key) ?? [];
    const tier1 = insts.filter((i) => i.endsWith('tokenized_stock_spot') || i.endsWith('crypto_spot'));
    const tier2 = insts.filter((i) => i.endsWith('equity_perp') || i.endsWith('commodity_perp') || i.endsWith('fx_perp'));
    const tier3 = insts.filter((i) => i.endsWith('hip3_perp'));
    rows.push({ key, tier1: tier1.length, tier2: tier2.length, tier3: tier3.length, total: insts.length });
  }
  const summarize = (cat) => {
    const sub = rows.filter((r) => r.key.startsWith(`${cat}:`));
    return {
      category: cat,
      total: sub.length,
      covered: sub.filter((r) => r.total > 0).length,
      tier1: sub.filter((r) => r.tier1 > 0).length,
      tier1Multi: sub.filter((r) => r.tier1 >= 2).length,
      onlyDerivative: sub.filter((r) => r.tier1 === 0 && r.tier2 + r.tier3 > 0).length,
      uncovered: sub.filter((r) => r.total === 0).map((r) => r.key),
    };
  };
  console.log('\n=== curated 覆盖统计（真实 catalog）===');
  console.log('catalog instrument 总数:', coverage.total);
  for (const cat of ['stock', 'etf', 'crypto', 'commodity', 'fx']) {
    console.log(JSON.stringify(summarize(cat)));
  }

  // 单 venue 失败隔离：阻断 OKX 后仍应有其他 venue 报价
  console.log('\n=== 单 venue 失败隔离（阻断 OKX）===');
  await page.route('**://www.okx.com/**', (route) => route.abort());
  await page.route('**://ws.okx.com/**', (route) => route.abort());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-element-id="widget-watchlist"]');
  await page.waitForTimeout(15000);
  const degraded = await page.evaluate(async () => {
    const r = await new Promise((res) => window.chrome.storage.local.get('prices_cache_v2', res));
    const s = r?.prices_cache_v2?.snapshots ?? {};
    return Object.entries(s).map(([k, v]) => ({ key: k, price: v.price, sources: v.sources.join('/'), quality: v.quality }));
  });
  console.table(degraded);
  await page.unroute('**://www.okx.com/**');
  await page.unroute('**://ws.okx.com/**');

  // active layout 无 Watchlist：删掉 watchlist 元素后重载
  console.log('\n=== active layout 无 Watchlist ===');
  await page.evaluate(async () => {
    const r = await new Promise((res) => window.chrome.storage.local.get('gridLayouts', res));
    const layouts = r.gridLayouts;
    for (const l of layouts) l.elements = (l.elements ?? []).filter((e) => e.component !== 'watchlist');
    await new Promise((res) => window.chrome.storage.local.set({ gridLayouts: layouts }, res));
  });
  const sockets = [];
  page.on('websocket', (ws) => sockets.push(ws.url()));
  requests.length = 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(20000);
  console.log('价格相关请求数:', requests.length, '(期望 0)');
  console.log('新建 WebSocket:', sockets.length, '(期望 0)');
  console.log(requests.slice(0, 5));

  fs.writeFileSync(
    path.join(__dirname, 'screenshots', 'exchange-coverage-diagnostic.json'),
    JSON.stringify({ coverage, rows, degraded, requests, sockets }, null, 2),
  );
  await ctx.close();
})();
