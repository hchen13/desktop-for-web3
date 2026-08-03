/**
 * Curated 资产元数据表
 *
 * 覆盖：
 *  - Crypto Top ~80（含主流 stable 作为参考）
 *  - 美股 Tier-1 60+
 *  - ETF ~15
 *  - 大宗商品 / FX 少量
 *
 * 这里只提供名称、类别、logo 与排序；交易所侧的 instrument 映射由
 * exchangeCatalog + instrumentResolver 负责。
 */

import type { AssetKey, AssetMeta } from './types';
import { assetKeyOf, migrateAssetKey } from './assetKey';

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

// ============ Crypto ============
const CRYPTO: AssetMeta[] = [
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    category: 'crypto',
    rank: 1,
    cexPair: { base: 'BTC', quote: 'USDT' },
    logoSlug: 'bitcoin',
  },
  {
    symbol: 'ETH',
    name: 'Ethereum',
    category: 'crypto',
    rank: 2,
    cexPair: { base: 'ETH', quote: 'USDT' },
    logoSlug: 'ethereum',
  },
  {
    symbol: 'USDT',
    name: 'Tether',
    category: 'crypto',
    rank: 3,
    cexPair: { base: 'BTC', quote: 'USDT' },
    logoSlug: 'tether',
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    category: 'crypto',
    rank: 4,
    cexPair: { base: 'USDC', quote: 'USDT' },
    logoSlug: 'usd-coin',
  },
  {
    symbol: 'BNB',
    name: 'BNB',
    category: 'crypto',
    rank: 5,
    cexPair: { base: 'BNB', quote: 'USDT' },
    logoSlug: 'binance-coin',
  },
  {
    symbol: 'SOL',
    name: 'Solana',
    category: 'crypto',
    rank: 6,
    cexPair: { base: 'SOL', quote: 'USDT' },
    logoSlug: 'solana',
  },
  {
    symbol: 'XRP',
    name: 'XRP',
    category: 'crypto',
    rank: 7,
    cexPair: { base: 'XRP', quote: 'USDT' },
    logoSlug: 'xrp',
  },
  {
    symbol: 'DOGE',
    name: 'Dogecoin',
    category: 'crypto',
    rank: 8,
    cexPair: { base: 'DOGE', quote: 'USDT' },
    logoSlug: 'dogecoin',
  },
  {
    symbol: 'ADA',
    name: 'Cardano',
    category: 'crypto',
    rank: 9,
    cexPair: { base: 'ADA', quote: 'USDT' },
    logoSlug: 'cardano',
  },
  {
    symbol: 'TRX',
    name: 'TRON',
    category: 'crypto',
    rank: 10,
    cexPair: { base: 'TRX', quote: 'USDT' },
    logoSlug: 'tron',
  },
  {
    symbol: 'AVAX',
    name: 'Avalanche',
    category: 'crypto',
    rank: 11,
    cexPair: { base: 'AVAX', quote: 'USDT' },
    logoSlug: 'avalanche',
  },
  {
    symbol: 'LINK',
    name: 'Chainlink',
    category: 'crypto',
    rank: 12,
    cexPair: { base: 'LINK', quote: 'USDT' },
    logoSlug: 'chainlink',
  },
  {
    symbol: 'MATIC',
    name: 'Polygon',
    category: 'crypto',
    rank: 13,
    cexPair: { base: 'MATIC', quote: 'USDT' },
    logoSlug: 'polygon',
  },
  {
    symbol: 'TON',
    name: 'Toncoin',
    category: 'crypto',
    rank: 14,
    cexPair: { base: 'TON', quote: 'USDT' },
    logoSlug: 'toncoin',
  },
  {
    symbol: 'DOT',
    name: 'Polkadot',
    category: 'crypto',
    rank: 15,
    cexPair: { base: 'DOT', quote: 'USDT' },
    logoSlug: 'polkadot',
  },
  {
    symbol: 'SHIB',
    name: 'Shiba Inu',
    category: 'crypto',
    rank: 16,
    cexPair: { base: 'SHIB', quote: 'USDT' },
    logoSlug: 'shiba-inu',
  },
  {
    symbol: 'LTC',
    name: 'Litecoin',
    category: 'crypto',
    rank: 17,
    cexPair: { base: 'LTC', quote: 'USDT' },
    logoSlug: 'litecoin',
  },
  {
    symbol: 'BCH',
    name: 'Bitcoin Cash',
    category: 'crypto',
    rank: 18,
    cexPair: { base: 'BCH', quote: 'USDT' },
    logoSlug: 'bitcoin-cash',
  },
  {
    symbol: 'UNI',
    name: 'Uniswap',
    category: 'crypto',
    rank: 19,
    cexPair: { base: 'UNI', quote: 'USDT' },
    logoSlug: 'uniswap',
  },
  {
    symbol: 'ATOM',
    name: 'Cosmos',
    category: 'crypto',
    rank: 20,
    cexPair: { base: 'ATOM', quote: 'USDT' },
    logoSlug: 'cosmos',
  },
  {
    symbol: 'NEAR',
    name: 'NEAR Protocol',
    category: 'crypto',
    rank: 21,
    cexPair: { base: 'NEAR', quote: 'USDT' },
    logoSlug: 'near-protocol',
  },
  {
    symbol: 'APT',
    name: 'Aptos',
    category: 'crypto',
    rank: 22,
    cexPair: { base: 'APT', quote: 'USDT' },
    logoSlug: 'aptos',
  },
  {
    symbol: 'XLM',
    name: 'Stellar',
    category: 'crypto',
    rank: 23,
    cexPair: { base: 'XLM', quote: 'USDT' },
    logoSlug: 'stellar',
  },
  {
    symbol: 'ETC',
    name: 'Ethereum Classic',
    category: 'crypto',
    rank: 24,
    cexPair: { base: 'ETC', quote: 'USDT' },
    logoSlug: 'ethereum-classic',
  },
  {
    symbol: 'FIL',
    name: 'Filecoin',
    category: 'crypto',
    rank: 25,
    cexPair: { base: 'FIL', quote: 'USDT' },
    logoSlug: 'filecoin',
  },
  {
    symbol: 'ARB',
    name: 'Arbitrum',
    category: 'crypto',
    rank: 26,
    cexPair: { base: 'ARB', quote: 'USDT' },
    logoSlug: 'arbitrum',
  },
  {
    symbol: 'HBAR',
    name: 'Hedera',
    category: 'crypto',
    rank: 27,
    cexPair: { base: 'HBAR', quote: 'USDT' },
    logoSlug: 'hedera-hashgraph',
  },
  {
    symbol: 'ICP',
    name: 'Internet Computer',
    category: 'crypto',
    rank: 28,
    cexPair: { base: 'ICP', quote: 'USDT' },
    logoSlug: 'internet-computer',
  },
  {
    symbol: 'IMX',
    name: 'Immutable',
    category: 'crypto',
    rank: 29,
    cexPair: { base: 'IMX', quote: 'USDT' },
    logoSlug: 'immutable-x',
  },
  {
    symbol: 'OP',
    name: 'Optimism',
    category: 'crypto',
    rank: 30,
    cexPair: { base: 'OP', quote: 'USDT' },
    logoSlug: 'optimism',
  },
  {
    symbol: 'INJ',
    name: 'Injective',
    category: 'crypto',
    rank: 31,
    cexPair: { base: 'INJ', quote: 'USDT' },
    logoSlug: 'injective-protocol',
  },
  {
    symbol: 'TIA',
    name: 'Celestia',
    category: 'crypto',
    rank: 32,
    cexPair: { base: 'TIA', quote: 'USDT' },
    logoSlug: 'celestia',
  },
  {
    symbol: 'SUI',
    name: 'Sui',
    category: 'crypto',
    rank: 33,
    cexPair: { base: 'SUI', quote: 'USDT' },
    logoSlug: 'sui',
  },
  {
    symbol: 'SEI',
    name: 'Sei',
    category: 'crypto',
    rank: 34,
    cexPair: { base: 'SEI', quote: 'USDT' },
    logoSlug: 'sei-network',
  },
  {
    symbol: 'PEPE',
    name: 'Pepe',
    category: 'crypto',
    rank: 35,
    cexPair: { base: 'PEPE', quote: 'USDT' },
    logoSlug: 'pepe',
  },
  {
    symbol: 'WIF',
    name: 'dogwifhat',
    category: 'crypto',
    rank: 36,
    cexPair: { base: 'WIF', quote: 'USDT' },
    logoSlug: 'dogwifcoin',
  },
  {
    symbol: 'BONK',
    name: 'Bonk',
    category: 'crypto',
    rank: 37,
    cexPair: { base: 'BONK', quote: 'USDT' },
    logoSlug: 'bonk1',
  },
  {
    symbol: 'JUP',
    name: 'Jupiter',
    category: 'crypto',
    rank: 38,
    cexPair: { base: 'JUP', quote: 'USDT' },
    logoSlug: 'jupiter-ag',
  },
  {
    symbol: 'RNDR',
    name: 'Render',
    category: 'crypto',
    rank: 39,
    cexPair: { base: 'RNDR', quote: 'USDT' },
    logoSlug: 'render-token',
  },
  {
    symbol: 'AAVE',
    name: 'Aave',
    category: 'crypto',
    rank: 40,
    cexPair: { base: 'AAVE', quote: 'USDT' },
    logoSlug: 'aave',
  },
  {
    symbol: 'PYTH',
    name: 'Pyth Network',
    category: 'crypto',
    rank: 41,
    cexPair: { base: 'PYTH', quote: 'USDT' },
    logoSlug: 'pyth-network',
  },
  {
    symbol: 'JTO',
    name: 'Jito',
    category: 'crypto',
    rank: 42,
    cexPair: { base: 'JTO', quote: 'USDT' },
    logoSlug: 'jito-governance-token',
  },
  {
    symbol: 'STX',
    name: 'Stacks',
    category: 'crypto',
    rank: 43,
    cexPair: { base: 'STX', quote: 'USDT' },
    logoSlug: 'stacks',
  },
  {
    symbol: 'GRT',
    name: 'The Graph',
    category: 'crypto',
    rank: 44,
    cexPair: { base: 'GRT', quote: 'USDT' },
    logoSlug: 'the-graph',
  },
  {
    symbol: 'MKR',
    name: 'Maker',
    category: 'crypto',
    rank: 45,
    cexPair: { base: 'MKR', quote: 'USDT' },
    logoSlug: 'maker',
  },
  {
    symbol: 'LDO',
    name: 'Lido DAO',
    category: 'crypto',
    rank: 46,
    cexPair: { base: 'LDO', quote: 'USDT' },
    logoSlug: 'lido-dao',
  },
  {
    symbol: 'ALGO',
    name: 'Algorand',
    category: 'crypto',
    rank: 47,
    cexPair: { base: 'ALGO', quote: 'USDT' },
    logoSlug: 'algorand',
  },
  {
    symbol: 'XMR',
    name: 'Monero',
    category: 'crypto',
    rank: 48,
    cexPair: { base: 'XMR', quote: 'USDT' },
    logoSlug: 'monero',
  },
  {
    symbol: 'KAS',
    name: 'Kaspa',
    category: 'crypto',
    rank: 49,
    cexPair: { base: 'KAS', quote: 'USDT' },
    logoSlug: 'kaspa',
  },
  {
    symbol: 'FTM',
    name: 'Fantom',
    category: 'crypto',
    rank: 50,
    cexPair: { base: 'FTM', quote: 'USDT' },
    logoSlug: 'fantom',
  },
  {
    symbol: 'EOS',
    name: 'EOS',
    category: 'crypto',
    rank: 51,
    cexPair: { base: 'EOS', quote: 'USDT' },
    logoSlug: 'eos',
  },
  {
    symbol: 'FLOW',
    name: 'Flow',
    category: 'crypto',
    rank: 52,
    cexPair: { base: 'FLOW', quote: 'USDT' },
    logoSlug: 'flow',
  },
  {
    symbol: 'EGLD',
    name: 'MultiversX',
    category: 'crypto',
    rank: 53,
    cexPair: { base: 'EGLD', quote: 'USDT' },
    logoSlug: 'elrond-erd-2',
  },
  {
    symbol: 'XTZ',
    name: 'Tezos',
    category: 'crypto',
    rank: 54,
    cexPair: { base: 'XTZ', quote: 'USDT' },
    logoSlug: 'tezos',
  },
  {
    symbol: 'SAND',
    name: 'The Sandbox',
    category: 'crypto',
    rank: 55,
    cexPair: { base: 'SAND', quote: 'USDT' },
    logoSlug: 'the-sandbox',
  },
  {
    symbol: 'MANA',
    name: 'Decentraland',
    category: 'crypto',
    rank: 56,
    cexPair: { base: 'MANA', quote: 'USDT' },
    logoSlug: 'decentraland',
  },
  {
    symbol: 'CRV',
    name: 'Curve DAO',
    category: 'crypto',
    rank: 57,
    cexPair: { base: 'CRV', quote: 'USDT' },
    logoSlug: 'curve-dao-token',
  },
  {
    symbol: 'SNX',
    name: 'Synthetix',
    category: 'crypto',
    rank: 58,
    cexPair: { base: 'SNX', quote: 'USDT' },
    logoSlug: 'synthetix-network-token',
  },
  {
    symbol: 'COMP',
    name: 'Compound',
    category: 'crypto',
    rank: 59,
    cexPair: { base: 'COMP', quote: 'USDT' },
    logoSlug: 'compound-governance-token',
  },
  {
    symbol: 'ENA',
    name: 'Ethena',
    category: 'crypto',
    rank: 60,
    cexPair: { base: 'ENA', quote: 'USDT' },
    logoSlug: 'ethena',
  },
  {
    symbol: 'ENS',
    name: 'Ethereum Name Service',
    category: 'crypto',
    rank: 61,
    cexPair: { base: 'ENS', quote: 'USDT' },
    logoSlug: 'ethereum-name-service',
  },
  {
    symbol: 'WLD',
    name: 'Worldcoin',
    category: 'crypto',
    rank: 62,
    cexPair: { base: 'WLD', quote: 'USDT' },
    logoSlug: 'worldcoin-wld',
  },
  {
    symbol: 'DYDX',
    name: 'dYdX',
    category: 'crypto',
    rank: 63,
    cexPair: { base: 'DYDX', quote: 'USDT' },
    logoSlug: 'dydx',
  },
  {
    symbol: 'GALA',
    name: 'Gala',
    category: 'crypto',
    rank: 64,
    cexPair: { base: 'GALA', quote: 'USDT' },
    logoSlug: 'gala',
  },
  {
    symbol: 'AXS',
    name: 'Axie Infinity',
    category: 'crypto',
    rank: 65,
    cexPair: { base: 'AXS', quote: 'USDT' },
    logoSlug: 'axie-infinity',
  },
  {
    symbol: 'CHZ',
    name: 'Chiliz',
    category: 'crypto',
    rank: 66,
    cexPair: { base: 'CHZ', quote: 'USDT' },
    logoSlug: 'chiliz',
  },
  {
    symbol: 'ORDI',
    name: 'Ordinals',
    category: 'crypto',
    rank: 67,
    cexPair: { base: 'ORDI', quote: 'USDT' },
    logoSlug: 'ordinals',
  },
  {
    symbol: 'STRK',
    name: 'Starknet',
    category: 'crypto',
    rank: 68,
    cexPair: { base: 'STRK', quote: 'USDT' },
    logoSlug: 'starknet',
  },
  {
    symbol: 'BLUR',
    name: 'Blur',
    category: 'crypto',
    rank: 69,
    cexPair: { base: 'BLUR', quote: 'USDT' },
    logoSlug: 'blur',
  },
  {
    symbol: 'FLOKI',
    name: 'Floki',
    category: 'crypto',
    rank: 70,
    cexPair: { base: 'FLOKI', quote: 'USDT' },
    logoSlug: 'floki-inu',
  },
  {
    symbol: 'HYPE',
    name: 'Hyperliquid',
    category: 'crypto',
    rank: 71,
    cexPair: { base: 'HYPE', quote: 'USDT' },
    logoSlug: 'hyperliquid',
  },
  {
    symbol: 'USDE',
    name: 'Ethena USDe',
    category: 'crypto',
    rank: 72,
    cexPair: { base: 'USDE', quote: 'USDT' },
    logoSlug: 'ethena-usde',
  },
  {
    symbol: 'DAI',
    name: 'Dai',
    category: 'crypto',
    rank: 73,
    cexPair: { base: 'DAI', quote: 'USDT' },
    logoSlug: 'multi-collateral-dai',
  },
  {
    symbol: 'RUNE',
    name: 'THORChain',
    category: 'crypto',
    rank: 74,
    cexPair: { base: 'RUNE', quote: 'USDT' },
    logoSlug: 'thorchain',
  },
  {
    symbol: 'AR',
    name: 'Arweave',
    category: 'crypto',
    rank: 75,
    cexPair: { base: 'AR', quote: 'USDT' },
    logoSlug: 'arweave',
  },
  {
    symbol: 'NEO',
    name: 'Neo',
    category: 'crypto',
    rank: 76,
    cexPair: { base: 'NEO', quote: 'USDT' },
    logoSlug: 'neo',
  },
  {
    symbol: 'ZEC',
    name: 'Zcash',
    category: 'crypto',
    rank: 77,
    cexPair: { base: 'ZEC', quote: 'USDT' },
    logoSlug: 'zcash',
  },
  {
    symbol: 'CFX',
    name: 'Conflux',
    category: 'crypto',
    rank: 78,
    cexPair: { base: 'CFX', quote: 'USDT' },
    logoSlug: 'conflux-network',
  },
  {
    symbol: 'FET',
    name: 'Fetch.ai',
    category: 'crypto',
    rank: 79,
    cexPair: { base: 'FET', quote: 'USDT' },
    logoSlug: 'fetch-ai',
  },
  {
    symbol: 'TAO',
    name: 'Bittensor',
    category: 'crypto',
    rank: 80,
    cexPair: { base: 'TAO', quote: 'USDT' },
    logoSlug: 'bittensor',
  },
];

