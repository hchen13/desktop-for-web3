/**
 * 拖拽诊断脚本 — Puppeteer 驱动浏览器，验证 Watchlist 推开 Hyperliquid/MetaMask 的真实行为
 *
 * 流程：
 *   1. 打开 dev server 的 newtab 页面
 *   2. 清 localStorage 拿干净默认布局
 *   3. 启用 __DRAG_DEBUG，订阅 console
 *   4. 读拖拽前 watchlist + 4 个 icon 的像素位置
 *   5. 模拟将 Watchlist 下移 N 个 grid unit（N 由 STEP 控制）
 *   6. 读拖拽中 / 拖拽后的位置
 *   7. 截图前后对比 + 打印 [DragSwap] 日志
 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const URL = 'http://localhost:5173/src/newtab/index.html';
const OUTPUT_DIR = path.join(__dirname, 'diagnostic-output');
const DOWN_CELLS = parseInt(process.env.DOWN_CELLS || '1', 10);
const RIGHT_CELLS = parseInt(process.env.RIGHT_CELLS || '0', 10);
const GRID_UNIT = 100;
const GRID_GAP = 20;
const CELL_SIZE = GRID_UNIT + GRID_GAP;

const TARGET_ELEMENT_IDS = [
  'widget-watchlist',
  'widget-news',
  'widget-calendar',
  'widget-chain-monitor',
  'icon-home-hyperliquid',
  'icon-home-metamask',
  'icon-home-blockbeats',
  'icon-home-twitter',
  'icon-binance',
  'icon-coinbase',
  'icon-uniswap',
];

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const collectedLogs = [];

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
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        cx: Math.round(rect.left + rect.width / 2),
        cy: Math.round(rect.top + rect.height / 2),
      };
    }
    return result;
  }, TARGET_ELEMENT_IDS);
}

function summarizeMove(label, before, after) {
  const lines = [`\n--- ${label} ---`];
  for (const id of TARGET_ELEMENT_IDS) {
    const b = before[id];
    const a = after[id];
    if (!b || !a) {
      lines.push(`  ${id.padEnd(28)} (missing)`);
      continue;
    }
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dxCells = (dx / CELL_SIZE).toFixed(1);
    const dyCells = (dy / CELL_SIZE).toFixed(1);
    const moved = dx !== 0 || dy !== 0;
    const tag = moved ? `MOVED dx=${dxCells} dy=${dyCells} cells (${dx}px,${dy}px)` : 'unchanged';
    lines.push(`  ${id.padEnd(28)} ${tag}`);
  }
  return lines.join('\n');
}

async function run() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
  });

  try {
    const page = await browser.newPage();

    page.on('console', async (msg) => {
      const text = msg.text();
      if (text.includes('[DragSwap]')) {
        try {
          const args = msg.args();
          const parts = await Promise.all(args.map(a => a.jsonValue().catch(() => '<unserializable>')));
          collectedLogs.push(`[${msg.type()}] ${parts.map(p => typeof p === 'object' ? JSON.stringify(p) : p).join(' ')}`);
        } catch {
          collectedLogs.push(`[${msg.type()}] ${text}`);
        }
      } else if (text.includes('[GridStore]') || text.includes('error')) {
        collectedLogs.push(`[${msg.type()}] ${text}`);
      }
    });

    console.log('1) 加载页面…');
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 15000 });

    console.log('2) 清 localStorage + 重新加载…');
    await page.evaluate(() => {
      try { localStorage.clear(); } catch {}
      try { if (window.chrome?.storage?.local?.clear) window.chrome.storage.local.clear(); } catch {}
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    // 等 layout 渲染（grid + lazy widgets）
    await page.waitForSelector('[data-element-id="widget-watchlist"]', { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 1500));

    console.log('3) 启用 __DRAG_DEBUG…');
    await page.evaluate(() => { window.__DRAG_DEBUG = true; });

    console.log('4) 读拖拽前位置…');
    const before = await readPositions(page);
    console.log(JSON.stringify(before, null, 2));

    await page.screenshot({ path: path.join(OUTPUT_DIR, 'before.png'), fullPage: false });

    const watchlist = before['widget-watchlist'];
    if (!watchlist) {
      console.error('❌ 找不到 widget-watchlist，default layout 可能没渲染');
      console.log('页面所有 [data-element-id] 的清单：');
      const allIds = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-element-id]'))
          .map(e => e.getAttribute('data-element-id'))
      );
      console.log(allIds);
      return;
    }

    const startX = watchlist.cx;
    const startY = watchlist.cy;
    const endX = startX + RIGHT_CELLS * CELL_SIZE;
    const endY = startY + DOWN_CELLS * CELL_SIZE;

    console.log(`5) 模拟拖拽 Watchlist：从 (${startX},${startY}) → (${endX},${endY})  (右移 ${RIGHT_CELLS} 格 / 下移 ${DOWN_CELLS} 格)`);

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // 关键：分步移动让 5px 阈值跨过 + 让框架反应
    const steps = Math.max(8, (Math.abs(DOWN_CELLS) + Math.abs(RIGHT_CELLS)) * 6);
    for (let i = 1; i <= steps; i++) {
      const x = startX + ((endX - startX) * i) / steps;
      const y = startY + ((endY - startY) * i) / steps;
      await page.mouse.move(x, y);
      await new Promise((r) => setTimeout(r, 40));
    }

    // 在 mouseup 之前抓一次"拖拽中"位置
    const midDrag = await readPositions(page);
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'mid-drag.png'), fullPage: false });

    console.log('6) 释放鼠标…');
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 500));

    const after = await readPositions(page);
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'after.png'), fullPage: false });

    console.log(summarizeMove('拖拽中（mouseup 前）', before, midDrag));
    console.log(summarizeMove('拖拽后（mouseup 后）', before, after));

    console.log('\n--- DRAG_DEBUG console 日志 ---');
    if (collectedLogs.length === 0) {
      console.log('  (无 [DragSwap] / [GridStore] 日志被捕获)');
    } else {
      for (const line of collectedLogs) console.log('  ' + line);
    }

    console.log(`\n截图：${OUTPUT_DIR}/{before,mid-drag,after}.png`);
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
