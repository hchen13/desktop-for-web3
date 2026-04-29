/**
 * 静态资产元数据表
 *
 * 覆盖：
 *  - Crypto Top ~80（含主流 stable 作为参考）
 *  - 美股 Tier-1 60+
 *  - ETF ~15
 *  - 大宗商品 / FX 少量
 *
 * Pyth feed_ids 取自 https://www.pyth.network/developers/price-feed-ids
 * （主网 mainnet ids）。无对应 Pyth feed 的条目用 null 表示，REST 兜底。
 */

import type { AssetMeta } from './types';
import { dynamicCatalog } from './dynamicCatalog';

// ============ Logo helpers ============
// 多源回退：jsDelivr cryptocurrency-icons (Top ~50) → coinpaprika (覆盖广，需 symbol-name slug)
// → 最终 UI 占位文字。getCryptoLogoUrls 返回数组，UI 用 onerror 链式回退。
export function getCryptoLogoUrl(symbol: string): string {
  return `https://cdn.jsdelivr.net/npm/cryptocurrency-icons@latest/svg/color/${symbol.toLowerCase()}.svg`;
}

/**
 * 给 crypto 一组按优先级的 logo URL。
 *
 * **重要**：TradingView XTVC pattern 对未收录的 token 会返回 200+灰色 compass 占位，
 * 而不是 404。所以 onError 不会触发，chain 会卡在 TV 上显示错误的 logo。
 * 因此把 **Coinpaprika 放最前**（按 sym-name slug 直查，命中即真 logo）。
 *
 *   1. Coinpaprika by symbol-name slug — 命中率最高，返回真 logo
 *   2. jsDelivr cryptocurrency-icons SVG — Top ~50 老币兜底
 *   3. TradingView XTVC — 最后兜底（200+placeholder 也无所谓，比无 logo 好）
 */
export function getCryptoLogoUrls(symbol: string, name: string): string[] {
  const sym = symbol.toLowerCase();
  const symU = symbol.toUpperCase();
  const slug = `${sym}-${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;
  return [
    `https://static.coinpaprika.com/coin/${slug}/logo.png`,
    `https://cdn.jsdelivr.net/npm/cryptocurrency-icons@latest/svg/color/${sym}.svg`,
    `https://s3-symbol-logo.tradingview.com/crypto/XTVC${symU}.svg`,
  ];
}

// 美股 / ETF logo
// **重要**：FMP 对它没有的 ticker 返回美国国旗占位（CRCL 等近期 IPO 都中招）；
// EODHD 则普遍 404 缺失。Logo.dev 的 ticker endpoint 覆盖最广 + 对未知返回字母占位（更诚实）。
// 顺序：Logo.dev → FMP → EODHD。
const LOGO_DEV_TOKEN = 'pk_X-1ZO13GSgeOoUrIuJ6GMQ'; // 公开 demo token
export function getStockLogoUrl(ticker: string): string {
  return `https://img.logo.dev/ticker/${ticker}?token=${LOGO_DEV_TOKEN}`;
}

/** 多源 stock logo：Logo.dev → FMP → EODHD */
function getStockLogoUrls(ticker: string): string[] {
  return [
    `https://img.logo.dev/ticker/${ticker}?token=${LOGO_DEV_TOKEN}`,
    `https://financialmodelingprep.com/image-stock/${ticker}.png`,
    `https://eodhd.com/img/logos/US/${ticker}.png`,
  ];
}

/** FX 用国旗 —— TradingView 国旗 SVG + flagcdn PNG fallback */
const FX_BASE_TO_COUNTRY: Record<string, string> = {
  USD: 'us',
  EUR: 'eu',
  JPY: 'jp',
  GBP: 'gb',
  CNH: 'cn',
  CNY: 'cn',
  AUD: 'au',
  CAD: 'ca',
  CHF: 'ch',
  HKD: 'hk',
  KRW: 'kr',
  SGD: 'sg',
  NZD: 'nz',
  INR: 'in',
  RUB: 'ru',
  BRL: 'br',
  MXN: 'mx',
  ZAR: 'za',
  TRY: 'tr',
  SEK: 'se',
  NOK: 'no',
  DKK: 'dk',
  PLN: 'pl',
};
function getFxLogoUrls(symbol: string): string[] {
  const base = symbol.slice(0, 3).toUpperCase();
  const country = FX_BASE_TO_COUNTRY[base];
  if (!country) return [];
  return [
    `https://s3-symbol-logo.tradingview.com/country/${country.toUpperCase()}.svg`,
    `https://flagcdn.com/w40/${country}.png`,
  ];
}

