/**
 * 行情链路真实验收：公共 REST 冒烟 + 打包后的 MV3 扩展行为断言。
 *
 * 与 diagnostic-* 脚本的区别：这里每一项都是断言，任何一条不通过就以非零退出码结束，
 * 可以直接挂到 CI 上。
 *
 * 用法：rm -rf dist && npm run build && node tests/smoke-exchange-prices.cjs
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const DIST = path.resolve(__dirname, '..', 'dist');
const SRC = path.resolve(__dirname, '..', 'src');
const PROFILE = path.resolve(__dirname, 'playwright-profile-smoke');

/**
 * 复用固定的测试 profile。仓库 AGENTS.md 禁止未经确认的递归删除，所以这里绝不
 * 自动 rm -rf；fresh storage 由扩展页面里的 chrome.storage.local.clear() 建立。
 */
function ensureProfileUsable() {
  if (!fs.existsSync(PROFILE)) return;
  const lock = path.join(PROFILE, 'SingletonLock');
  if (fs.existsSync(lock)) {
    throw new Error(
      `测试 profile 疑似被占用或上次异常退出：${PROFILE}\n` +
        '请先确认没有残留的 Chrome 进程，然后手动删除该目录后重试（脚本不会自动递归删除）。',
    );
  }
}

const failures = [];
let checks = 0;

function check(name, condition, detail) {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    failures.push(name);
  }
}

const QUOTE_HOSTS = /^https:\/\/(www\.okx\.com|api\.bitget\.com|data-api\.binance\.vision|fapi\.binance\.com|api\.hyperliquid\.xyz)\//;

/** 交易所侧的无 symbol ticker */
const FULL_MARKET_URL_PATTERNS = [
  /\/api\/v5\/market\/tickers\?instType=/,
  /\/api\/v3\/market\/tickers\?category=[^&]*$/,
  /\/api\/v3\/ticker\/24hr$/,
  /\/fapi\/v1\/ticker\/24hr$/,
  /\/api\/v3\/ticker\/price$/,
];

/** Hyperliquid 的全市场价格查询复用同一个 /info URL，只能看 POST body */
const FULL_MARKET_BODY_PATTERNS = [
  /"type"\s*:\s*"allMids"/,
  /"type"\s*:\s*"metaAndAssetCtxs"/,
  /"type"\s*:\s*"spotMetaAndAssetCtxs"/,
];

function isFullMarket(record) {
  if (FULL_MARKET_URL_PATTERNS.some((re) => re.test(record.url))) return true;
  return FULL_MARKET_BODY_PATTERNS.some((re) => re.test(record.body || ''));
}

function describeRecord(record) {
  return `${record.method} ${record.url}${record.body ? ` body=${record.body.slice(0, 120)}` : ''}`;
}

const CATALOG_PATTERNS = [/public\/instruments/, /market\/instruments/, /exchangeInfo/];

function isTicker(record) {
  return (
    record.url.includes('/market/ticker') ||
    record.url.includes('/market/tickers') ||
    record.url.includes('/ticker/24hr') ||
    /"type"\s*:\s*"l2Book"/.test(record.body || '')
  );
}

function tickerCount(records) {
  return records.filter(isTicker).length;
}