// ============ US Stocks ============
const STOCKS: AssetMeta[] = [
  {
    symbol: 'NVDA',
    name: 'NVIDIA',
    category: 'stock',
    rank: 1,
  },
  {
    symbol: 'AAPL',
    name: 'Apple',
    category: 'stock',
    rank: 2,
  },
  {
    symbol: 'MSFT',
    name: 'Microsoft',
    category: 'stock',
    rank: 3,
  },
  {
    symbol: 'GOOGL',
    name: 'Alphabet (Google)',
    category: 'stock',
    rank: 4,
  },
  {
    symbol: 'AMZN',
    name: 'Amazon',
    category: 'stock',
    rank: 5,
  },
  {
    symbol: 'META',
    name: 'Meta Platforms',
    category: 'stock',
    rank: 6,
  },
  {
    symbol: 'TSLA',
    name: 'Tesla',
    category: 'stock',
    rank: 7,
  },
  {
    symbol: 'BRK.B',
    name: 'Berkshire Hathaway B',
    category: 'stock',
    rank: 8,
  },
  {
    symbol: 'AVGO',
    name: 'Broadcom',
    category: 'stock',
    rank: 9,
  },
  {
    symbol: 'V',
    name: 'Visa',
    category: 'stock',
    rank: 10,
  },
  {
    symbol: 'JPM',
    name: 'JPMorgan Chase',
    category: 'stock',
    rank: 11,
  },
  {
    symbol: 'WMT',
    name: 'Walmart',
    category: 'stock',
    rank: 12,
  },
  {
    symbol: 'MA',
    name: 'Mastercard',
    category: 'stock',
    rank: 13,
  },
  {
    symbol: 'XOM',
    name: 'Exxon Mobil',
    category: 'stock',
    rank: 14,
  },
  {
    symbol: 'JNJ',
    name: 'Johnson & Johnson',
    category: 'stock',
    rank: 15,
  },
  {
    symbol: 'COST',
    name: 'Costco',
    category: 'stock',
    rank: 16,
  },
  {
    symbol: 'ORCL',
    name: 'Oracle',
    category: 'stock',
    rank: 17,
  },
  {
    symbol: 'PG',
    name: 'Procter & Gamble',
    category: 'stock',
    rank: 18,
  },
  {
    symbol: 'HD',
    name: 'Home Depot',
    category: 'stock',
    rank: 19,
  },
  {
    symbol: 'NFLX',
    name: 'Netflix',
    category: 'stock',
    rank: 20,
  },
  {
    symbol: 'BAC',
    name: 'Bank of America',
    category: 'stock',
    rank: 21,
  },
  {
    symbol: 'AMD',
    name: 'AMD',
    category: 'stock',
    rank: 22,
  },
  {
    symbol: 'CRM',
    name: 'Salesforce',
    category: 'stock',
    rank: 23,
  },
  {
    symbol: 'ADBE',
    name: 'Adobe',
    category: 'stock',
    rank: 24,
  },
  {
    symbol: 'PEP',
    name: 'PepsiCo',
    category: 'stock',
    rank: 25,
  },
  {
    symbol: 'KO',
    name: 'Coca-Cola',
    category: 'stock',
    rank: 26,
  },
  {
    symbol: 'CSCO',
    name: 'Cisco',
    category: 'stock',
    rank: 27,
  },
  {
    symbol: 'TMO',
    name: 'Thermo Fisher',
    category: 'stock',
    rank: 28,
  },
  {
    symbol: 'ACN',
    name: 'Accenture',
    category: 'stock',
    rank: 29,
  },
  {
    symbol: 'LIN',
    name: 'Linde',
    category: 'stock',
    rank: 30,
  },
  {
    symbol: 'MCD',
    name: "McDonald's",
    category: 'stock',
    rank: 31,
  },
  {
    symbol: 'ABT',
    name: 'Abbott Laboratories',
    category: 'stock',
    rank: 32,
  },
  {
    symbol: 'CVX',
    name: 'Chevron',
    category: 'stock',
    rank: 33,
  },
  {
    symbol: 'WFC',
    name: 'Wells Fargo',
    category: 'stock',
    rank: 34,
  },
  {
    symbol: 'INTC',
    name: 'Intel',
    category: 'stock',
    rank: 35,
  },
  {
    symbol: 'DIS',
    name: 'Walt Disney',
    category: 'stock',
    rank: 36,
  },
  {
    symbol: 'IBM',
    name: 'IBM',
    category: 'stock',
    rank: 37,
  },
  {
    symbol: 'NKE',
    name: 'Nike',
    category: 'stock',
    rank: 38,
  },
  {
    symbol: 'COIN',
    name: 'Coinbase',
    category: 'stock',
    rank: 39,
  },
  {
    symbol: 'MSTR',
    name: 'MicroStrategy',
    category: 'stock',
    rank: 40,
  },
  {
    symbol: 'CRCL',
    name: 'Circle',
    category: 'stock',
    rank: 41,
  },
  {
    symbol: 'PYPL',
    name: 'PayPal',
    category: 'stock',
    rank: 41,
  },
  {
    // Block, Inc. 已把 ticker 从 SQ 换成 XYZ；旧配置与旧缓存由 assetKey.ts 的迁移表处理
    symbol: 'XYZ',
    name: 'Block, Inc.',
    category: 'stock',
    rank: 42,
  },
  {
    symbol: 'SHOP',
    name: 'Shopify',
    category: 'stock',
    rank: 43,
  },
  {
    symbol: 'UBER',
    name: 'Uber',
    category: 'stock',
    rank: 44,
  },
  {
    symbol: 'ABNB',
    name: 'Airbnb',
    category: 'stock',
    rank: 45,
  },
  {
    symbol: 'SPOT',
    name: 'Spotify',
    category: 'stock',
    rank: 46,
  },
  {
    symbol: 'PLTR',
    name: 'Palantir',
    category: 'stock',
    rank: 47,
  },
  {
    symbol: 'HOOD',
    name: 'Robinhood',
    category: 'stock',
    rank: 48,
  },
  {
    symbol: 'RIVN',
    name: 'Rivian',
    category: 'stock',
    rank: 49,
  },
  {
    symbol: 'F',
    name: 'Ford',
    category: 'stock',
    rank: 50,
  },
  {
    symbol: 'GM',
    name: 'General Motors',
    category: 'stock',
    rank: 51,
  },
  {
    symbol: 'BABA',
    name: 'Alibaba',
    category: 'stock',
    rank: 52,
  },
  {
    symbol: 'PDD',
    name: 'PDD Holdings',
    category: 'stock',
    rank: 53,
  },
  {
    symbol: 'JD',
    name: 'JD.com',
    category: 'stock',
    rank: 54,
  },
  {
    symbol: 'BIDU',
    name: 'Baidu',
    category: 'stock',
    rank: 55,
  },
  {
    symbol: 'TSM',
    name: 'Taiwan Semi',
    category: 'stock',
    rank: 56,
  },
  {
    symbol: 'ASML',
    name: 'ASML',
    category: 'stock',
    rank: 57,
  },
  {
    symbol: 'SMCI',
    name: 'Super Micro',
    category: 'stock',
    rank: 58,
  },
  {
    symbol: 'MU',
    name: 'Micron',
    category: 'stock',
    rank: 59,
  },
  {
    symbol: 'QCOM',
    name: 'Qualcomm',
    category: 'stock',
    rank: 60,
  },
  {
    symbol: 'TXN',
    name: 'Texas Instruments',
    category: 'stock',
    rank: 61,
  },
];