/** Commodity 用 emoji 数据 URI（XAU=金、XAG=银、XPT=铂、BRENT/WTI=油） */
const COMMODITY_EMOJI: Record<string, string> = {
  XAU: '🪙',
  XAG: '🥈',
  XPT: '⚪',
  XPD: '⚫',
  BRENT: '🛢️',
  WTI: '🛢️',
};
function getCommodityLogoDataUri(symbol: string): string | null {
  const emoji = COMMODITY_EMOJI[symbol.toUpperCase()];
  if (!emoji) return null;
  // SVG with emoji as foreignObject — render as image, no external CDN needed
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><text y="26" font-size="26">${emoji}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * 统一的 logo URL 解析（按 category 分发）。
 * 返回 null 表示 UI 应回退到文字占位。
 * 注：crypto 仅返回主 URL（jsDelivr）；UI 应用 getLogoUrlChain 拿完整 fallback 列表。
 */
export function getLogoUrl(asset: {
  symbol: string;
  category: AssetMeta['category'];
}): string | null {
  switch (asset.category) {
    case 'crypto':
      return getCryptoLogoUrl(asset.symbol);
    case 'stock':
    case 'etf':
      return getStockLogoUrl(asset.symbol);
    default:
      return null;
  }
}

/**
 * 完整 fallback URL 链：
 *   crypto   : [TradingView XTVC, jsDelivr, Coinpaprika]
 *   stock/etf: [FMP, EODHD]
 *   fx       : [TV 国旗 SVG, flagcdn PNG]
 *   commodity: [emoji data-uri SVG]（XAU/BRENT 等）
 */
export function getLogoUrlChain(asset: {
  symbol: string;
  name: string;
  category: AssetMeta['category'];
}): string[] {
  switch (asset.category) {
    case 'crypto':
      return getCryptoLogoUrls(asset.symbol, asset.name);
    case 'stock':
    case 'etf':
      return getStockLogoUrls(asset.symbol);
    case 'fx':
      return getFxLogoUrls(asset.symbol);
    case 'commodity': {
      const uri = getCommodityLogoDataUri(asset.symbol);
      return uri ? [uri] : [];
    }
    default:
      return [];
  }
}

/**
 * Pyth benchmarks (TradingView UDF 协议) 的 symbol 命名约定。
 * 用于历史 OHLC 查询，进而算 24h%。
 */
export function getPythBenchmarkSymbol(asset: {
  symbol: string;
  category: AssetMeta['category'];
}): string | null {
  switch (asset.category) {
    case 'crypto':
      return `Crypto.${asset.symbol}/USD`;
    case 'stock':
    case 'etf':
      return `Equity.US.${asset.symbol}/USD`;
    default:
      return null;
  }
}

/** Pyth equity / fx / metal feed 命名前缀（仅作类型说明） */
type Hex = string;

// ============ Crypto ============
const CRYPTO: AssetMeta[] = [
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    category: 'crypto',
    rank: 1,
    cexPair: { base: 'BTC', quote: 'USDT' },
    logoSlug: 'bitcoin',
    pythFeedId: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43' as Hex,
  },
  {
    symbol: 'ETH',
    name: 'Ethereum',
    category: 'crypto',
    rank: 2,
    cexPair: { base: 'ETH', quote: 'USDT' },
    logoSlug: 'ethereum',
    pythFeedId: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace' as Hex,
  },
  {
    symbol: 'USDT',
    name: 'Tether',
    category: 'crypto',
    rank: 3,
    cexPair: { base: 'BTC', quote: 'USDT' },
    logoSlug: 'tether',
    pythFeedId: '0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b' as Hex,
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    category: 'crypto',
    rank: 4,
    cexPair: { base: 'USDC', quote: 'USDT' },
    logoSlug: 'usd-coin',
    pythFeedId: '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a' as Hex,
  },
  {
    symbol: 'BNB',
    name: 'BNB',
    category: 'crypto',
    rank: 5,
    cexPair: { base: 'BNB', quote: 'USDT' },
    logoSlug: 'binance-coin',
    pythFeedId: '0x2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f' as Hex,
  },
  {
    symbol: 'SOL',
    name: 'Solana',
    category: 'crypto',
    rank: 6,
    cexPair: { base: 'SOL', quote: 'USDT' },
    logoSlug: 'solana',
    pythFeedId: '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d' as Hex,
  },
  {
    symbol: 'XRP',
    name: 'XRP',
    category: 'crypto',
    rank: 7,
    cexPair: { base: 'XRP', quote: 'USDT' },
    logoSlug: 'xrp',
    pythFeedId: '0xec5d399846a9209f3fe5881d70aae9268c94339ff9817e8d18ff19fa05eea1c8' as Hex,
  },
  {
    symbol: 'DOGE',
    name: 'Dogecoin',
    category: 'crypto',
    rank: 8,
    cexPair: { base: 'DOGE', quote: 'USDT' },
    logoSlug: 'dogecoin',
    pythFeedId: '0xdcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c' as Hex,
  },
  {
    symbol: 'ADA',
    name: 'Cardano',
    category: 'crypto',
    rank: 9,
    cexPair: { base: 'ADA', quote: 'USDT' },
    logoSlug: 'cardano',
    pythFeedId: '0x2a01deaec9e51a579277b34b122399984d0bbf57e2458a7e42fecd2829867a0d' as Hex,
  },
  {
    symbol: 'TRX',
    name: 'TRON',
    category: 'crypto',
    rank: 10,
    cexPair: { base: 'TRX', quote: 'USDT' },
    logoSlug: 'tron',
    pythFeedId: '0x67aed5a24fdad045475e7195c98a98aea119c763f272d4523f5bac93a4f33c2b' as Hex,
  },
  {
    symbol: 'AVAX',
    name: 'Avalanche',
    category: 'crypto',
    rank: 11,
    cexPair: { base: 'AVAX', quote: 'USDT' },
    logoSlug: 'avalanche',
    pythFeedId: '0x93da3352f9f1d105fdfe4971cfa80e9dd777bfc5d0f683ebb6e1294b92137bb7' as Hex,
  },
  {
    symbol: 'LINK',
    name: 'Chainlink',
    category: 'crypto',
    rank: 12,
    cexPair: { base: 'LINK', quote: 'USDT' },
    logoSlug: 'chainlink',
    pythFeedId: '0x8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221' as Hex,
  },
  {
    symbol: 'MATIC',
    name: 'Polygon',
    category: 'crypto',
    rank: 13,
    cexPair: { base: 'MATIC', quote: 'USDT' },
    logoSlug: 'polygon',
    pythFeedId: null,
  },
  {
    symbol: 'TON',
    name: 'Toncoin',
    category: 'crypto',
    rank: 14,
    cexPair: { base: 'TON', quote: 'USDT' },
    logoSlug: 'toncoin',
    pythFeedId: '0x8963217838ab4cf5cadc172203c1f0b763fbaa45f346d8ee50ba994bbcac3026' as Hex,
  },
  {
    symbol: 'DOT',
    name: 'Polkadot',
    category: 'crypto',
    rank: 15,
    cexPair: { base: 'DOT', quote: 'USDT' },
    logoSlug: 'polkadot',
    pythFeedId: '0xca3eed9b267293f6595901c734c7525ce8ef49adafe8284606ceb307afa2ca5b' as Hex,
  },
  {
    symbol: 'SHIB',
    name: 'Shiba Inu',
    category: 'crypto',
    rank: 16,
    cexPair: { base: 'SHIB', quote: 'USDT' },
    logoSlug: 'shiba-inu',
    pythFeedId: '0xf0d57deca57b3da2fe63a493f4c25925fdfd8edf834b20f93e1f84dbd1504d4a' as Hex,
  },
  {
    symbol: 'LTC',
    name: 'Litecoin',
    category: 'crypto',
    rank: 17,
    cexPair: { base: 'LTC', quote: 'USDT' },
    logoSlug: 'litecoin',
    pythFeedId: '0x6e3f3fa8253588df9326580180233eb791e03b443a3ba7a1d892e73874e19a54' as Hex,
  },
  {
    symbol: 'BCH',
    name: 'Bitcoin Cash',
    category: 'crypto',
    rank: 18,
    cexPair: { base: 'BCH', quote: 'USDT' },
    logoSlug: 'bitcoin-cash',
    pythFeedId: '0x3dd2b63686a450ec7290df3a1e0b583c0481f651351edfa7636f39aed55cf8a3' as Hex,
  },
  {
    symbol: 'UNI',
    name: 'Uniswap',
    category: 'crypto',
    rank: 19,
    cexPair: { base: 'UNI', quote: 'USDT' },
    logoSlug: 'uniswap',
    pythFeedId: '0x78d185a741d07edb3412b09008b7c5cfb9bbbd7d568bf00ba737b456ba171501' as Hex,
  },
  {
    symbol: 'ATOM',
    name: 'Cosmos',
    category: 'crypto',
    rank: 20,
    cexPair: { base: 'ATOM', quote: 'USDT' },
    logoSlug: 'cosmos',
    pythFeedId: '0xb00b60f88b03a6a625a8d1c048c3f66653edf217439983d037e7222c4e612819' as Hex,
  },
  {
    symbol: 'NEAR',
    name: 'NEAR Protocol',
    category: 'crypto',
    rank: 21,
    cexPair: { base: 'NEAR', quote: 'USDT' },
    logoSlug: 'near-protocol',
    pythFeedId: '0xc415de8d2eba7db216527dff4b60e8f3a5311c740dadb233e13e12547e226750' as Hex,
  },
  {
    symbol: 'APT',
    name: 'Aptos',
    category: 'crypto',
    rank: 22,
    cexPair: { base: 'APT', quote: 'USDT' },
    logoSlug: 'aptos',
    pythFeedId: '0x03ae4db29ed4ae33d323568895aa00337e658e348b37509f5372ae51f0af00d5' as Hex,
  },
  {
    symbol: 'XLM',
    name: 'Stellar',
    category: 'crypto',
    rank: 23,
    cexPair: { base: 'XLM', quote: 'USDT' },
    logoSlug: 'stellar',
    pythFeedId: '0xb7a8eba68a997cd0210c2e1e4ee811ad2d174b3611c22d9ebf16f4cb7e9ba850' as Hex,
  },
  {
    symbol: 'ETC',
    name: 'Ethereum Classic',
    category: 'crypto',
    rank: 24,
    cexPair: { base: 'ETC', quote: 'USDT' },
    logoSlug: 'ethereum-classic',
    pythFeedId: '0x7f5cc8d963fc5b3d2ae41fe5685ada89fd4f14b435f8050f28c7fd409f40c2d8' as Hex,
  },
  {
    symbol: 'FIL',
    name: 'Filecoin',
    category: 'crypto',
    rank: 25,
    cexPair: { base: 'FIL', quote: 'USDT' },
    logoSlug: 'filecoin',
    pythFeedId: '0x150ac9b959aee0051e4091f0ef5216d941f590e1c5e7f91cf7635b5c11628c0e' as Hex,
  },
  {
    symbol: 'ARB',
    name: 'Arbitrum',
    category: 'crypto',
    rank: 26,
    cexPair: { base: 'ARB', quote: 'USDT' },
    logoSlug: 'arbitrum',
    pythFeedId: '0x3fa4252848f9f0a1480be62745a4629d9eb1322aebab8a791e344b3b9c1adcf5' as Hex,
  },
  {
    symbol: 'HBAR',
    name: 'Hedera',
    category: 'crypto',
    rank: 27,
    cexPair: { base: 'HBAR', quote: 'USDT' },
    logoSlug: 'hedera-hashgraph',
    pythFeedId: '0x3728e591097635310e6341af53db8b7ee42da9b3a8d918f9463ce9cca886dfbd' as Hex,
  },
  {
    symbol: 'ICP',
    name: 'Internet Computer',
    category: 'crypto',
    rank: 28,
    cexPair: { base: 'ICP', quote: 'USDT' },
    logoSlug: 'internet-computer',
    pythFeedId: '0xc9907d786c5821547777780a1e4f89484f3417cb14dd244f2b0a34ea7a554d67' as Hex,
  },
  {
    symbol: 'IMX',
    name: 'Immutable',
    category: 'crypto',
    rank: 29,
    cexPair: { base: 'IMX', quote: 'USDT' },
    logoSlug: 'immutable-x',
    pythFeedId: '0x941320a8989414874de5aa2fc340a75d5ed91fdff1613dd55f83844d52ea63a2' as Hex,
  },
  {
    symbol: 'OP',
    name: 'Optimism',
    category: 'crypto',
    rank: 30,
    cexPair: { base: 'OP', quote: 'USDT' },
    logoSlug: 'optimism',
    pythFeedId: '0x385f64d993f7b77d8182ed5003d97c60aa3361f3cecfe711544d2d59165e9bdf' as Hex,
  },
  {
    symbol: 'INJ',
    name: 'Injective',
    category: 'crypto',
    rank: 31,
    cexPair: { base: 'INJ', quote: 'USDT' },
    logoSlug: 'injective-protocol',
    pythFeedId: '0x7a5bc1d2b56ad029048cd63964b3ad2776eadf812edc1a43a31406cb54bff592' as Hex,
  },
  {
    symbol: 'TIA',
    name: 'Celestia',
    category: 'crypto',
    rank: 32,
    cexPair: { base: 'TIA', quote: 'USDT' },
    logoSlug: 'celestia',
    pythFeedId: '0x09f7c1d7dfbb7df2b8fe3d3d87ee94a2259d212da4f30c1f0540d066dfa44723' as Hex,
  },
  {
    symbol: 'SUI',
    name: 'Sui',
    category: 'crypto',
    rank: 33,
    cexPair: { base: 'SUI', quote: 'USDT' },
    logoSlug: 'sui',
    pythFeedId: '0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744' as Hex,
  },
  {
    symbol: 'SEI',
    name: 'Sei',
    category: 'crypto',
    rank: 34,
    cexPair: { base: 'SEI', quote: 'USDT' },
    logoSlug: 'sei-network',
    pythFeedId: '0x53614f1cb0c031d4af66c04cb9c756234adad0e1cee85303795091499a4084eb' as Hex,
  },
  {
    symbol: 'PEPE',
    name: 'Pepe',
    category: 'crypto',
    rank: 35,
    cexPair: { base: 'PEPE', quote: 'USDT' },
    logoSlug: 'pepe',
    pythFeedId: '0xd69731a2e74ac1ce884fc3890f7ee324b6deb66147055249568869ed700882e4' as Hex,
  },
  {
    symbol: 'WIF',
    name: 'dogwifhat',
    category: 'crypto',
    rank: 36,
    cexPair: { base: 'WIF', quote: 'USDT' },
    logoSlug: 'dogwifcoin',
    pythFeedId: '0x4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc' as Hex,
  },
  {
    symbol: 'BONK',
    name: 'Bonk',
    category: 'crypto',
    rank: 37,
    cexPair: { base: 'BONK', quote: 'USDT' },
    logoSlug: 'bonk1',
    pythFeedId: '0x72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419' as Hex,
  },
  {
    symbol: 'JUP',
    name: 'Jupiter',
    category: 'crypto',
    rank: 38,
    cexPair: { base: 'JUP', quote: 'USDT' },
    logoSlug: 'jupiter-ag',
    pythFeedId: '0x0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996' as Hex,
  },
  {
    symbol: 'RNDR',
    name: 'Render',
    category: 'crypto',
    rank: 39,
    cexPair: { base: 'RNDR', quote: 'USDT' },
    logoSlug: 'render-token',
    pythFeedId: null,
  },
  {
    symbol: 'AAVE',
    name: 'Aave',
    category: 'crypto',
    rank: 40,
    cexPair: { base: 'AAVE', quote: 'USDT' },
    logoSlug: 'aave',
    pythFeedId: '0x2b9ab1e972a281585084148ba1389800799bd4be63b957507db1349314e47445' as Hex,
  },
  {
    symbol: 'PYTH',
    name: 'Pyth Network',
    category: 'crypto',
    rank: 41,
    cexPair: { base: 'PYTH', quote: 'USDT' },
    logoSlug: 'pyth-network',
    pythFeedId: '0x0bbf28e9a841a1cc788f6a361b17ca072d0ea3098a1e5df1c3922d06719579ff' as Hex,
  },
  {
    symbol: 'JTO',
    name: 'Jito',
    category: 'crypto',
    rank: 42,
    cexPair: { base: 'JTO', quote: 'USDT' },
    logoSlug: 'jito-governance-token',
    pythFeedId: '0xb43660a5f790c69354b0729a5ef9d50d68f1df92107540210b9cccba1f947cc2' as Hex,
  },
  {
    symbol: 'STX',
    name: 'Stacks',
    category: 'crypto',
    rank: 43,
    cexPair: { base: 'STX', quote: 'USDT' },
    logoSlug: 'stacks',
    pythFeedId: '0xec7a775f46379b5e943c3526b1c8d54cd49749176b0b98e02dde68d1bd335c17' as Hex,
  },
  {
    symbol: 'GRT',
    name: 'The Graph',
    category: 'crypto',
    rank: 44,
    cexPair: { base: 'GRT', quote: 'USDT' },
    logoSlug: 'the-graph',
    pythFeedId: '0x4d1f8dae0d96236fb98e8f47471a366ec3b1732b47041781934ca3a9bb2f35e7' as Hex,
  },
  {
    symbol: 'MKR',
    name: 'Maker',
    category: 'crypto',
    rank: 45,
    cexPair: { base: 'MKR', quote: 'USDT' },
    logoSlug: 'maker',
    pythFeedId: null,
  },
  {
    symbol: 'LDO',
    name: 'Lido DAO',
    category: 'crypto',
    rank: 46,
    cexPair: { base: 'LDO', quote: 'USDT' },
    logoSlug: 'lido-dao',
    pythFeedId: '0xc63e2a7f37a04e5e614c07238bedb25dcc38927fba8fe890597a593c0b2fa4ad' as Hex,
  },
  {
    symbol: 'ALGO',
    name: 'Algorand',
    category: 'crypto',
    rank: 47,
    cexPair: { base: 'ALGO', quote: 'USDT' },
    logoSlug: 'algorand',
    pythFeedId: '0xfa17ceaf30d19ba51112fdcc750cc83454776f47fb0112e4af07f15f4bb1ebc0' as Hex,
  },
  {
    symbol: 'XMR',
    name: 'Monero',
    category: 'crypto',
    rank: 48,
    cexPair: { base: 'XMR', quote: 'USDT' },
    logoSlug: 'monero',
    pythFeedId: '0x46b8cc9347f04391764a0361e0b17c3ba394b001e7c304f7650f6376e37c321d' as Hex,
  },
  {
    symbol: 'KAS',
    name: 'Kaspa',
    category: 'crypto',
    rank: 49,
    cexPair: { base: 'KAS', quote: 'USDT' },
    logoSlug: 'kaspa',
    pythFeedId: '0xdfd3cb51a9d39fde35a3ff6177b426def03ed48d45008248f22827d8bf50cab4' as Hex,
  },
  {
    symbol: 'FTM',
    name: 'Fantom',
    category: 'crypto',
    rank: 50,
    cexPair: { base: 'FTM', quote: 'USDT' },
    logoSlug: 'fantom',
    pythFeedId: null,
  },
  {
    symbol: 'EOS',
    name: 'EOS',
    category: 'crypto',
    rank: 51,
    cexPair: { base: 'EOS', quote: 'USDT' },
    logoSlug: 'eos',
    pythFeedId: null,
  },
  {
    symbol: 'FLOW',
    name: 'Flow',
    category: 'crypto',
    rank: 52,
    cexPair: { base: 'FLOW', quote: 'USDT' },
    logoSlug: 'flow',
    pythFeedId: '0x2fb245b9a84554a0f15aa123cbb5f64cd263b59e9a87d80148cbffab50c69f30' as Hex,
  },
  {
    symbol: 'EGLD',
    name: 'MultiversX',
    category: 'crypto',
    rank: 53,
    cexPair: { base: 'EGLD', quote: 'USDT' },
    logoSlug: 'elrond-erd-2',
    pythFeedId: '0xee326a761a4b53629a29fc64bf47dda18cb2eea0bef22da7144dbdc130d112fc' as Hex,
  },
  {
    symbol: 'XTZ',
    name: 'Tezos',
    category: 'crypto',
    rank: 54,
    cexPair: { base: 'XTZ', quote: 'USDT' },
    logoSlug: 'tezos',
    pythFeedId: '0x0affd4b8ad136a21d79bc82450a325ee12ff55a235abc242666e423b8bcffd03' as Hex,
  },
  {
    symbol: 'SAND',
    name: 'The Sandbox',
    category: 'crypto',
    rank: 55,
    cexPair: { base: 'SAND', quote: 'USDT' },
    logoSlug: 'the-sandbox',
    pythFeedId: '0xcb7a1d45139117f8d3da0a4b67264579aa905e3b124efede272634f094e1e9d1' as Hex,
  },
  {
    symbol: 'MANA',
    name: 'Decentraland',
    category: 'crypto',
    rank: 56,
    cexPair: { base: 'MANA', quote: 'USDT' },
    logoSlug: 'decentraland',
    pythFeedId: '0x1dfffdcbc958d732750f53ff7f06d24bb01364b3f62abea511a390c74b8d16a5' as Hex,
  },
  {
    symbol: 'CRV',
    name: 'Curve DAO',
    category: 'crypto',
    rank: 57,
    cexPair: { base: 'CRV', quote: 'USDT' },
    logoSlug: 'curve-dao-token',
    pythFeedId: '0xa19d04ac696c7a6616d291c7e5d1377cc8be437c327b75adb5dc1bad745fcae8' as Hex,
  },
  {
    symbol: 'SNX',
    name: 'Synthetix',
    category: 'crypto',
    rank: 58,
    cexPair: { base: 'SNX', quote: 'USDT' },
    logoSlug: 'synthetix-network-token',
    pythFeedId: '0x39d020f60982ed892abbcd4a06a276a9f9b7bfbce003204c110b6e488f502da3' as Hex,
  },
  {
    symbol: 'COMP',
    name: 'Compound',
    category: 'crypto',
    rank: 59,
    cexPair: { base: 'COMP', quote: 'USDT' },
    logoSlug: 'compound-governance-token',
    pythFeedId: '0x4a8e42861cabc5ecb50996f92e7cfa2bce3fd0a2423b0c44c9b423fb2bd25478' as Hex,
  },
  {
    symbol: 'ENA',
    name: 'Ethena',
    category: 'crypto',
    rank: 60,
    cexPair: { base: 'ENA', quote: 'USDT' },
    logoSlug: 'ethena',
    pythFeedId: '0xb7910ba7322db020416fcac28b48c01212fd9cc8fbcbaf7d30477ed8605f6bd4' as Hex,
  },
  {
    symbol: 'ENS',
    name: 'Ethereum Name Service',
    category: 'crypto',
    rank: 61,
    cexPair: { base: 'ENS', quote: 'USDT' },
    logoSlug: 'ethereum-name-service',
    pythFeedId: '0xb98ab6023650bd2edc026b983fb7c2f8fa1020286f1ba6ecf3f4322cd83b72a6' as Hex,
  },
  {
    symbol: 'WLD',
    name: 'Worldcoin',
    category: 'crypto',
    rank: 62,
    cexPair: { base: 'WLD', quote: 'USDT' },
    logoSlug: 'worldcoin-wld',
    pythFeedId: '0xd6835ad1f773de4a378115eb6824bd0c0e42d84d1c84d9750e853fb6b6c7794a' as Hex,
  },
  {
    symbol: 'DYDX',
    name: 'dYdX',
    category: 'crypto',
    rank: 63,
    cexPair: { base: 'DYDX', quote: 'USDT' },
    logoSlug: 'dydx',
    pythFeedId: '0x6489800bb8974169adfe35937bf6736507097d13c190d760c557108c7e93a81b' as Hex,
  },
  {
    symbol: 'GALA',
    name: 'Gala',
    category: 'crypto',
    rank: 64,
    cexPair: { base: 'GALA', quote: 'USDT' },
    logoSlug: 'gala',
    pythFeedId: '0x0781209c28fda797616212b7f94d77af3a01f3e94a5d421760aef020cf2bcb51' as Hex,
  },
  {
    symbol: 'AXS',
    name: 'Axie Infinity',
    category: 'crypto',
    rank: 65,
    cexPair: { base: 'AXS', quote: 'USDT' },
    logoSlug: 'axie-infinity',
    pythFeedId: '0xb7e3904c08ddd9c0c10c6d207d390fd19e87eb6aab96304f571ed94caebdefa0' as Hex,
  },
  {
    symbol: 'CHZ',
    name: 'Chiliz',
    category: 'crypto',
    rank: 66,
    cexPair: { base: 'CHZ', quote: 'USDT' },
    logoSlug: 'chiliz',
    pythFeedId: '0xe799f456b358a2534aa1b45141d454ac04b444ed23b1440b778549bb758f2b5c' as Hex,
  },
  {
    symbol: 'ORDI',
    name: 'Ordinals',
    category: 'crypto',
    rank: 67,
    cexPair: { base: 'ORDI', quote: 'USDT' },
    logoSlug: 'ordinals',
    pythFeedId: '0x193c739db502aadcef37c2589738b1e37bdb257d58cf1ab3c7ebc8e6df4e3ec0' as Hex,
  },
  {
    symbol: 'STRK',
    name: 'Starknet',
    category: 'crypto',
    rank: 68,
    cexPair: { base: 'STRK', quote: 'USDT' },
    logoSlug: 'starknet',
    pythFeedId: '0x6a182399ff70ccf3e06024898942028204125a819e519a335ffa4579e66cd870' as Hex,
  },
  {
    symbol: 'BLUR',
    name: 'Blur',
    category: 'crypto',
    rank: 69,
    cexPair: { base: 'BLUR', quote: 'USDT' },
    logoSlug: 'blur',
    pythFeedId: '0x856aac602516addee497edf6f50d39e8c95ae5fb0da1ed434a8c2ab9c3e877e9' as Hex,
  },
  {
    symbol: 'FLOKI',
    name: 'Floki',
    category: 'crypto',
    rank: 70,
    cexPair: { base: 'FLOKI', quote: 'USDT' },
    logoSlug: 'floki-inu',
    pythFeedId: '0x6b1381ce7e874dc5410b197ac8348162c0dd6c0d4c9cd6322672d6c2b1d58293' as Hex,
  },
  {
    symbol: 'HYPE',
    name: 'Hyperliquid',
    category: 'crypto',
    rank: 71,
    cexPair: { base: 'HYPE', quote: 'USDT' },
    logoSlug: 'hyperliquid',
    pythFeedId: '0x4279e31cc369bbcc2faf022b382b080e32a8e689ff20fbc530d2a603eb6cd98b' as Hex,
  },
  {
    symbol: 'USDE',
    name: 'Ethena USDe',
    category: 'crypto',
    rank: 72,
    cexPair: { base: 'USDE', quote: 'USDT' },
    logoSlug: 'ethena-usde',
    pythFeedId: '0x6ec879b1e9963de5ee97e9c8710b742d6228252a5e2ca12d4ae81d7fe5ee8c5d' as Hex,
  },
  {
    symbol: 'DAI',
    name: 'Dai',
    category: 'crypto',
    rank: 73,
    cexPair: { base: 'DAI', quote: 'USDT' },
    logoSlug: 'multi-collateral-dai',
    pythFeedId: '0xb0948a5e5313200c632b51bb5ca32f6de0d36e9950a942d19751e833f70dabfd' as Hex,
  },
  {
    symbol: 'RUNE',
    name: 'THORChain',
    category: 'crypto',
    rank: 74,
    cexPair: { base: 'RUNE', quote: 'USDT' },
    logoSlug: 'thorchain',
    pythFeedId: '0x5fcf71143bb70d41af4fa9aa1287e2efd3c5911cee59f909f915c9f61baacb1e' as Hex,
  },
  {
    symbol: 'AR',
    name: 'Arweave',
    category: 'crypto',
    rank: 75,
    cexPair: { base: 'AR', quote: 'USDT' },
    logoSlug: 'arweave',
    pythFeedId: '0xf610eae82767039ffc95eef8feaeddb7bbac0673cfe7773b2fde24fd1adb0aee' as Hex,
  },
  {
    symbol: 'NEO',
    name: 'Neo',
    category: 'crypto',
    rank: 76,
    cexPair: { base: 'NEO', quote: 'USDT' },
    logoSlug: 'neo',
    pythFeedId: null,
  },
  {
    symbol: 'ZEC',
    name: 'Zcash',
    category: 'crypto',
    rank: 77,
    cexPair: { base: 'ZEC', quote: 'USDT' },
    logoSlug: 'zcash',
    pythFeedId: '0xbe9b59d178f0d6a97ab4c343bff2aa69caa1eaae3e9048a65788c529b125bb24' as Hex,
  },
  {
    symbol: 'CFX',
    name: 'Conflux',
    category: 'crypto',
    rank: 78,
    cexPair: { base: 'CFX', quote: 'USDT' },
    logoSlug: 'conflux-network',
    pythFeedId: '0x8879170230c9603342f3837cf9a8e76c61791198fb1271bb2552c9af7b33c933' as Hex,
  },
  {
    symbol: 'FET',
    name: 'Fetch.ai',
    category: 'crypto',
    rank: 79,
    cexPair: { base: 'FET', quote: 'USDT' },
    logoSlug: 'fetch-ai',
    pythFeedId: '0x7da003ada32eabbac855af3d22fcf0fe692cc589f0cfd5ced63cf0bdcc742efe' as Hex,
  },
  {
    symbol: 'TAO',
    name: 'Bittensor',
    category: 'crypto',
    rank: 80,
    cexPair: { base: 'TAO', quote: 'USDT' },
    logoSlug: 'bittensor',
    pythFeedId: '0x410f41de235f2db824e562ea7ab2d3d3d4ff048316c61d629c0b93f58584e1af' as Hex,
  },
];

