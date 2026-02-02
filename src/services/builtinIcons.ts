/**
 * 内置图标映射
 * 为常用的加密货币交易所、DEX 等提供高质量的图标 URL
 */

interface IconMapping {
  [hostname: string]: string;
}

/**
 * 来自加密货币交易所和 DEX 的官方图标
 * 数据来源: 官方网站、CoinGecko、CoinCap 等
 */
const BUILTIN_ICONS: IconMapping = {
  // CEX - 中心化交易所
  'mexc.com': 'https://s2.coinmarketcap.com/static/img/exchanges/mexc.png',
  'www.mexc.com': 'https://s2.coinmarketcap.com/static/img/exchanges/mexc.png',
  'bybit.com': 'https://s2.coinmarketcap.com/static/img/exchanges/bybit.png',
  'www.bybit.com': 'https://s2.coinmarketcap.com/static/img/exchanges/bybit.png',
  'gate.io': 'https://s2.coinmarketcap.com/static/img/exchanges/gate-io.png',
  'www.gate.io': 'https://s2.coinmarketcap.com/static/img/exchanges/gate-io.png',
  'kucoin.com': 'https://s2.coinmarketcap.com/static/img/exchanges/kucoin.png',
  'www.kucoin.com': 'https://s2.coinmarketcap.com/static/img/exchanges/kucoin.png',
  'bitget.com': 'https://s2.coinmarketcap.com/static/img/exchanges/bitget.png',
  'www.bitget.com': 'https://s2.coinmarketcap.com/static/img/exchanges/bitget.png',
  'htx.com': 'https://s2.coinmarketcap.com/static/img/exchanges/64x64/102.png',
  'www.htx.com': 'https://s2.coinmarketcap.com/static/img/exchanges/64x64/102.png',
  'huobi.com': 'https://s2.coinmarketcap.com/static/img/exchanges/64x64/102.png',
  'www.huobi.com': 'https://s2.coinmarketcap.com/static/img/exchanges/64x64/102.png',
  'kraken.com': 'https://s2.coinmarketcap.com/static/img/exchanges/kraken.png',
  'www.kraken.com': 'https://s2.coinmarketcap.com/static/img/exchanges/kraken.png',
  'okx.com': 'https://s2.coinmarketcap.com/static/img/exchanges/okx.png',
  'www.okx.com': 'https://s2.coinmarketcap.com/static/img/exchanges/okx.png',
  'binance.com': 'https://s2.coinmarketcap.com/static/img/exchanges/binance.png',
  'www.binance.com': 'https://s2.coinmarketcap.com/static/img/exchanges/binance.png',
  'coinbase.com': 'https://s2.coinmarketcap.com/static/img/exchanges/coinbase.png',
  'www.coinbase.com': 'https://s2.coinmarketcap.com/static/img/exchanges/coinbase.png',
  'upbit.com': 'https://s2.coinmarketcap.com/static/img/exchanges/64x64/351.png',
  'www.upbit.com': 'https://s2.coinmarketcap.com/static/img/exchanges/64x64/351.png',
  'crypto.com': 'https://s2.coinmarketcap.com/static/img/exchanges/64x64/1149.png',
  'www.crypto.com': 'https://s2.coinmarketcap.com/static/img/exchanges/64x64/1149.png',
  'bingx.com': 'https://s2.coinmarketcap.com/static/img/exchanges/64x64/1064.png',
  'www.bingx.com': 'https://s2.coinmarketcap.com/static/img/exchanges/64x64/1064.png',
  'bitmart.com': 'https://s2.coinmarketcap.com/static/img/exchanges/64x64/406.png',
  'www.bitmart.com': 'https://s2.coinmarketcap.com/static/img/exchanges/64x64/406.png',
  'lbank.com': 'https://s2.coinmarketcap.com/static/img/exchanges/64x64/333.png',
  'www.lbank.com': 'https://s2.coinmarketcap.com/static/img/exchanges/64x64/333.png',
  'bitstamp.net': 'https://s2.coinmarketcap.com/static/img/exchanges/64x64/70.png',
  'www.bitstamp.net': 'https://s2.coinmarketcap.com/static/img/exchanges/64x64/70.png',
  'bithumb.com': 'https://s2.coinmarketcap.com/static/img/exchanges/64x64/15.png',
  'www.bithumb.com': 'https://s2.coinmarketcap.com/static/img/exchanges/64x64/15.png',
  'xt.com': 'https://s2.coinmarketcap.com/static/img/exchanges/64x64/525.png',
  'www.xt.com': 'https://s2.coinmarketcap.com/static/img/exchanges/64x64/525.png',
  'bitflyer.com': 'https://s2.coinmarketcap.com/static/img/exchanges/64x64/139.png',
  'www.bitflyer.com': 'https://s2.coinmarketcap.com/static/img/exchanges/64x64/139.png',
  'gemini.com': 'https://s2.coinmarketcap.com/static/img/exchanges/64x64/151.png',
  'www.gemini.com': 'https://s2.coinmarketcap.com/static/img/exchanges/64x64/151.png',

  // DEX - 去中心化交易所
  // pancakeswap.finance - 官方 logo 512x512
  'pancakeswap.finance': 'https://pancakeswap.finance/logo.png',
  'www.pancakeswap.finance': 'https://pancakeswap.finance/logo.png',
  'app.uniswap.org': 'https://app.uniswap.org/favicon.ico',
  'uniswap.org': 'https://app.uniswap.org/favicon.ico',
  'sushi.com': 'https://sushi.com/favicon.ico',
  'www.sushi.com': 'https://sushi.com/favicon.ico',
  'curve.fi': 'https://curve.fi/favicon.ico',
  'app.curve.fi': 'https://curve.fi/favicon.ico',
  'balancer.fi': 'https://balancer.fi/favicon.ico',
  'app.balancer.fi': 'https://balancer.fi/favicon.ico',
  '1inch.io': 'https://1inch.com/favicon/favicon.ico',
  'app.1inch.io': 'https://1inch.com/favicon/favicon.ico',

  // Perp DEX - 永续合约 DEX
  'dydx.exchange': 'https://dydx.exchange/favicon.ico',
  'www.dydx.exchange': 'https://dydx.exchange/favicon.ico',
  'app.gmx.io': 'https://app.gmx.io/favicon.ico',
  'gmx.io': 'https://app.gmx.io/favicon.ico',
  'gainsnetwork.io': 'https://gainsnetwork.io/favicon.ico',
  'app.vertexprotocol.com': 'https://vertexprotocol.com/favicon.ico',
  'vertexprotocol.com': 'https://vertexprotocol.com/favicon.ico',
  'pro.apex.exchange': 'https://apex.exchange/favicon.ico',
  'apex.exchange': 'https://apex.exchange/favicon.ico',

  // AI 平台
  'claude.ai': 'https://claude.ai/images/favicon.png',
  'gemini.google.com': 'https://ssl.gstatic.com/images/branding/product/2x/gemini_48px.png',
  'kimi.moonshot.cn': 'https://kimi.moonshot.cn/favicon.ico',
  'chat.deepseek.com': 'https://deepseek.com/favicon.ico',
  'deepseek.com': 'https://deepseek.com/favicon.ico',

  // 链上数据
  'etherscan.io': 'https://etherscan.io/images/brandassets/etherscan-logo-circle.png',
  'www.etherscan.io': 'https://etherscan.io/images/brandassets/etherscan-logo-circle.png',
  'solscan.io': 'https://solscan.io/static/media/solana-sol-logo.b6a51d89.svg',
  'www.solscan.io': 'https://solscan.io/static/media/solana-sol-logo.b6a51d89.svg',
  'dune.com': 'https://dune.com/favicon.ico',
  'www.dune.com': 'https://dune.com/favicon.ico',
  'defillama.com': 'https://defillama.com/favicon.ico',
  'www.defillama.com': 'https://defillama.com/favicon.ico',
  'coingecko.com': 'https://www.coingecko.com/favicon.ico',
  'www.coingecko.com': 'https://www.coingecko.com/favicon.ico',
  'coinmarketcap.com': 'https://s2.coinmarketcap.com/static/img/icons/coinmarketcap-300.png',
  'deribit.com': 'https://s2.coinmarketcap.com/static/img/exchanges/64x64/522.png',
  'www.deribit.com': 'https://s2.coinmarketcap.com/static/img/exchanges/64x64/522.png',
  'tradingview.com': 'https://www.tradingview.com/favicon.ico',
  'www.tradingview.com': 'https://www.tradingview.com/favicon.ico',
  'coinglass.com': 'https://www.coinglass.com/favicon.ico',
  'www.coinglass.com': 'https://www.coinglass.com/favicon.ico',
  'coincarp.com': 'https://www.coincarp.com/favicon.ico',
  'www.coincarp.com': 'https://www.coincarp.com/favicon.ico',
  'dexscreener.com': 'https://dexscreener.com/favicon.ico',
  'www.dexscreener.com': 'https://dexscreener.com/favicon.ico',
  'debank.com': 'https://debank.com/static/media/logo.899b8287.svg',
  'www.debank.com': 'https://debank.com/static/media/logo.899b8287.svg',

  // 更多链上项目
  'ondo.finance': 'https://s2.coinmarketcap.com/static/img/coins/64x64/21156.png',
  'www.ondo.finance': 'https://s2.coinmarketcap.com/static/img/coins/64x64/21156.png',
  'asterdex.com': 'https://www.asterdex.com/favicon.ico',
  'www.asterdex.com': 'https://www.asterdex.com/favicon.ico',
  'l2beat.com': 'https://www.google.com/s2/favicons?sz=128&domain=l2beat.com',
  'www.l2beat.com': 'https://www.google.com/s2/favicons?sz=128&domain=l2beat.com',
  'nansen.ai': 'https://www.nansen.ai/favicon.ico',
  'www.nansen.ai': 'https://www.nansen.ai/favicon.ico',
  'edgex.exchange': 'https://www.edgex.exchange/favicon.ico',
  'www.edgex.exchange': 'https://www.edgex.exchange/favicon.ico',
  'gains.trade': 'https://gains.trade/favicon.ico',
  'www.gains.trade': 'https://gains.trade/favicon.ico',
  'aevo.xyz': 'https://www.aevo.xyz/favicon.ico',
  'www.aevo.xyz': 'https://www.aevo.xyz/favicon.ico',

  // L2 网络
  'arbitrum.io': 'https://arbitrum.io/favicon.ico',
  'www.arbitrum.io': 'https://arbitrum.io/favicon.ico',
  'optimism.io': 'https://optimism.io/favicon.ico',
  'www.optimism.io': 'https://optimism.io/favicon.ico',
  'base.org': 'https://base.org/favicon.ico',
  'www.base.org': 'https://base.org/favicon.io',
  'zksync.io': 'https://zksync.io/favicon.ico',
  'www.zksync.io': 'https://zksync.io/favicon.io',

  // 社交媒体
  'twitter.com': 'https://abs.twimg.com/favicons/twitter.3.ico',
  'x.com': 'https://abs.twimg.com/favicons/twitter.3.ico',
  // Discord - 让 icon.horse 自动处理 (discord.com/favicon.ico 返回 0x0)
  't.me': 'https://telegram.org/favicon.ico',
  'telegram.org': 'https://telegram.org/favicon.ico',
  'web.telegram.org': 'https://telegram.org/favicon.ico',
  'github.com': 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
  'www.github.com': 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',

  // 视频/娱乐
  'youtube.com': 'https://www.youtube.com/s/desktop/f192f63f/img/favicon_144x144.png',
  'www.youtube.com': 'https://www.youtube.com/s/desktop/f192f63f/img/favicon_144x144.png',
  'bilibili.com': 'https://www.bilibili.com/favicon.ico',
  'www.bilibili.com': 'https://www.bilibili.com/favicon.ico',
  'twitch.tv': 'https://static.twitchcdn.net/assets/favicon-32-d2926f9a79f1f5b.png',
  'www.twitch.tv': 'https://static.twitchcdn.net/assets/favicon-32-d2926f9a79f1f5b.png',

  // 中文资讯
  'www.8btc.com': 'https://www.8btc.com/favicon.ico',
  '8btc.com': 'https://www.8btc.com/favicon.ico',
  'www.odaily.com': 'https://www.odaily.com/favicon.ico',
  'odaily.com': 'https://www.odaily.com/favicon.ico',
  'www.panewslab.com': 'https://www.panewslab.com/favicon.ico',
  'panewslab.com': 'https://www.panewslab.com/favicon.ico',
  'www.blocktempo.com': 'https://www.blocktempo.com/favicon.ico',
  'blocktempo.com': 'https://www.blocktempo.com/favicon.ico',
  'www.chaincatcher.com': 'https://www.chaincatcher.com/favicon.ico',
  'chaincatcher.com': 'https://www.chaincatcher.com/favicon.ico',
  'foresightnews.pro': 'https://www.google.com/s2/favicons?sz=128&domain=foresightnews.pro',
  'www.foresightnews.pro': 'https://www.google.com/s2/favicons?sz=128&domain=foresightnews.pro',
  'www.theblockbeats.info': 'https://image.blockbeats.cn/icon/favicon.ico',
  'theblockbeats.info': 'https://image.blockbeats.cn/icon/favicon.ico',
  'cryptopanic.com': 'https://cryptopanic.com/favicon.ico',
  'followin.io': 'https://followin.io/favicon.ico',
  'decrypt.co': 'https://decrypt.co/favicon.ico',

  // 英文资讯
  'www.coindesk.com': 'https://www.coindesk.com/favicon.ico',
  'coindesk.com': 'https://www.coindesk.com/favicon.ico',
  'www.theblock.co': 'https://www.theblock.co/favicon.ico',
  'theblock.co': 'https://www.theblock.co/favicon.ico',
  'www.cointelegraph.com': 'https://cointelegraph.com/favicon.ico',
  'cointelegraph.com': 'https://cointelegraph.com/favicon.ico',
  'www.bankless.com': 'https://bankless.com/content/images/2023/10/bankless-favicon-32.png',
  'bankless.com': 'https://bankless.com/content/images/2023/10/bankless-favicon-32.png',
  'bloomberg.com': 'https://www.bloomberg.com/favicon.ico',
  'ft.com': 'https://www.ft.com/favicon.ico',
  'reuters.com': 'https://www.reuters.com/pf/resources/images/reuters/favicon/favicon-32x32.png',
  'economist.com': 'https://www.economist.com/engads/favicon.ico',
  'wsj.com': 'https://s.wsj.net/favicon.ico',
  'jin10.com': 'https://www.jin10.com/favicon.ico',
  'wallstreetcn.com': 'https://wallstreetcn.com/favicon.ico',
  'tradingeconomics.com': 'https://tradingeconomics.com/favicon.ico',
  'fred.stlouisfed.org': 'https://fred.stlouisfed.org/favicon.ico',
  'cmegroup.com': 'https://www.cmegroup.com/favicon.ico',
  'investing.com': 'https://www.investing.com/favicon.ico',

  // 中国网站
  'www.10jqka.com.cn': 'https://www.10jqka.com.cn/favicon.ico',
  '10jqka.com.cn': 'https://www.10jqka.com.cn/favicon.ico',
  'www.eastmoney.com': 'https://www.eastmoney.com/favicon.ico',
  'eastmoney.com': 'https://www.eastmoney.com/favicon.ico',
  'xueqiu.com': 'https://xueqiu.com/favicon.ico',
  'www.xueqiu.com': 'https://xueqiu.com/favicon.ico',
};

/**
 * 获取内置图标 URL
 * @param url 网站 URL
 * @returns 内置图标 URL，如果没有则返回 null
 */
export function getBuiltinIcon(url: string): string | null {
  try {
    const hostname = new URL(url).hostname;
    return BUILTIN_ICONS[hostname] || null;
  } catch {
    return null;
  }
}

/**
 * 获取所有内置图标映射（用于调试）
 */
export function getAllBuiltinIcons(): IconMapping {
  return { ...BUILTIN_ICONS };
}