// ============ ETF ============
const ETFS: AssetMeta[] = [
  {
    symbol: 'SPY',
    name: 'SPDR S&P 500',
    category: 'etf',
    rank: 1,
  },
  {
    symbol: 'QQQ',
    name: 'Invesco QQQ',
    category: 'etf',
    rank: 2,
  },
  {
    symbol: 'IWM',
    name: 'iShares Russell 2000',
    category: 'etf',
    rank: 3,
  },
  {
    symbol: 'VTI',
    name: 'Vanguard Total Stock',
    category: 'etf',
    rank: 4,
  },
  {
    symbol: 'GLD',
    name: 'SPDR Gold Shares',
    category: 'etf',
    rank: 5,
  },
  {
    symbol: 'SLV',
    name: 'iShares Silver Trust',
    category: 'etf',
    rank: 6,
  },
  {
    symbol: 'IBIT',
    name: 'iShares Bitcoin',
    category: 'etf',
    rank: 7,
  },
  {
    symbol: 'FBTC',
    name: 'Fidelity Bitcoin',
    category: 'etf',
    rank: 8,
  },
  {
    symbol: 'ARKK',
    name: 'ARK Innovation',
    category: 'etf',
    rank: 9,
  },
  {
    symbol: 'TLT',
    name: '20+ Year Treasury',
    category: 'etf',
    rank: 10,
  },
  {
    symbol: 'HYG',
    name: 'iShares iBoxx HY Bond',
    category: 'etf',
    rank: 11,
  },
  {
    symbol: 'EEM',
    name: 'iShares Emerging Mkts',
    category: 'etf',
    rank: 12,
  },
  {
    symbol: 'XLF',
    name: 'Financial Select Sector',
    category: 'etf',
    rank: 13,
  },
  {
    symbol: 'XLE',
    name: 'Energy Select Sector',
    category: 'etf',
    rank: 14,
  },
  {
    symbol: 'XLK',
    name: 'Technology Select Sector',
    category: 'etf',
    rank: 15,
  },
];