// ============ US Stocks ============
// Pyth Equity feeds: 0x前缀 32 字节，主网 ID。覆盖主流 60+。
const STOCKS: AssetMeta[] = [
  {
    symbol: 'NVDA',
    name: 'NVIDIA',
    category: 'stock',
    rank: 1,
    pythFeedId: '0xb1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593' as Hex,
  },
  {
    symbol: 'AAPL',
    name: 'Apple',
    category: 'stock',
    rank: 2,
    pythFeedId: '0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688' as Hex,
  },
  {
    symbol: 'MSFT',
    name: 'Microsoft',
    category: 'stock',
    rank: 3,
    pythFeedId: '0xd0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1' as Hex,
  },
  {
    symbol: 'GOOGL',
    name: 'Alphabet (Google)',
    category: 'stock',
    rank: 4,
    pythFeedId: '0x5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6' as Hex,
  },
  {
    symbol: 'AMZN',
    name: 'Amazon',
    category: 'stock',
    rank: 5,
    pythFeedId: '0xb5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a' as Hex,
  },
  {
    symbol: 'META',
    name: 'Meta Platforms',
    category: 'stock',
    rank: 6,
    pythFeedId: '0x78a3e3b8e676a8f73c439f5d749737034b139bbbe899ba5775216fba596607fe' as Hex,
  },
  {
    symbol: 'TSLA',
    name: 'Tesla',
    category: 'stock',
    rank: 7,
    pythFeedId: '0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1' as Hex,
  },
  {
    symbol: 'BRK.B',
    name: 'Berkshire Hathaway B',
    category: 'stock',
    rank: 8,
    pythFeedId: '0xe21c688b7fc65b4606a50f3635f466f6986db129bf16979875d160f9c508e8c7' as Hex,
  },
  {
    symbol: 'AVGO',
    name: 'Broadcom',
    category: 'stock',
    rank: 9,
    pythFeedId: '0xd0c9aef79b28308b256db7742a0a9b08aaa5009db67a52ea7fa30ed6853f243b' as Hex,
  },
  {
    symbol: 'V',
    name: 'Visa',
    category: 'stock',
    rank: 10,
    pythFeedId: '0xc719eb7bab9b2bc060167f1d1680eb34a29c490919072513b545b9785b73ee90' as Hex,
  },
  {
    symbol: 'JPM',
    name: 'JPMorgan Chase',
    category: 'stock',
    rank: 11,
    pythFeedId: '0x7f4f157e57bfcccd934c566df536f34933e74338fe241a5425ce561acdab164e' as Hex,
  },
  {
    symbol: 'WMT',
    name: 'Walmart',
    category: 'stock',
    rank: 12,
    pythFeedId: '0x327ae981719058e6fb44e132fb4adbf1bd5978b43db0661bfdaefd9bea0c82dc' as Hex,
  },
  {
    symbol: 'MA',
    name: 'Mastercard',
    category: 'stock',
    rank: 13,
    pythFeedId: '0x639db3fe6951d2465bd722768242e68eb0285f279cb4fa97f677ee8f80f1f1c0' as Hex,
  },
  {
    symbol: 'XOM',
    name: 'Exxon Mobil',
    category: 'stock',
    rank: 14,
    pythFeedId: '0x4a1a12070192e8db9a89ac235bb032342a390dde39389b4ee1ba8e41e7eae5d8' as Hex,
  },
  {
    symbol: 'JNJ',
    name: 'Johnson & Johnson',
    category: 'stock',
    rank: 15,
    pythFeedId: '0x12848738d5db3aef52f51d78d98fc8b8b8450ffb19fb3aeeb67d38f8c147ff63' as Hex,
  },
  {
    symbol: 'COST',
    name: 'Costco',
    category: 'stock',
    rank: 16,
    pythFeedId: '0x163f6a6406d65305e8e27965b9081ac79b0cf9529f0fcdc14fe37e65e3b6b5cb' as Hex,
  },
  {
    symbol: 'ORCL',
    name: 'Oracle',
    category: 'stock',
    rank: 17,
    pythFeedId: '0xe47ff732eaeb6b4163902bdee61572659ddf326511917b1423bae93fcdf3153c' as Hex,
  },
  {
    symbol: 'PG',
    name: 'Procter & Gamble',
    category: 'stock',
    rank: 18,
    pythFeedId: '0xad2fda41998f4e7be99a2a7b27273bd16f183d9adfc014a4f5e5d3d6cd519bf4' as Hex,
  },
  {
    symbol: 'HD',
    name: 'Home Depot',
    category: 'stock',
    rank: 19,
    pythFeedId: '0xb3a83dbe70b62241b0f916212e097465a1b31085fa30da3342dd35468ca17ca5' as Hex,
  },
  {
    symbol: 'NFLX',
    name: 'Netflix',
    category: 'stock',
    rank: 20,
    pythFeedId: '0x8376cfd7ca8bcdf372ced05307b24dced1f15b1afafdeff715664598f15a3dd2' as Hex,
  },
  {
    symbol: 'BAC',
    name: 'Bank of America',
    category: 'stock',
    rank: 21,
    pythFeedId: '0x21debc1718a4b76ff74dadf801c261d76c46afaafb74d9645b65e00b80f5ee3e' as Hex,
  },
  {
    symbol: 'AMD',
    name: 'AMD',
    category: 'stock',
    rank: 22,
    pythFeedId: '0x3622e381dbca2efd1859253763b1adc63f7f9abb8e76da1aa8e638a57ccde93e' as Hex,
  },
  {
    symbol: 'CRM',
    name: 'Salesforce',
    category: 'stock',
    rank: 23,
    pythFeedId: '0xfeff234600320f4d6bb5a01d02570a9725c1e424977f2b823f7231e6857bdae8' as Hex,
  },
  {
    symbol: 'ADBE',
    name: 'Adobe',
    category: 'stock',
    rank: 24,
    pythFeedId: '0xdf82dc88ea742bb42bdb845e5fc3ca4eef2354c67357d338221e8a696891b4ca' as Hex,
  },
  {
    symbol: 'PEP',
    name: 'PepsiCo',
    category: 'stock',
    rank: 25,
    pythFeedId: '0xbe230eddb16aad5ad273a85e581e74eb615ebf67d378f885768d9b047df0c843' as Hex,
  },
  {
    symbol: 'KO',
    name: 'Coca-Cola',
    category: 'stock',
    rank: 26,
    pythFeedId: '0x9aa471dccea36b90703325225ac76189baf7e0cc286b8843de1de4f31f9caa7d' as Hex,
  },
  {
    symbol: 'CSCO',
    name: 'Cisco',
    category: 'stock',
    rank: 27,
    pythFeedId: '0x3f4b77dd904e849f70e1e812b7811de57202b49bc47c56391275c0f45f2ec481' as Hex,
  },
  {
    symbol: 'TMO',
    name: 'Thermo Fisher',
    category: 'stock',
    rank: 28,
    pythFeedId: '0x244fdf268ed7ecfad2cf84529c46d0fcef7a643428ff4ef8b16e8dbb63e0f2d9' as Hex,
  },
  {
    symbol: 'ACN',
    name: 'Accenture',
    category: 'stock',
    rank: 29,
    pythFeedId: '0x68848984b74a7766ad23cdccd8e78e9ef339dcfb86b7e96990f27447c20967ed' as Hex,
  },
  {
    symbol: 'LIN',
    name: 'Linde',
    category: 'stock',
    rank: 30,
    pythFeedId: '0x9146c5c900d9aea9579819cf50d1ae18b54dea58eea3c9a198102e4e458e652b' as Hex,
  },
  {
    symbol: 'MCD',
    name: "McDonald's",
    category: 'stock',
    rank: 31,
    pythFeedId: '0xd3178156b7c0f6ce10d6da7d347952a672467b51708baaf1a57ffe1fb005824a' as Hex,
  },
  {
    symbol: 'ABT',
    name: 'Abbott Laboratories',
    category: 'stock',
    rank: 32,
    pythFeedId: '0x4aac40f432e039ab06236eb9bd3c58347f953d8f05b29aaac295b99cc47ee429' as Hex,
  },
  {
    symbol: 'CVX',
    name: 'Chevron',
    category: 'stock',
    rank: 33,
    pythFeedId: '0xf464e36fd4ef2f1c3dc30801a9ab470dcdaaa0af14dd3cf6ae17a7fca9e051c5' as Hex,
  },
  {
    symbol: 'WFC',
    name: 'Wells Fargo',
    category: 'stock',
    rank: 34,
    pythFeedId: '0x67ac585d05128c7b6a88660be04acd18b2bddd6308e98b71b9f3ba0f0e781296' as Hex,
  },
  {
    symbol: 'INTC',
    name: 'Intel',
    category: 'stock',
    rank: 35,
    pythFeedId: '0xc1751e085ee292b8b3b9dd122a135614485a201c35dfc653553f0e28c1baf3ff' as Hex,
  },
  {
    symbol: 'DIS',
    name: 'Walt Disney',
    category: 'stock',
    rank: 36,
    pythFeedId: '0x703e36203020ae6761e6298975764e266fb869210db9b35dd4e4225fa68217d0' as Hex,
  },
  {
    symbol: 'IBM',
    name: 'IBM',
    category: 'stock',
    rank: 37,
    pythFeedId: '0xcfd44471407f4da89d469242546bb56f5c626d5bef9bd8b9327783065b43c3ef' as Hex,
  },
  {
    symbol: 'NKE',
    name: 'Nike',
    category: 'stock',
    rank: 38,
    pythFeedId: '0x67649450b4ca4bfff97cbaf96d2fd9e40f6db148cb65999140154415e4378e14' as Hex,
  },
  {
    symbol: 'COIN',
    name: 'Coinbase',
    category: 'stock',
    rank: 39,
    pythFeedId: '0xfee33f2a978bf32dd6b662b65ba8083c6773b494f8401194ec1870c640860245' as Hex,
  },
  {
    symbol: 'MSTR',
    name: 'MicroStrategy',
    category: 'stock',
    rank: 40,
    pythFeedId: '0xe1e80251e5f5184f2195008382538e847fafc36f751896889dd3d1b1f6111f09' as Hex,
  },
  {
    symbol: 'CRCL',
    name: 'Circle',
    category: 'stock',
    rank: 41,
    pythFeedId: '0x92b8527aabe59ea2b12230f7b532769b133ffb118dfbd48ff676f14b273f1365' as Hex,
  },
  {
    symbol: 'PYPL',
    name: 'PayPal',
    category: 'stock',
    rank: 41,
    pythFeedId: '0x773c3b11f6be58e8151966a9f5832696d8cd08884ccc43ac8965a7ebea911533' as Hex,
  },
  {
    symbol: 'SQ',
    name: 'Block',
    category: 'stock',
    rank: 42,
    pythFeedId: '0x6d64b1981512c242162d6ba54f6bda35c59f726f2e075a42994fc9a33c6c2d55' as Hex,
  },
  {
    symbol: 'SHOP',
    name: 'Shopify',
    category: 'stock',
    rank: 43,
    pythFeedId: '0xc9034e8c405ba92888887bc76962b619d0f8e8bf3e12aba972af0cf64e814d5d' as Hex,
  },
  {
    symbol: 'UBER',
    name: 'Uber',
    category: 'stock',
    rank: 44,
    pythFeedId: '0xc04665f62a0eabf427a834bb5da5f27773ef7422e462d40c7468ef3e4d39d8f1' as Hex,
  },
  {
    symbol: 'ABNB',
    name: 'Airbnb',
    category: 'stock',
    rank: 45,
    pythFeedId: '0xccab508da0999d36e1ac429391d67b3ac5abf1900978ea1a56dab6b1b932168e' as Hex,
  },
  {
    symbol: 'SPOT',
    name: 'Spotify',
    category: 'stock',
    rank: 46,
    pythFeedId: '0x547ef6a2ea7db9baf50788876d3c062facaecfc896d898f37ba12efd0a13383a' as Hex,
  },
  {
    symbol: 'PLTR',
    name: 'Palantir',
    category: 'stock',
    rank: 47,
    pythFeedId: '0x11a70634863ddffb71f2b11f2cff29f73f3db8f6d0b78c49f2b5f4ad36e885f0' as Hex,
  },
  {
    symbol: 'HOOD',
    name: 'Robinhood',
    category: 'stock',
    rank: 48,
    pythFeedId: '0x306736a4035846ba15a3496eed57225b64cc19230a50d14f3ed20fd7219b7849' as Hex,
  },
  {
    symbol: 'RIVN',
    name: 'Rivian',
    category: 'stock',
    rank: 49,
    pythFeedId: '0x1e59e3164331ce560683eae0c69efe9650ff1bc834225772ddb330aa808f72f0' as Hex,
  },
  {
    symbol: 'F',
    name: 'Ford',
    category: 'stock',
    rank: 50,
    pythFeedId: '0x6c267962d46cec4a5baf6105de67ef08e1306f75973ce6eb8db8527f06e28f33' as Hex,
  },
  {
    symbol: 'GM',
    name: 'General Motors',
    category: 'stock',
    rank: 51,
    pythFeedId: '0xdf8109bbec79e2b24ce326c3be5ca0036a88ed20800ec0aa54ccc2bc7811bd3b' as Hex,
  },
  {
    symbol: 'BABA',
    name: 'Alibaba',
    category: 'stock',
    rank: 52,
    pythFeedId: '0x72bc23b1d0afb1f8edef20b7fb60982298993161bc0fd749587d6f60cd1ee9a3' as Hex,
  },
  {
    symbol: 'PDD',
    name: 'PDD Holdings',
    category: 'stock',
    rank: 53,
    pythFeedId: '0xae69f62081eb15ae4f077397871a1cf29cacf75e7b1db740aed9074c1efd3fa4' as Hex,
  },
  {
    symbol: 'JD',
    name: 'JD.com',
    category: 'stock',
    rank: 54,
    pythFeedId: '0x4c45e26d5253283ab4736b4f4ba9d0e6517679f8425ef07722dacc4b6da90750' as Hex,
  },
  {
    symbol: 'BIDU',
    name: 'Baidu',
    category: 'stock',
    rank: 55,
    pythFeedId: '0x9bdee8cb689424d01f6eaf7217adfcff65b51a30774a77fff8006c21c7059350' as Hex,
  },
  {
    symbol: 'TSM',
    name: 'Taiwan Semi',
    category: 'stock',
    rank: 56,
    pythFeedId: '0xe722560a66e4ab00522ef20a38fa2ba5d1b41f1c5404723ed895d202a7af7cc4' as Hex,
  },
  {
    symbol: 'ASML',
    name: 'ASML',
    category: 'stock',
    rank: 57,
    pythFeedId: '0x1a6e324589a0e355919fb1c0389edc3fdf4c46034626bd82aad4e47714cfa94f' as Hex,
  },
  {
    symbol: 'SMCI',
    name: 'Super Micro',
    category: 'stock',
    rank: 58,
    pythFeedId: '0x8f34132a42f8bb7a47568d77a910f97174a30719e16904e9f2915d5b2c6c2d52' as Hex,
  },
  {
    symbol: 'MU',
    name: 'Micron',
    category: 'stock',
    rank: 59,
    pythFeedId: '0x152244dc24665ca7dd3f257b8f442dc449b6346f48235b7b229268cb770dda2d' as Hex,
  },
  {
    symbol: 'QCOM',
    name: 'Qualcomm',
    category: 'stock',
    rank: 60,
    pythFeedId: '0x54350ebf587c3f14857efcfec50e5c4f6e10220770c2266e9fe85bd5e42e4022' as Hex,
  },
  {
    symbol: 'TXN',
    name: 'Texas Instruments',
    category: 'stock',
    rank: 61,
    pythFeedId: '0xc5b94c7ece9c3ac984e1439a8fac86270d0f988bbbcc838b456e2d7311754bdc' as Hex,
  },
];

