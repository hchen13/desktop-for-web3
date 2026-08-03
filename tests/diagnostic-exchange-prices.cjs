/**
 * 真实 MV3 扩展上下文的行情链路诊断（取代原来的 Pyth selector 诊断）。
 *
 * 验证：
 *  1. 默认 6 个资产拿到价格，以及各自命中的 venue / productKind
 *  2. 打开搜索弹窗之前没有远程 catalog 请求
 *  3. 打开弹窗只请求 instruments / exchangeInfo，不请求全市场 ticker
 *  4. 搜索输入不产生新请求
 *  5. 选中 AAPL 后立即 targeted ticker + WebSocket，无需刷新页面
 *  6. Network 中不存在周期性全市场 ticker
 *
 * 用法：rm -rf dist && npm run build && node tests/diagnostic-exchange-prices.cjs
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const DIST = path.resolve(__dirname, '..', 'dist');
const PROFILE = path.resolve(__dirname, 'playwright-profile-prices');

const FULL_MARKET_PATTERNS = [
  /\/api\/v5\/market\/tickers\?instType=/,
  /\/api\/v3\/market\/tickers\?category=[^&]*$/,
  /\/api\/v3\/ticker\/24hr$/,
  /\/fapi\/v1\/ticker\/24hr$/,
  /"type":"allMids"/,
  /"type":"metaAndAssetCtxs"/,
];

const CATALOG_PATTERNS = [/public\/instruments/, /market\/instruments/, /exchangeInfo/, /perpDexs/];

function classify(url) {
  if (CATALOG_PATTERNS.some((re) => re.test(url))) return 'catalog';
  if (FULL_MARKET_PATTERNS.some((re) => re.test(url))) return 'full-market';
  return 'targeted';
}

(async () => {
  if (!fs.existsSync(path.join(DIST, 'manifest.json'))) {
    console.error('dist/ 不存在，先跑 rm -rf dist && npm run build');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf8'));
  const hermes = (manifest.host_permissions || []).filter((h) => /hermes|pyth/i.test(h));
  console.log('[manifest] hermes/pyth permissions:', hermes.length === 0 ? 'NONE ✓' : hermes);

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
  console.log('[ext] id:', extId);

  const requests = [];
  const sockets = [];
  const page = await ctx.newPage();
  page.on('request', (req) => {
    const url = req.url();
    if (
      /^https:\/\/(www\.okx\.com|api\.bitget\.com|data-api\.binance\.vision|fapi\.binance\.com|api\.hyperliquid\.xyz)\//.test(
        url,
      )
    ) {
      requests.push({ url, kind: classify(url), at: Date.now() });
    }
  });
  page.on('websocket', (ws) => {
    sockets.push(ws.url());
    console.log('[ws] open', ws.url());
  });

  await page.goto(`chrome-extension://${extId}/src/newtab/index.html`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('[data-element-id="widget-watchlist"]');
  await page.waitForTimeout(12000);

  const beforeDialog = requests.length;
  console.log('\n=== 打开弹窗前 ===');
  console.log('catalog 请求:', requests.filter((r) => r.kind === 'catalog').length, '(期望 0)');
  console.log('全市场请求:', requests.filter((r) => r.kind === 'full-market').length, '(期望 0)');
  console.log('targeted 请求:', requests.filter((r) => r.kind === 'targeted').length);

  const snapshot = await page.evaluate(async () => {
    const r = await new Promise((res) => window.chrome.storage.local.get('prices_cache_v2', res));
    const snaps = r?.prices_cache_v2?.snapshots ?? {};
    return Object.entries(snaps).map(([key, s]) => ({
      key,
      price: s.price,
      sources: s.sources,
      productKind: s.productKind,
      priceKind: s.priceKind,
      coverageTier: s.coverageTier,
      quality: s.quality,
    }));
  });
  console.log('\n=== 默认资产命中情况 ===');
  console.table(snapshot);

  // 打开搜索弹窗（点第一行的名字区域）
  await page.click('[data-element-id="widget-watchlist"] .price-item__main');
  await page.waitForSelector('.watchlist-edit-dialog__input');
  await page.waitForTimeout(8000);
  const dialogRequests = requests.slice(beforeDialog);
  console.log('\n=== 打开弹窗后 ===');
  console.log('catalog 请求:', dialogRequests.filter((r) => r.kind === 'catalog').length);
  console.log('全市场请求:', dialogRequests.filter((r) => r.kind === 'full-market').length, '(期望 0)');

  const beforeTyping = requests.length;
  await page.type('.watchlist-edit-dialog__input', 'AAPL', { delay: 120 });
  await page.waitForTimeout(3000);
  console.log('\n=== 搜索输入后 ===');
  console.log('新增请求:', requests.length - beforeTyping, '(期望 0)');

  const beforeSelect = requests.length;
  await page.keyboard.press('Enter');
  await page.waitForTimeout(6000);
  const selectRequests = requests.slice(beforeSelect);
  console.log('\n=== 选中 AAPL 后 ===');
  console.log('targeted 请求:', selectRequests.filter((r) => r.kind === 'targeted').length);
  console.log(selectRequests.map((r) => r.url).slice(0, 10));

  console.log('\n=== WebSocket 连接 ===');
  console.log(sockets);

  console.log('\n=== 全部全市场请求（应为空）===');
  console.log(requests.filter((r) => r.kind === 'full-market').map((r) => r.url));

  fs.writeFileSync(
    path.join(__dirname, 'screenshots', 'exchange-prices-diagnostic.json'),
    JSON.stringify({ requests, sockets, snapshot }, null, 2),
  );
  await page.screenshot({
    path: path.join(__dirname, 'screenshots', 'exchange-prices-diagnostic.png'),
  });

  await ctx.close();
})();
