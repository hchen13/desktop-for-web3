/**
 * 真实 MV3 扩展上下文的边界场景诊断。
 *
 * 验证：
 *  1. 旧 SQ 配置迁移成 XYZ 并命中 Bitget RXYZUSDT
 *  2. BRK.B 命中 equity perp 并标记 derivative-reference
 *  3. FBTC / XLF 标记 unavailable 且不使用任何代理价
 *  4. Hyperliquid HIP-3 覆盖
 *  5. 快速切 layout 不产生连接风暴
 *  6. visible + blurred 宽限期内原连接不断；hidden 30 秒后 WS 关闭
 *  7. active layout 无 Watchlist 时价格网络为零
 *
 * 用法：rm -rf dist && npm run build && node tests/diagnostic-exchange-fallbacks.cjs
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const DIST = path.resolve(__dirname, '..', 'dist');
const PROFILE = path.resolve(__dirname, 'playwright-profile-fallbacks');

const TEST_COINS = [
  // 故意用旧格式：没有 assetKey，symbol 还是 SQ
  { symbol: 'SQ', name: 'Block', category: 'stock' },
  { symbol: 'BRK.B', name: 'Berkshire Hathaway B', category: 'stock' },
  { symbol: 'FBTC', name: 'Fidelity Bitcoin', category: 'etf' },
  { symbol: 'XLF', name: 'Financial Select Sector', category: 'etf' },
  { symbol: 'AAPL', name: 'Apple', category: 'stock' },
  { symbol: 'BTC', name: 'Bitcoin', category: 'crypto' },
];

async function readSnapshots(page) {
  return page.evaluate(async () => {
    const r = await new Promise((res) => window.chrome.storage.local.get('prices_cache_v2', res));
    return r?.prices_cache_v2?.snapshots ?? {};
  });
}

(async () => {
  if (!fs.existsSync(path.join(DIST, 'manifest.json'))) {
    console.error('dist/ 不存在，先跑 rm -rf dist && npm run build');
    process.exit(1);
  }
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
  const sockets = [];
  page.on('request', (req) => {
    const u = req.url();
    if (/^https:\/\/(www\.okx\.com|api\.bitget\.com|data-api\.binance\.vision|fapi\.binance\.com|api\.hyperliquid\.xyz)\//.test(u)) {
      requests.push({ url: u, at: Date.now() });
    }
  });
  page.on('websocket', (ws) => {
    const rec = { url: ws.url(), openedAt: Date.now(), closedAt: null };
    sockets.push(rec);
    ws.on('close', () => {
      rec.closedAt = Date.now();
    });
  });

  // 先加载一次让默认布局落盘，再把 watchlist 换成测试资产
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-element-id="widget-watchlist"]');
  await page.waitForTimeout(3000);

  // 打开一次搜索弹窗，让完整 catalog 预热（HIP-3 / equity perp 都靠它）
  await page.click('[data-element-id="widget-watchlist"] .price-item__main');
  await page.waitForSelector('.watchlist-edit-dialog__input');
  await page.waitForTimeout(15000);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  const catalogStats = await page.evaluate(async () => {
    const r = await new Promise((res) => window.chrome.storage.local.get('exchange_catalog_v1', res));
    const list = r?.exchange_catalog_v1?.instruments ?? [];
    const byKind = {};
    const byVenue = {};
    for (const i of list) {
      byKind[i.productKind] = (byKind[i.productKind] || 0) + 1;
      byVenue[i.venue] = (byVenue[i.venue] || 0) + 1;
    }
    const find = (key) => list.filter((i) => i.assetKey === key).map((i) => `${i.venue}:${i.instrumentId}`);
    return {
      total: list.length,
      byKind,
      byVenue,
      xyz: find('stock:XYZ'),
      brkb: find('stock:BRK.B'),
      fbtc: find('etf:FBTC'),
      xlf: find('etf:XLF'),
      aaplHl: list.filter((i) => i.venue === 'hyperliquid').slice(0, 5).map((i) => i.instrumentId),
    };
  });
  console.log('\n=== catalog 预热结果 ===');
  console.log('instrument 总数:', catalogStats.total);
  console.log('按产品类别:', catalogStats.byKind);
  console.log('按 venue:', catalogStats.byVenue);
  console.log('stock:XYZ →', catalogStats.xyz);
  console.log('stock:BRK.B →', catalogStats.brkb);
  console.log('etf:FBTC →', catalogStats.fbtc, '(期望空)');
  console.log('etf:XLF →', catalogStats.xlf, '(期望空)');
  console.log('Hyperliquid 样例:', catalogStats.aaplHl);

  // 写入测试 watchlist 后重载
  await page.evaluate(async (coins) => {
    const r = await new Promise((res) => window.chrome.storage.local.get('gridLayouts', res));
    const layouts = r.gridLayouts;
    for (const layout of layouts) {
      for (const el of layout.elements ?? []) {
        if (el.component === 'watchlist') {
          el.state = { ...(el.state ?? {}), settings: { coins } };
        }
      }
    }
    await new Promise((res) => window.chrome.storage.local.set({ gridLayouts: layouts }, res));
  }, TEST_COINS);

  requests.length = 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-element-id="widget-watchlist"]');
  await page.waitForTimeout(15000);

  const snaps = await readSnapshots(page);
  console.log('\n=== 迁移 / fallback / unavailable ===');
  console.table(
    ['stock:XYZ', 'stock:SQ', 'stock:BRK.B', 'etf:FBTC', 'etf:XLF', 'stock:AAPL', 'crypto:BTC'].map(
      (key) => {
        const s = snaps[key];
        return {
          key,
          price: s?.price,
          sources: s ? s.sources.join('/') : undefined,
          productKind: s?.productKind,
          priceKind: s?.priceKind,
          coverageTier: s?.coverageTier,
          quality: s?.quality,
        };
      },
    ),
  );

  const uiRows = await page.$$eval('[data-element-id="widget-watchlist"] .price-item', (rows) =>
    rows.map((r) => ({
      symbol: r.querySelector('.price-item__symbol')?.textContent,
      value:
        r.querySelector('.price-item__price')?.textContent ??
        r.querySelector('.price-item__loading')?.textContent,
      notice: r.querySelector('.price-item__notice')?.textContent ?? '',
      title: r.querySelector('.price-item__price')?.getAttribute('title') ?? '',
    })),
  );
  console.log('\n=== Watchlist UI ===');
  console.table(uiRows);

  // FBTC / XLF 在弹窗里应当不可选
  await page.click('[data-element-id="widget-watchlist"] .price-item__main');
  await page.waitForSelector('.watchlist-edit-dialog__input');
  await page.fill('.watchlist-edit-dialog__input', 'FBTC');
  await page.waitForTimeout(1500);
  const fbtcItems = await page.$$eval('.watchlist-edit-dialog__coin-item', (items) =>
    items.map((i) => ({
      symbol: i.querySelector('.watchlist-edit-dialog__coin-symbol')?.textContent,
      disabled: i.classList.contains('watchlist-edit-dialog__coin-item--disabled'),
      status: i.querySelector('.watchlist-edit-dialog__coin-status')?.textContent ?? '',
    })),
  );
  console.log('\n=== 弹窗中的 FBTC ===');
  console.table(fbtcItems.slice(0, 5));
  await page.fill('.watchlist-edit-dialog__input', 'XLF');
  await page.waitForTimeout(1500);
  const xlfItems = await page.$$eval('.watchlist-edit-dialog__coin-item', (items) =>
    items.map((i) => ({
      symbol: i.querySelector('.watchlist-edit-dialog__coin-symbol')?.textContent,
      disabled: i.classList.contains('watchlist-edit-dialog__coin-item--disabled'),
      status: i.querySelector('.watchlist-edit-dialog__coin-status')?.textContent ?? '',
    })),
  );
  console.log('=== 弹窗中的 XLF ===');
  console.table(xlfItems.slice(0, 5));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);

  // 快速切 layout
  const layoutIds = await page.evaluate(async () => {
    const r = await new Promise((res) => window.chrome.storage.local.get('gridLayouts', res));
    return (r.gridLayouts ?? []).map((l) => l.id);
  });
  console.log('\n=== 快速切 layout ===');
  const socketsBefore = sockets.length;
  for (let i = 0; i < 6 && layoutIds.length > 1; i += 1) {
    const target = layoutIds[i % layoutIds.length];
    await page.evaluate(async (id) => {
      await new Promise((res) => window.chrome.storage.local.set({ currentLayoutId: id }, res));
      window.dispatchEvent(new Event('storage'));
    }, target);
    await page.click(`.sidebar-item[data-layout-id="${target}"]`).catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(3000);
  console.log('切换前 socket 数:', socketsBefore, '切换后:', sockets.length);

  // 失焦宽限
  console.log('\n=== 失焦宽限 ===');
  const openBeforeBlur = sockets.filter((s) => !s.closedAt).length;
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(20000);
  console.log('失焦 20 秒后仍打开的 socket:', sockets.filter((s) => !s.closedAt).length, '(失焦前', openBeforeBlur, ')');

  // hidden 30 秒
  console.log('\n=== hidden 30 秒 ===');
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setPageVisibilityOverride', { visibility: 'hidden' }).catch(async () => {
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
  });
  await page.waitForTimeout(40000);
  console.log('hidden 40 秒后仍打开的 socket:', sockets.filter((s) => !s.closedAt).length, '(期望 0)');

  const report = { catalogStats, snaps, uiRows, fbtcItems, xlfItems, sockets, requestCount: requests.length };
  fs.writeFileSync(
    path.join(__dirname, 'screenshots', 'exchange-fallbacks-diagnostic.json'),
    JSON.stringify(report, null, 2),
  );

  await ctx.close();
})();