// ============ ETF ============
const ETFS: AssetMeta[] = [
  {
    symbol: 'SPY',
    name: 'SPDR S&P 500',
    category: 'etf',
    rank: 1,
    pythFeedId: '0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5' as Hex,
  },
  {
    symbol: 'QQQ',
    name: 'Invesco QQQ',
    category: 'etf',
    rank: 2,
    pythFeedId: '0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d' as Hex,
  },
  {
    symbol: 'IWM',
    name: 'iShares Russell 2000',
    category: 'etf',
    rank: 3,
    pythFeedId: '0xeff690a187797aa225723345d4612abec0bf0cec1ae62347c0e7b1905d730879' as Hex,
  },
  {
    symbol: 'VTI',
    name: 'Vanguard Total Stock',
    category: 'etf',
    rank: 4,
    pythFeedId: '0x26c67e91769aeba33a09469c705a1863794014dac416e4270661f489309ae862' as Hex,
  },
  {
    symbol: 'GLD',
    name: 'SPDR Gold Shares',
    category: 'etf',
    rank: 5,
    pythFeedId: '0xe190f467043db04548200354889dfe0d9d314c08b8d4e62fabf4d5a3140fecca' as Hex,
  },
  {
    symbol: 'SLV',
    name: 'iShares Silver Trust',
    category: 'etf',
    rank: 6,
    pythFeedId: '0x6fc08c9963d266069cbd9780d98383dabf2668322a5bef0b9491e11d67e5d7e7' as Hex,
  },
  {
    symbol: 'IBIT',
    name: 'iShares Bitcoin',
    category: 'etf',
    rank: 7,
    pythFeedId: '0x9db6bc1e6e9e5e60f6884e1cd8e4399cca9d0454c6e7234ad79680cf139748f5' as Hex,
  },
  {
    symbol: 'FBTC',
    name: 'Fidelity Bitcoin',
    category: 'etf',
    rank: 8,
    pythFeedId: '0xb3a76e70a55517e0405cc90a2545de4c30413c13c532caf96a734103ec4259e9' as Hex,
  },
  {
    symbol: 'ARKK',
    name: 'ARK Innovation',
    category: 'etf',
    rank: 9,
    pythFeedId: '0xb2fe0af6c828efefda3ffda664f919825a535aa28a0f19fc238945c7aff540b1' as Hex,
  },
  {
    symbol: 'TLT',
    name: '20+ Year Treasury',
    category: 'etf',
    rank: 10,
    pythFeedId: '0x9f383d612ac09c7e6ffda24deca1502fce72e0ba58ff473fea411d9727401cc1' as Hex,
  },
  {
    symbol: 'HYG',
    name: 'iShares iBoxx HY Bond',
    category: 'etf',
    rank: 11,
    pythFeedId: '0x2077043ee3b67b9a70949c8396c110f6cf43de8e6d9e6efdcbd557a152cf2c6e' as Hex,
  },
  {
    symbol: 'EEM',
    name: 'iShares Emerging Mkts',
    category: 'etf',
    rank: 12,
    pythFeedId: '0xd407e68cec58205be82a6140a668dc42f8d9079bcf3be4aa4b41f41f7b983035' as Hex,
  },
  {
    symbol: 'XLF',
    name: 'Financial Select Sector',
    category: 'etf',
    rank: 13,
    pythFeedId: '0x06b884220ac5ac16fedfb03f84ec62b6e311241bc0af40ebfe4aedf462c18825' as Hex,
  },
  {
    symbol: 'XLE',
    name: 'Energy Select Sector',
    category: 'etf',
    rank: 14,
    pythFeedId: '0x8bf649e08e5a86129c57990556c8eec30e296069b524f4639549282bc5c07bb4' as Hex,
  },
  {
    symbol: 'XLK',
    name: 'Technology Select Sector',
    category: 'etf',
    rank: 15,
    pythFeedId: '0x343e151bf5a9055e075f84ec102186c5902ec4fd11db83cd4d8d8de5af756343' as Hex,
  },
];

