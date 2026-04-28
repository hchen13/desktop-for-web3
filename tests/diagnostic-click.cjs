/**
 * 点击移位 bug 诊断 — 模拟纯点击（mousedown 与 mouseup 在同一像素）
 * 看是否会让 widget 自己挪位置
 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const URL = 'http://localhost:5173/src/newtab/index.html';
const OUTPUT_DIR = path.join(__dirname, 'diagnostic-output');

const TARGETS = [
  'widget-watchlist',
  'widget-chain-monitor',
  'widget-news',
  'widget-calendar',
  'widget-world-clock',
  'widget-rate-monitor',
  'icon-binance',
  'icon-coinbase',
];

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function readPositions(page) {
  return await page.evaluate((ids) => {
    const result = {};
    for (const id of ids) {
      const el = document.querySelector(`[data-element-id="${id}"]`);
      if (!el) {
        result[id] = null;
        continue;
      }
      const rect = el.getBoundingClientRect();
      result[id] = {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        cx: Math.round(rect.left + rect.width / 2),
        cy: Math.round(rect.top + rect.height / 2),
      };
    }
    return result;
  }, TARGETS);
}

function diff(label, before, after) {
  const lines = [`\n--- ${label} ---`];
  for (const id of TARGETS) {
    const b = before[id];
    const a = after[id];
    if (!b || !a) {
      lines.push(`  ${id.padEnd(28)} (missing)`);
      continue;
    }
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    if (dx !== 0 || dy !== 0) {
      lines.push(`  ${id.padEnd(28)} MOVED  dx=${dx}  dy=${dy}`);
    } else {
      lines.push(`  ${id.padEnd(28)} unchanged`);
    }
  }
  return lines.join('\n');
}

async function clickAt(page, x, y) {
  // 真"纯点击"：mousedown / mouseup 同一坐标，无 mousemove
  await page.mouse.move(x, y);
  await page.mouse.down();
  await new Promise((r) => setTimeout(r, 50));
  await page.mouse.up();
}

async function run() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1600, height: 1000 },
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (err) => console.log('[pageerror]', err.message));
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.evaluate(() => {
      try { localStorage.clear(); } catch {}
      try { window.chrome?.storage?.local?.clear?.(); } catch {}
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-element-id="widget-watchlist"]', { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 1500));

    const initial = await readPositions(page);
    console.log('Initial positions:');
    for (const id of TARGETS) {
      console.log(`  ${id.padEnd(28)} (${initial[id]?.x}, ${initial[id]?.y})`);
    }

    await page.screenshot({ path: path.join(OUTPUT_DIR, 'click-before.png') });

    // 依次点击每个 widget 中心
    for (const id of TARGETS) {
      const pos = initial[id];
      if (!pos) continue;
      const before = await readPositions(page);
      await clickAt(page, pos.cx, pos.cy);
      await new Promise((r) => setTimeout(r, 300)); // 等一会看是否动了
      const after = await readPositions(page);
      console.log(diff(`点击 ${id} @ (${pos.cx}, ${pos.cy})`, before, after));
    }

    await page.screenshot({ path: path.join(OUTPUT_DIR, 'click-after.png') });
    console.log(`\n截图：${OUTPUT_DIR}/click-{before,after}.png`);
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
