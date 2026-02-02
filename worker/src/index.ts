/**
 * Cloudflare Worker 入口文件
 * API 代理服务，用于安全地调用需要 API KEY 的第三方服务
 */

import { handleCORS, addCORSHeaders } from './utils/cors';
import { validateRequest } from './utils/auth';
import { createRateLimitMiddleware } from './utils/rateLimit';
import { executeDuneQuery, getDuneQueryResult } from './routes/dune';
import { getGasOracle, getLatestBlock } from './routes/etherscan';
import { getQuotes } from './routes/coinmarketcap';
import { getEvents, getCategories, getCoins } from './routes/coinmarketcal';
import {
  getBlockTimeDelay,
  getGasPrice,
  getTPS,
  getActiveAddresses,
  getTVL,
  getAllMetrics,
} from './routes/blockchain-monitor';

export interface Env {
  // API Keys (通过 wrangler secret 设置)
  DUNE_API_KEY?: string;
  ETHERSCAN_API_KEY?: string;
  COINMARKETCAP_API_KEY?: string;
  COINMARKETCAL_API_KEY?: string;

  // KV Namespace (可选，用于速率限制)
  RATE_LIMIT_KV?: KVNamespace;

  // Cache API (Cloudflare Workers 自动提供)
  // cache: Cache;
}

/**
 * 路由处理
 */
async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  
  // 处理 CORS 预检请求
  const corsResponse = handleCORS(request);
  if (corsResponse) {
    return corsResponse;
  }
  
  // 验证请求来源
  if (!validateRequest(request)) {
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid request origin' },
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }
  
  // 速率限制（可选，如果有 KV）
  const rateLimitMiddleware = createRateLimitMiddleware(
    { maxRequests: 100, windowSeconds: 60 }, // 每分钟 100 次请求
    env.RATE_LIMIT_KV
  );
  const rateLimitResponse = await rateLimitMiddleware(request);
  if (rateLimitResponse) {
    return addCORSHeaders(rateLimitResponse, request);
  }
  
  // 获取缓存（Cloudflare Workers 自动提供）
  const cache = caches.default;
  
  let response: Response;
  
  try {
    // 路由分发
    if (path.startsWith('/api/blockchain-monitor')) {
      response = await handleBlockchainMonitorRoutes(request, cache);
    } else if (path.startsWith('/api/dune')) {
      response = await handleDuneRoutes(request, cache);
    } else if (path.startsWith('/api/etherscan')) {
      response = await handleEtherscanRoutes(request, cache);
    } else if (path.startsWith('/api/coinmarketcap')) {
      response = await handleCoinMarketCapRoutes(request, cache);
    } else if (path.startsWith('/api/coinmarketcal')) {
      response = await handleCoinMarketCalRoutes(request, cache);
    } else if (path === '/health') {
      response = new Response(
        JSON.stringify({
          success: true,
          message: 'Worker is healthy',
          timestamp: Date.now(),
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } else {
      response = new Response(
        JSON.stringify({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  } catch (error) {
    console.error('[Worker] Unhandled error:', error);
    response = new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
  
  // 添加 CORS 头
  return addCORSHeaders(response, request);
}

/**
 * 处理 Dune API 路由
 */
async function handleDuneRoutes(request: Request, cache: Cache | null): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  
  if (path === '/api/dune/execute' && request.method === 'POST') {
    const body = await request.json();
    return executeDuneQuery(request, body, cache);
  }
  
  if (path.startsWith('/api/dune/result/')) {
    const executionId = path.split('/').pop();
    if (executionId) {
      return getDuneQueryResult(request, executionId, cache);
    }
  }
  
  return new Response(
    JSON.stringify({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Dune endpoint not found' },
    }),
    { status: 404, headers: { 'Content-Type': 'application/json' } }
  );
}

/**
 * 处理 Etherscan API 路由
 */
async function handleEtherscanRoutes(request: Request, cache: Cache | null): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const chain = url.searchParams.get('chain') || 'ethereum';
  
  if (path === '/api/etherscan/gas-oracle' && request.method === 'GET') {
    return getGasOracle(request, chain, cache);
  }
  
  if (path === '/api/etherscan/latest-block' && request.method === 'GET') {
    return getLatestBlock(request, chain, cache);
  }
  
  return new Response(
    JSON.stringify({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Etherscan endpoint not found' },
    }),
    { status: 404, headers: { 'Content-Type': 'application/json' } }
  );
}

/**
 * 处理链上监控 API 路由
 */
async function handleBlockchainMonitorRoutes(request: Request, cache: Cache | null): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const chain = url.searchParams.get('chain') || 'eth';
  
  if ((path === '/api/blockchain-monitor/metrics' || path === '/api/blockchain-monitor/all-metrics') && request.method === 'GET') {
    return getAllMetrics(request, chain, cache);
  }
  
  if (path === '/api/blockchain-monitor/block-time-delay' && request.method === 'GET') {
    return getBlockTimeDelay(request, chain, cache);
  }
  
  if (path === '/api/blockchain-monitor/gas-price' && request.method === 'GET') {
    return getGasPrice(request, chain, cache);
  }
  
  if (path === '/api/blockchain-monitor/tps' && request.method === 'GET') {
    return getTPS(request, chain, cache);
  }
  
  if (path === '/api/blockchain-monitor/active-addresses' && request.method === 'GET') {
    return getActiveAddresses(request, chain, cache);
  }
  
  if (path === '/api/blockchain-monitor/tvl' && request.method === 'GET') {
    // TVL 接口支持不传 chain 参数，返回所有链的TVL
    const tvlChain = url.searchParams.get('chain') || null;
    return getTVL(request, tvlChain, cache);
  }
  
  return new Response(
    JSON.stringify({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Blockchain monitor endpoint not found' },
    }),
    { status: 404, headers: { 'Content-Type': 'application/json' } }
  );
}

/**
 * 处理 CoinMarketCap API 路由
 */
async function handleCoinMarketCapRoutes(request: Request, cache: Cache | null): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api/coinmarketcap/quotes' && request.method === 'GET') {
    const symbolsParam = url.searchParams.get('symbols');
    if (!symbolsParam) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: 'MISSING_PARAM', message: 'Missing symbols parameter' },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase());
    return getQuotes(request, symbols, cache);
  }

  return new Response(
    JSON.stringify({
      success: false,
      error: { code: 'NOT_FOUND', message: 'CoinMarketCap endpoint not found' },
    }),
    { status: 404, headers: { 'Content-Type': 'application/json' } }
  );
}