// ============ FX & Commodities ============
const FX_COMMODITY: AssetMeta[] = [
  {
    symbol: 'XAU',
    name: 'Gold (Spot)',
    category: 'commodity',
    rank: 1,
    pythFeedId: '0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2' as Hex,
  },
  {
    symbol: 'XAG',
    name: 'Silver (Spot)',
    category: 'commodity',
    rank: 2,
    pythFeedId: '0xf2fb02c32b055c805e7238d628e5e9dadef274376114eb1f012337cabe93871e' as Hex,
  },
  {
    symbol: 'XPT',
    name: 'Platinum (Spot)',
    category: 'commodity',
    rank: 3,
    pythFeedId: '0x398e4bbc7cbf89d6648c21e08019d878967677753b3096799595c78f805a34e5' as Hex,
  },
  {
    symbol: 'BRENT',
    name: 'Brent Crude Oil',
    category: 'commodity',
    rank: 4,
    pythFeedId: '0x0169b040900764f5ec0d1c54861057c2696ed5dee8814c0a711c7e4385e6a151' as Hex,
  },
  {
    symbol: 'WTI',
    name: 'WTI Crude Oil',
    category: 'commodity',
    rank: 5,
    pythFeedId: '0x0a76185a3bd608f10216036ee37140112c1c296d4cba31c4e2822f44e8dc0433' as Hex,
  },
  {
    symbol: 'EURUSD',
    name: 'Euro / US Dollar',
    category: 'fx',
    rank: 1,
    pythFeedId: '0xa995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b' as Hex,
  },
  {
    symbol: 'GBPUSD',
    name: 'British Pound / USD',
    category: 'fx',
    rank: 2,
    pythFeedId: '0x84c2dde9633d93d1bcad84e7dc41c9d56578b7ec52fabedc1f335d673df0a7c1' as Hex,
  },
  {
    symbol: 'USDJPY',
    name: 'US Dollar / Yen',
    category: 'fx',
    rank: 3,
    pythFeedId: '0xef2c98c804ba503c6a707e38be4dfbb16683775f195b091252bf24693042fd52' as Hex,
  },
  {
    symbol: 'USDCNH',
    name: 'USD / Offshore CNY',
    category: 'fx',
    rank: 4,
    pythFeedId: '0xeef52e09c878ad41f6a81803e3640fe04dceea727de894edd4ea117e2e332e66' as Hex,
  },
  {
    symbol: 'AUDUSD',
    name: 'Australian / US Dollar',
    category: 'fx',
    rank: 5,
    pythFeedId: '0x67a6f93030420c1c9e3fe37c1ab6b77966af82f995944a9fefce357a22854a80' as Hex,
  },
];

