/**
 * Playwright 端到端测试 — 加载扩展，打开 newtab，验证 watchlist 价格、popup
 *
 * 比 puppeteer 优势：launchPersistentContext 是 Playwright 推荐的扩展加载方式，
 * 状态管理更稳，evaluate() 不容易因为页面忙而 protocol 超时。
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const DIST = path.resolve(__dirname, '..', 'dist');
const PROFILE = path.resolve(__dirname, 'playwright-profile');
const OUT = path.resolve(__dirname, 'diagnostic-output');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
// 干净 profile
if (fs.existsSync(PROFILE)) fs.rmSync(PROFILE, { recursive: true, force: true });

(async () => {
  // Playwright 加载扩展必须用 launchPersistentContext
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false, // 扩展不能在 headless 下跑
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-position=-3000,-3000',
      '--window-size=1600,1000',
    ],
    viewport: { width: 1600, height: 1000 },
  });

  // 拿 extension id：触发 chrome://newtab/ → 重定向到扩展 URL
  const warmup = await ctx.newPage();
  await warmup.goto('chrome://newtab/').catch(() => {});
  const extId = warmup.url().match(/^chrome-extension:\/\/([a-z]{32})\//)?.[1];
  console.log('[pw] extension id:', extId);
  await warmup.close();

  if (!extId) { await ctx.close(); process.exit(1); }

  const page = await ctx.newPage();
  const errors = [];
  const psLogs = [];
  page.on('pageerror', (e) => errors.push(`PAGE: ${e.message}`));
  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('[PriceService]')) psLogs.push(`[${msg.type()}] ${t.slice(0, 250)}`);
  });

  console.log('\n[pw] open newtab...');
  await page.goto(`chrome-extension://${extId}/src/newtab/index.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForSelector('[data-element-id="widget-watchlist"]', { timeout: 10000 });

  // 等交易所行情首轮 targeted 刷新 + WebSocket 推送
  await page.waitForTimeout(12000);

  const text = await page.locator('[data-element-id="widget-watchlist"]').innerText();
  console.log('\n[pw] watchlist content:');
  console.log(text.split('\n').map(l => '  ' + l).join('\n'));

  // 也直接读 React/Solid 后的 PriceService 状态
  const psState = await page.evaluate(async () => {
    const mod = await import('/src/services/prices/PriceService.ts').catch(() => null);
    if (!mod || !mod.priceService) return { error: 'no priceService' };
    const out = {};
    for (const sym of ['BTC','NVDA','TSLA','SPY']) {
      out[sym] = mod.priceService.getSnapshot(sym);
    }
    return out;
  });
  console.log('\n[pw] priceService.getSnapshot:');
  console.log(JSON.stringify(psState, null, 2));

  await page.screenshot({ path: path.join(OUT, 'pw-newtab.png') });

  // 切到 popup 测一下（注意：popup.tsx 在 popup 模式下才会有正确 chrome.tabs context；这里只测能否渲染）
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/src/popup/index.html`, { waitUntil: 'domcontentloaded' });
  await popup.waitForTimeout(1000);
  const popupText = await popup.locator('body').innerText();
  console.log('\n[pw] popup body:');
  console.log(popupText.split('\n').map(l => '  ' + l).join('\n').slice(0, 500));
  await popup.screenshot({ path: path.join(OUT, 'pw-popup.png') });
  await popup.close();

  console.log('\n[pw] errors:', errors.length === 0 ? 'none' : errors);
  console.log('[pw] PriceService logs:');
  for (const l of psLogs) console.log('  ' + l);
  console.log('\nscreenshots saved at:', OUT);

  await ctx.close();
})().catch((e) => { console.error(e); process.exit(1); });