/**
 * 处理 CoinMarketCal API 路由
 */
async function handleCoinMarketCalRoutes(request: Request, cache: Cache | null): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api/coinmarketcal/events' && request.method === 'GET') {
    const params = {
      page: url.searchParams.get('page') ? parseInt(url.searchParams.get('page')!) : undefined,
      max: url.searchParams.get('max') ? parseInt(url.searchParams.get('max')!) : undefined,
      dateRangeStart: url.searchParams.get('dateRangeStart') || undefined,
      dateRangeEnd: url.searchParams.get('dateRangeEnd') || undefined,
      coins: url.searchParams.get('coins') || undefined,
      categories: url.searchParams.get('categories') || undefined,
      sortBy: url.searchParams.get('sortBy') || undefined,
      showOnly: url.searchParams.get('showOnly') || undefined,
      showViews: url.searchParams.get('showViews') === 'true',
      showVotes: url.searchParams.get('showVotes') === 'true',
      translations: url.searchParams.get('translations') || undefined,
    };
    return getEvents(request, params, cache);
  }

  if (path === '/api/coinmarketcal/categories' && request.method === 'GET') {
    return getCategories(request, cache);
  }

  if (path === '/api/coinmarketcal/coins' && request.method === 'GET') {
    return getCoins(request, cache);
  }

  return new Response(
    JSON.stringify({
      success: false,
      error: { code: 'NOT_FOUND', message: 'CoinMarketCal endpoint not found' },
    }),
    { status: 404, headers: { 'Content-Type': 'application/json' } }
  );
}

/**
 * Worker 导出
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // 将环境变量注入到全局（用于工具函数访问）
    (globalThis as any).DUNE_API_KEY = env.DUNE_API_KEY;
    (globalThis as any).ETHERSCAN_API_KEY = env.ETHERSCAN_API_KEY;
    (globalThis as any).COINMARKETCAP_API_KEY = env.COINMARKETCAP_API_KEY;
    (globalThis as any).COINMARKETCAL_API_KEY = env.COINMARKETCAL_API_KEY;

    return handleRequest(request, env, ctx);
  },
};