/** 全部资产汇总 */
export const ASSETS: AssetMeta[] = [...CRYPTO, ...STOCKS, ...ETFS, ...FX_COMMODITY];

/** 通过 symbol 查询元数据。先查 curated ASSETS，没有再 fallback 到动态 Pyth catalog */
const ASSET_INDEX = new Map<string, AssetMeta>(ASSETS.map((a) => [a.symbol, a]));

export function getAssetMeta(symbol: string): AssetMeta | undefined {
  const curated = ASSET_INDEX.get(symbol);
  if (curated) return curated;
  return dynamicCatalog.get(symbol) ?? undefined;
}

/** 按类别筛选（仅 curated，主要用于"默认展示"列表） */
export function getAssetsByCategory(category: AssetMeta['category'] | 'all'): AssetMeta[] {
  if (category === 'all') return ASSETS.slice();
  return ASSETS.filter((a) => a.category === category);
}

/**
 * 模糊搜索：合并 curated ASSETS（精选优先）+ 动态 Pyth catalog（兜底）。
 * 同 symbol 去重，curated 胜出。
 */
export function searchAssets(query: string, category?: AssetMeta['category'] | 'all'): AssetMeta[] {
  const q = query.trim().toLowerCase();
  const pool = category && category !== 'all' ? getAssetsByCategory(category) : ASSETS;

  // Curated 部分
  let curated: AssetMeta[];
  if (!q) {
    curated = pool;
  } else {
    curated = pool.filter(
      (a) => a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q),
    );
  }

  if (!q) return curated;

  // 动态部分（仅在有 query 时合并；否则保持默认列表干净）

  const { dynamicCatalog } = require('./dynamicCatalog') as typeof import('./dynamicCatalog');
  const dynamic = dynamicCatalog.search(query, category);
  const seen = new Set(curated.map((a) => a.symbol));
  const extras = dynamic.filter((a) => !seen.has(a.symbol));
  return [...curated, ...extras];
}