/** 打印每个定向请求的 method / URL / body 与调用次数，便于核对预算 */
function reportTickerBudget(records) {
  const counts = new Map();
  for (const record of records.filter(isTicker)) {
    const key = describeRecord(record);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  console.log(`  --- 定向 REST 明细（共 ${tickerCount(records)} 次）---`);
  for (const [key, n] of [...counts.entries()].sort()) {
    console.log(`      ${n}x ${key}`);
  }
  return counts;
}

async function getJson(url, init) {
  const resp = await fetch(url, init);
  if (!resp.ok) throw new Error(`${url} -> HTTP ${resp.status}`);
  return resp.json();
}

// ============ 1. 静态检查：运行时不得残留 Pyth / EventSource / 密钥 ============
function scanRuntimeSources() {
  console.log('\n[1] 运行时代码静态检查');
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(full);
    }
  };
  walk(SRC);

  const offenders = { hermes: [], eventSource: [], feedIds: [] };
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (/hermes\.pyth\.network|benchmarks\.pyth\.network/.test(text)) offenders.hermes.push(file);
    if (/\bnew EventSource\b/.test(text)) offenders.eventSource.push(file);
    if (/pythFeedId|price_feeds/.test(text)) offenders.feedIds.push(file);
  }

  check('运行时代码无 Pyth/Hermes endpoint', offenders.hermes.length === 0, offenders.hermes.join(','));
  check('运行时代码无 EventSource', offenders.eventSource.length === 0, offenders.eventSource.join(','));
  check('运行时代码无 Pyth feed id 残留', offenders.feedIds.length === 0, offenders.feedIds.join(','));

  const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf8'));
  const perms = manifest.host_permissions || [];
  check('dist manifest 无 Pyth/Hermes 权限', !perms.some((h) => /pyth|hermes/i.test(h)));
  check(
    'dist manifest 声明了四家 venue 的 REST host',
    ['www.okx.com', 'api.bitget.com', 'data-api.binance.vision', 'api.hyperliquid.xyz'].every((h) =>
      perms.some((p) => p.includes(h)),
    ),
  );

  const bundles = fs
    .readdirSync(path.join(DIST, 'assets'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(DIST, 'assets', f), 'utf8'))
    .join('\n');
  check('构建产物无 Pyth/Hermes endpoint', !/hermes\.pyth\.network/.test(bundles));
  check(
    '构建产物无 apiKey/secret 形态的凭据',
    !/(api[_-]?key|secret|bearer)\s*[:=]\s*["'][A-Za-z0-9_-]{16,}/i.test(bundles),
  );
}

// ============ 2. 公共 REST 冒烟：四家 venue 的定向路径 ============
async function restSmoke() {
  console.log('\n[2] 公共 REST 定向路径冒烟');

  const okx = await getJson('https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT');
  check('OKX 定向 ticker 返回 BTC-USDT', okx.code === '0' && okx.data?.[0]?.instId === 'BTC-USDT');
  check('OKX 报价为正数', Number(okx.data?.[0]?.last) > 0);

  const okxStock = await getJson('https://www.okx.com/api/v5/market/ticker?instId=XNVDA-USDT');
  check('OKX 代币化股票 XNVDA-USDT 可用', Number(okxStock.data?.[0]?.last) > 0);

  const bitget = await getJson(
    'https://api.bitget.com/api/v3/market/tickers?category=SPOT&symbol=RNVDAUSDT',
  );
  check('Bitget Reality RNVDAUSDT 可用', Number(bitget.data?.[0]?.lastPrice) > 0);

  const bitgetPerp = await getJson(
    'https://api.bitget.com/api/v3/market/tickers?category=USDT-FUTURES&symbol=BRKBUSDT',
  );
  check('Bitget BRK.B 永续有 indexPrice', Number(bitgetPerp.data?.[0]?.indexPrice) > 0);

  const binance = await getJson(
    `https://data-api.binance.vision/api/v3/ticker/24hr?symbols=${encodeURIComponent(
      JSON.stringify(['BTCUSDT', 'NVDABUSDT', 'SPYBUSDT']),
    )}`,
  );
  check('Binance selected-symbol batch 返回三条', Array.isArray(binance) && binance.length === 3);
  check(
    'Binance 返回项带盘口，可用于判定是否仍可交易',
    binance.every((r) => r.bidPrice !== undefined && r.askPrice !== undefined),
  );

  const hl = await getJson('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'l2Book', coin: 'xyz:AAPL' }),
  });
  check('Hyperliquid 定向 l2Book 返回盘口', Number(hl.levels?.[0]?.[0]?.px) > 0);

  // USDT 在这三家都没有 USDT 计价的自身交易对 —— 这正是它必须 unavailable 的原因
  const usdtOnBinance = await fetch(
    'https://data-api.binance.vision/api/v3/ticker/24hr?symbol=USDTUSDT',
  );
  check('Binance 不存在 USDTUSDT 交易对', usdtOnBinance.status >= 400);
}