// ============ FX & Commodities ============
const FX_COMMODITY: AssetMeta[] = [
  {
    symbol: 'XAU',
    name: 'Gold (Spot)',
    category: 'commodity',
    rank: 1,
  },
  {
    symbol: 'XAG',
    name: 'Silver (Spot)',
    category: 'commodity',
    rank: 2,
  },
  {
    symbol: 'XPT',
    name: 'Platinum (Spot)',
    category: 'commodity',
    rank: 3,
  },
  {
    symbol: 'BRENT',
    name: 'Brent Crude Oil',
    category: 'commodity',
    rank: 4,
  },
  {
    symbol: 'WTI',
    name: 'WTI Crude Oil',
    category: 'commodity',
    rank: 5,
  },
  {
    symbol: 'EURUSD',
    name: 'Euro / US Dollar',
    category: 'fx',
    rank: 1,
  },
  {
    symbol: 'GBPUSD',
    name: 'British Pound / USD',
    category: 'fx',
    rank: 2,
  },
  {
    symbol: 'USDJPY',
    name: 'US Dollar / Yen',
    category: 'fx',
    rank: 3,
  },
  {
    symbol: 'USDCNH',
    name: 'USD / Offshore CNY',
    category: 'fx',
    rank: 4,
  },
  {
    symbol: 'AUDUSD',
    name: 'Australian / US Dollar',
    category: 'fx',
    rank: 5,
  },
];

/** 全部资产汇总 */
export const ASSETS: AssetMeta[] = [...CRYPTO, ...STOCKS, ...ETFS, ...FX_COMMODITY];

/**
 * AssetKey → curated 元数据。
 * symbol 索引无法区分 crypto:COIN 与 stock:COIN，凡是涉及资产身份的查询都走这里。
 */
const CURATED_BY_KEY = new Map<AssetKey, AssetMeta>(ASSETS.map((a) => [assetKeyOf(a), a]));

export function getCuratedAsset(assetKey: AssetKey): AssetMeta | undefined {
  return CURATED_BY_KEY.get(migrateAssetKey(assetKey));
}

export function curatedAssetKeys(): AssetKey[] {
  return Array.from(CURATED_BY_KEY.keys());
}
