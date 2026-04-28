/**
 * 测试 selector 能否搜出非 curated 的 ticker（CRCL / RKLB / 等）
 * 验证 dynamicCatalog 工作正常。
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const DIST = path.resolve(__dirname, '..', 'dist');
const PROFILE = path.resolve(__dirname, 'playwright-profile');
if (fs.existsSync(PROFILE)) fs.rmSync(PROFILE, { recursive: true, force: true });

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      '--no-first-run', '--no-default-browser-check',
      '--window-position=-3000,-3000',
    ],
    viewport: { width: 1600, height: 1000 },
  });

  const warmup = await ctx.newPage();
  await warmup.goto('chrome://newtab/').catch(() => {});
  const extId = warmup.url().match(/^chrome-extension:\/\/([a-z]{32})\//)?.[1];
  await warmup.close();
  console.log('extId:', extId);

  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/src/newtab/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-element-id="widget-watchlist"]');
  // 等价格 + dynamic catalog 加载（catalog 1MB+，需要几秒）
  await page.waitForTimeout(8000);

  // 检查 chrome.storage.local 看 dynamic catalog 持久化情况
  const storage = await page.evaluate(async () => {
    return new Promise((resolve) => {
      window.chrome.storage.local.get('pyth_catalog_v1', (r) => {
        const c = r?.pyth_catalog_v1;
        if (!c) return resolve({ cached: false });
        const all = c.assets || [];
        // Sample search
        const norm = (q) => q.toUpperCase();
        const find = (sym) => all.find(a => a.symbol === sym);
        resolve({
          cached: true,
          version: c.version,
          totalCount: all.length,
          ts: c.timestamp,
          age_min: Math.round((Date.now() - c.timestamp) / 60000),
          crcl: find('CRCL'),
          rklb: find('RKLB'),
          asts: find('ASTS'),
          ionq: find('IONQ'),
          mara: find('MARA'),
          searchCircle: all.filter(a => a.name.toUpperCase().includes('CIRCLE')).slice(0, 3),
          byCategory: {
            crypto: all.filter(a => a.category === 'crypto').length,
            stock: all.filter(a => a.category === 'stock').length,
            etf: all.filter(a => a.category === 'etf').length,
            fx: all.filter(a => a.category === 'fx').length,
            commodity: all.filter(a => a.category === 'commodity').length,
          },
        });
      });
    });
  });
  console.log('\nstorage state:');
  console.log(JSON.stringify(storage, null, 2));

  await ctx.close();
})().catch((e) => { console.error(e); process.exit(1); });