// ============ 3. MV3 扩展行为断言 ============
async function extensionSmoke() {
  console.log('\n[3] MV3 扩展行为');
  ensureProfileUsable();

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

  try {
    const warmup = await ctx.newPage();
    await warmup.goto('chrome://newtab/').catch(() => {});
    const extId = warmup.url().match(/^chrome-extension:\/\/([a-z]{32})\//)?.[1];
    await warmup.close();
    if (!extId) throw new Error('无法确定扩展 id');

    const url = `chrome-extension://${extId}/src/newtab/index.html`;
    const page = await ctx.newPage();
    const requests = [];
    const sockets = [];
    page.on('request', (r) => {
      if (!QUOTE_HOSTS.test(r.url())) return;
      requests.push({ url: r.url(), method: r.method(), body: r.postData() ?? '' });
    });
    page.on('websocket', (ws) => sockets.push(ws.url()));

    // --- 3.1 fresh storage 下的默认自选 ---
    // 不删 profile 目录；只清扩展自己的 storage 来建立干净起点
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-element-id="widget-watchlist"]');
    await page.evaluate(
      () => new Promise((resolve) => window.chrome.storage.local.clear(resolve)),
    );

    // 先彻底卸掉上一次加载，否则它被打断后的兜底请求会漏进下面的计数窗口
    await page.goto('about:blank');
    await page.waitForTimeout(1000);
    requests.length = 0;
    sockets.length = 0;

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-element-id="widget-watchlist"]');
    await page.waitForTimeout(15000);
    reportTickerBudget(requests);

    const readSnapshots = () =>
      page.evaluate(async () => {
        const r = await new Promise((res) => window.chrome.storage.local.get('prices_cache_v2', res));
        return r?.prices_cache_v2?.snapshots ?? {};
      });

    let snaps = await readSnapshots();
    for (const key of ['crypto:BTC', 'crypto:ETH', 'crypto:SOL']) {
      const s = snaps[key];
      check(`${key} 拿到 crypto 现货报价`, !!s && s.price > 0 && s.productKind === 'crypto_spot');
    }
    for (const key of ['stock:NVDA', 'stock:TSLA', 'etf:SPY']) {
      const s = snaps[key];
      check(
        `${key} 命中代币化股票现货`,
        !!s && s.price > 0 && s.productKind === 'tokenized_stock_spot',
      );
    }
    check(
      '默认自选不触发全市场价格请求（含 Hyperliquid allMids / metaAndAssetCtxs）',
      !requests.some(isFullMarket),
      requests.filter(isFullMarket).map(describeRecord)[0],
    );
    check(
      '打开搜索窗口之前没有 catalog 请求',
      !requests.some((r) => CATALOG_PATTERNS.some((re) => re.test(r.url))),
    );
    check(
      `默认 6 个 Tier 1 标的的定向 REST 不超过一轮（实际 ${tickerCount(requests)} 次）`,
      tickerCount(requests) <= 18,
      requests.filter(isTicker).map(describeRecord).join('\n'),
    );
    check('每个 venue 至多一条 WebSocket', new Set(sockets).size === sockets.length, sockets.join(','));
    check(
      'WebSocket 覆盖 OKX / Bitget / Binance',
      ['ws.okx.com', 'ws.bitget.com', 'stream.binance.com'].every((h) =>
        sockets.some((s) => s.includes(h)),
      ),
      sockets.join(','),
    );

    // --- 3.2 打开搜索窗口才拉 catalog ---
    const beforeDialog = requests.length;
    await page.click('[data-element-id="widget-watchlist"] .price-item__main');
    await page.waitForSelector('.watchlist-edit-dialog__input');
    await page.waitForTimeout(15000);
    const dialogRequests = requests.slice(beforeDialog);
    check(
      '打开搜索窗口时请求 instrument metadata',
      dialogRequests.some((r) => CATALOG_PATTERNS.some((re) => re.test(r.url))),
    );
    check(
      'catalog 阶段覆盖四家 venue',
      ['okx.com', 'bitget.com', 'binance', 'hyperliquid.xyz'].every((h) =>
        dialogRequests.some((r) => r.url.includes(h)),
      ),
    );
    check(
      '打开搜索窗口不请求全市场价格',
      !dialogRequests.some(isFullMarket),
      dialogRequests.filter(isFullMarket).map(describeRecord)[0],
    );

    const beforeTyping = requests.length;
    await page.type('.watchlist-edit-dialog__input', 'AAPL', { delay: 120 });
    await page.waitForTimeout(3000);
    check('搜索输入不产生网络请求', requests.length === beforeTyping);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // --- 3.3 特殊标的：USDT / BRK.B / 无覆盖 ETF ---
    await page.evaluate(async () => {
      const coins = [
        { symbol: 'USDT', name: 'Tether', category: 'crypto' },
        { symbol: 'BRK.B', name: 'Berkshire Hathaway B', category: 'stock' },
        { symbol: 'FBTC', name: 'Fidelity Bitcoin', category: 'etf' },
        { symbol: 'BTC', name: 'Bitcoin', category: 'crypto' },
        { symbol: 'NVDA', name: 'NVIDIA', category: 'stock' },
        { symbol: 'SPY', name: 'SPDR S&P 500', category: 'etf' },
      ];
      const r = await new Promise((res) => window.chrome.storage.local.get('gridLayouts', res));
      const layouts = r.gridLayouts;
      for (const layout of layouts) {
        for (const el of layout.elements ?? []) {
          if (el.component === 'watchlist') el.state = { ...(el.state ?? {}), settings: { coins } };
        }
      }
      await new Promise((res) => window.chrome.storage.local.set({ gridLayouts: layouts }, res));
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-element-id="widget-watchlist"]');
    await page.waitForTimeout(16000);
    snaps = await readSnapshots();

    const usdt = snaps['crypto:USDT'];
    const btc = snaps['crypto:BTC'];
    check('USDT 被标记为暂无可用市场', !!usdt && usdt.quality === 'unavailable');
    check('USDT 没有任何来源', !!usdt && usdt.sourceCount === 0);
    check(
      'USDT 绝不显示 BTC 价格',
      !!usdt && !!btc && btc.price > 1000 && (usdt.price === 0 || usdt.price < 100),
      `usdt=${usdt?.price} btc=${btc?.price}`,
    );

    const brkb = snaps['stock:BRK.B'];
    check('BRK.B 通过衍生品 fallback 取到价格', !!brkb && brkb.price > 0);
    check(
      'BRK.B 明确标注为衍生品参考价',
      !!brkb && brkb.coverageTier === 'derivative-reference',
      brkb?.coverageTier,
    );
    check('BRK.B 用 index/mark 而不是伪装成现货', !!brkb && brkb.productKind === 'equity_perp');

    const fbtc = snaps['etf:FBTC'];
    check('FBTC 无合法覆盖时标 unavailable', !!fbtc && fbtc.quality === 'unavailable');
    check('FBTC 没有借用别的资产价格', !!fbtc && fbtc.sourceCount === 0);

    const nvda = snaps['stock:NVDA'];
    check(
      '代币化股票如实标注计价货币，不冒充 USD',
      !!nvda && nvda.quoteCurrency !== 'USD' && nvda.quoteCurrency.length > 0,
      nvda?.quoteCurrency,
    );

    const uiRows = await page.$$eval('[data-element-id="widget-watchlist"] .price-item', (rows) =>
      rows.map((el) => ({
        symbol: el.querySelector('.price-item__symbol')?.textContent,
        text: el.textContent ?? '',
        title: el.querySelector('.price-item__price')?.getAttribute('title') ?? '',
      })),
    );
    const usdtRow = uiRows.find((r) => r.symbol === 'USDT');
    check('UI 上 USDT 显示暂无可用市场', !!usdtRow && usdtRow.text.includes('暂无可用市场'));
    const brkbRow = uiRows.find((r) => r.symbol === 'BRK.B');
    check('UI 上 BRK.B 标注衍生品参考价', !!brkbRow && brkbRow.title.includes('衍生品参考价'));

    check(
      '全程没有出现全市场价格请求',
      !requests.some(isFullMarket),
      requests.filter(isFullMarket).map(describeRecord)[0],
    );
    check(
      'Hyperliquid 只用 perpDexs / meta / l2Book',
      requests
        .filter((r) => r.url.includes('hyperliquid.xyz'))
        .every((r) => /"type"\s*:\s*"(perpDexs|meta|l2Book)"/.test(r.body || '')),
      requests
        .filter((r) => r.url.includes('hyperliquid.xyz'))
        .map(describeRecord)
        .join('\n'),
    );
  } finally {
    await ctx.close();
  }
}

(async () => {
  if (!fs.existsSync(path.join(DIST, 'manifest.json'))) {
    console.error('dist/ 不存在，先执行 rm -rf dist && npm run build');
    process.exit(1);
  }
  try {
    scanRuntimeSources();
    await restSmoke();
    await extensionSmoke();
  } catch (err) {
    console.error('\n冒烟过程抛出异常：', err);
    failures.push(`异常: ${err.message}`);
  }

  console.log(`\n===== ${checks - failures.length}/${checks} 项通过 =====`);
  if (failures.length > 0) {
    console.error('未通过：');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('全部通过');
})();
