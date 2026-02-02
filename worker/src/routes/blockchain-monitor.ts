/**
 * 链上监控 API 路由
 * 提供链上监控所需的各种指标数据
 * 所有数据均从 Dune Analytics 获取（使用参数化查询）
 */

import type { WorkerResponse } from '../types';
import { getQueryId, isQueryIdConfigured, buildQueryParameters, getDuneNamespace } from '../config/duneQueryIds';
import { getAPIKey } from '../utils/auth';
import { getBlockTimeDelayRPC, getGasPriceRPC, getTPSRPC } from './rpc';

const DUNE_API_BASE = 'https://api.dune.com/api/v1';

/**
 * 执行 Dune 查询并获取结果（简化版）
 */
async function executeDuneQueryAndGetResult(
  queryId: number,
  parameters: Record<string, any>,
  cache: Cache | null
): Promise<any> {
  const apiKey = getAPIKey('DUNE');
  
  // 1. 执行查询
  const executeResponse = await fetch(`${DUNE_API_BASE}/query/${queryId}/execute`, {
    method: 'POST',
    headers: {
      'X-Dune-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query_parameters: parameters }),
  });
  
  if (!executeResponse.ok) {
    const errorText = await executeResponse.text();
    console.error('[Dune] Execute query error:', {
      queryId,
      parameters,
      status: executeResponse.status,
      error: errorText,
    });
    throw new Error(`Dune API error: ${executeResponse.status} ${errorText}`);
  }
  
  const executeData = await executeResponse.json();
  const { execution_id, state } = executeData;
  
  console.log('[Dune] Query executed:', {
    queryId,
    parameters,
    executionId: execution_id,
    state,
  });
  
  // 2. 如果已完成，直接获取结果
  if (state === 'QUERY_STATE_COMPLETED') {
    const resultResponse = await fetch(`${DUNE_API_BASE}/execution/${execution_id}/results`, {
      headers: { 'X-Dune-API-Key': apiKey },
    });
    const result = await resultResponse.json();
    return result.result;
  }
  
  // 3. 轮询获取结果（优化：减少轮询频率，避免 Too many subrequests）
  // Cloudflare Workers 免费版 CPU 时间限制: 50ms 每次请求
  // 需要大幅减少轮询次数来避免超限
  const isLongRunningQuery = queryId === 6568039 || queryId === 6568369; // BTC TPS 和 Active Addresses

  // 对于所有查询都使用较长的轮询间隔，减少子请求
  const pollInterval = 5000; // 统一使用 5 秒间隔
  const maxRetries = isLongRunningQuery ? 12 : 20; // BTC: 60秒，其他: 100秒

  console.log(`[Dune] Starting poll for query ${queryId}: interval=${pollInterval}ms, maxRetries=${maxRetries}`);

  for (let i = 0; i < maxRetries; i++) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));
    
    try {
      const resultResponse = await fetch(`${DUNE_API_BASE}/execution/${execution_id}/results`, {
        headers: { 'X-Dune-API-Key': apiKey },
      });
      
      if (!resultResponse.ok) {
        // 如果遇到 429 或其他错误，等待更长时间后重试
        if (resultResponse.status === 429 || resultResponse.status >= 500) {
          await new Promise(resolve => setTimeout(resolve, pollInterval * 2));
          continue;
        }
        throw new Error(`Dune API error: ${resultResponse.status}`);
      }
      
      const result = await resultResponse.json();
      
      if (result.state === 'QUERY_STATE_COMPLETED' && result.result) {
        return result.result;
      }
      if (result.state === 'QUERY_STATE_FAILED') {
        console.error('[Dune] Query execution failed:', {
          queryId,
          parameters,
          executionId: execution_id,
          result,
        });
        throw new Error('Query execution failed');
      }
    } catch (error) {
      // 如果是网络错误，继续重试
      if (error instanceof Error && error.message.includes('subrequests')) {
        console.warn(`[Dune] Subrequest limit reached, waiting longer before retry...`);
        await new Promise(resolve => setTimeout(resolve, 10000)); // 增加到10秒
        continue;
      }
      // 其他错误直接抛出
      throw error;
    }
  }
  
  throw new Error('Query execution timeout');
}

/**
 * 指标 1: 最新区块延迟 / Block Time Delay
 * 优先使用 RPC 节点获取实时数据，失败时回退到 Dune
 */
export async function getBlockTimeDelay(
  request: Request,
  chain: string,
  cache: Cache | null
): Promise<Response> {
  // 1. 先尝试使用 RPC 获取实时数据
  try {
    const rpcResponse = await getBlockTimeDelayRPC(request, chain, cache);
    
    // 克隆 Response 以便可以多次读取
    const rpcResponseClone = rpcResponse.clone();
    const rpcData = await rpcResponseClone.json();
    
    // 2. 如果 RPC 成功，直接返回
    if (rpcData.success) {
      return rpcResponse;
    }
    
    // 3. RPC 失败，回退到 Dune 查询
    console.log('[BlockTimeDelay] RPC failed, falling back to Dune:', {
      chain,
      rpcError: rpcData.error,
    });
  } catch (rpcError) {
    // RPC 调用本身失败（网络错误等），也回退到 Dune
    console.log('[BlockTimeDelay] RPC call failed, falling back to Dune:', {
      chain,
      rpcError: rpcError instanceof Error ? rpcError.message : 'Unknown error',
    });
  }
  
  // 4. 回退到 Dune 查询
  try {
    // EVM 链（ETH/BSC/Polygon）共享同一个参数化查询
    const chainLower = chain.toLowerCase();
    let queryId: number | undefined;
    
    if (['eth', 'bsc', 'polygon'].includes(chainLower)) {
      // EVM 链使用 ETH 的 query ID
      queryId = getQueryId('blockTimeDelay', 'eth');
    } else {
      // 其他链使用自己的 query ID
      queryId = getQueryId('blockTimeDelay', chain);
    }
    
    if (!queryId) {
      // 如果没有配置 Dune query ID，返回错误
      return jsonResponse({
        success: false,
        error: { 
          code: 'QUERY_ID_NOT_CONFIGURED', 
          message: `Block time delay query ID not configured for chain: ${chain}. RPC also failed.` 
        },
      }, 400);
    }
    
    const parameters = buildQueryParameters(chain, 'blockTimeDelay');
    const result = await executeDuneQueryAndGetResult(queryId, parameters, cache);
    
    if (result.rows?.[0]) {
      const row = result.rows[0];
      return jsonResponse({
        success: true,
        data: {
          blockNumber: Number(row.block_number) || 0,
          latestBlockTime: Number(row.latest_block_time) || 0,
          delaySeconds: Number(row.delay_seconds) || 0,
          source: 'worker.dune', // Worker 通过 Dune Analytics 获取
        },
      });
    }
    
    // Dune 也没有数据
    return jsonResponse({
      success: false,
      error: { 
        code: 'NO_DATA', 
        message: `No block time delay data available for chain: ${chain}. Both RPC and Dune failed.` 
      },
    }, 500);
  } catch (error) {
    // Dune 查询也失败
    console.error('[BlockTimeDelay] Dune fallback also failed:', error);
    return jsonResponse({
      success: false,
      error: { 
        code: 'DUNE_ERROR', 
        message: error instanceof Error ? error.message : 'Unknown error' 
      },
    }, 500);
  }
}

/**
 * 指标 2: 当前 Gas 费 / Gas Price (仅 EVM 链)
 * 使用 RPC 节点获取实时数据
 */
export async function getGasPrice(
  request: Request,
  chain: string,
  cache: Cache | null
): Promise<Response> {
  // 直接使用 RPC 获取实时数据
  return getGasPriceRPC(request, chain, cache);
}

/**
 * 指标 3: TPS（最近1小时）
 * SOL 链使用 RPC 方案（getRecentPerformanceSamples）
 * 其他链使用 Dune 方案
 */
export async function getTPS(
  request: Request,
  chain: string,
  cache: Cache | null
): Promise<Response> {
  const chainLower = chain.toLowerCase();

  // SOL 链使用 RPC 方案
  if (chainLower === 'sol') {
    return getTPSRPC(request, chain, cache);
  }

  // 其他链使用 Dune 方案
  try {
    const queryId = getQueryId('tps', chain);
    if (!queryId || !isQueryIdConfigured('tps', chain)) {
      return jsonResponse({
        success: false,
        error: {
          code: 'QUERY_ID_NOT_CONFIGURED',
          message: `TPS query ID not configured for chain: ${chain}. Please create Dune query and configure query ID.`,
        }
      }, 400);
    }

    // BTC 是硬编码查询，不需要参数
    // EVM 链需要传递 tx_table 参数
    const parameters = chainLower === 'btc' ? {} : buildQueryParameters(chain, 'tps');
    const result = await executeDuneQueryAndGetResult(queryId, parameters, cache);

    if (result.rows?.[0]) {
      const row = result.rows[0];
      return jsonResponse({
        success: true,
        data: {
          txCount: Number(row.tx_count) || 0,
          tps: Number(row.tps) || 0,
          source: 'worker.dune', // Worker 通过 Dune Analytics 获取
        },
      });
    }

    throw new Error('No data returned');
  } catch (error) {
    return jsonResponse({
      success: false,
      error: { code: 'TPS_ERROR', message: error instanceof Error ? error.message : 'Unknown error' },
    }, 500);
  }
}

/**
 * 指标 4: 活跃地址数（24小时）
 */
export async function getActiveAddresses(
  request: Request,
  chain: string,
  cache: Cache | null
): Promise<Response> {
  try {
    const queryId = getQueryId('activeAddresses', chain);
    if (!queryId || !isQueryIdConfigured('activeAddresses', chain)) {
      return jsonResponse({ 
        success: false, 
        error: { 
          code: 'QUERY_ID_NOT_CONFIGURED', 
          message: `Active addresses query ID not configured for chain: ${chain}. Please create Dune query and configure query ID.` 
        } 
      }, 400);
    }
    
    const parameters = buildQueryParameters(chain, 'activeAddresses');
    const result = await executeDuneQueryAndGetResult(queryId, parameters, cache);
    
    if (result.rows?.[0]) {
      const row = result.rows[0];
      return jsonResponse({
        success: true,
        data: {
          activeAddresses: Number(row.active_addresses) || 0,
          source: 'worker.dune', // Worker 通过 Dune Analytics 获取
        },
      });
    }
    
    throw new Error('No data returned');
  } catch (error) {
    return jsonResponse({
      success: false,
      error: { code: 'ACTIVE_ADDRESSES_ERROR', message: error instanceof Error ? error.message : 'Unknown error' },
    }, 500);
  }
}

/**
 * 指标 4: TVL（总锁仓价值）
 * 支持两种模式：
 * 1. 不传 chain 参数或 chain=all：返回所有链的TVL
 * 2. 传具体 chain 参数：返回该链的TVL（向后兼容）
 * BTC 忽略（返回 0）
 * 其他链使用 DefiLlama API
 */
export async function getTVL(
  request: Request,
  chain: string | null,
  cache: Cache | null
): Promise<Response> {
  // 链名称映射到 DefiLlama 的链名称
  const chainNameMap: Record<string, string> = {
    eth: 'Ethereum',
    bsc: 'BSC',
    polygon: 'Polygon',
    sol: 'Solana',
    btc: 'Bitcoin', // BTC 在 DefiLlama 中有数据，但我们返回 0
  };
  
  // 支持的链列表
  const supportedChains = ['eth', 'bsc', 'polygon', 'sol', 'btc'];
  
  try {
    // 检查缓存（使用统一的缓存key）
    const cacheKey = new Request('https://api.llama.fi/v2/chains', request);
    let chains: any[] = [];
    
    if (cache) {
      const cached = await cache.match(cacheKey);
      if (cached) {
        try {
          chains = await cached.json();
          // 验证缓存数据格式
          if (!Array.isArray(chains)) {
            chains = [];
          }
        } catch (e) {
          // 缓存数据格式错误，忽略缓存
          chains = [];
        }
      }
    }
    
    // 如果缓存未命中，调用 DefiLlama API
    if (chains.length === 0) {
      const response = await fetch('https://api.llama.fi/v2/chains');
      if (!response.ok) {
        throw new Error(`DefiLlama API error: ${response.status}`);
      }
      
      chains = await response.json();
      
      // 缓存结果（5分钟）
      if (cache) {
        const cacheResponse = new Response(JSON.stringify(chains), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
        });
        // 异步缓存，不阻塞响应
        cache.put(cacheKey, cacheResponse).catch(console.error);
      }
    }
    
    // 如果没有指定 chain 或 chain=all，返回所有链的TVL
    if (!chain || chain.toLowerCase() === 'all') {
      const result: Record<string, any> = {};
      
      for (const chainKey of supportedChains) {
        const defiLlamaChainName = chainNameMap[chainKey];
        const chainData = chains.find((c: any) => c.name === defiLlamaChainName);
        
        if (chainKey === 'btc') {
          // BTC 返回 0
          result[chainKey] = {
            tvl: 0,
            tvlUSD: 0,
            message: 'Bitcoin has no native DeFi ecosystem. TVL is not applicable.',
            source: 'worker.defillama', // Worker 通过 DefiLlama 获取
          };
        } else if (chainData) {
          result[chainKey] = {
            tvl: Number(chainData.tvl) || 0,
            tvlUSD: Number(chainData.tvl) || 0,
            source: 'worker.defillama', // Worker 通过 DefiLlama 获取
          };
        } else {
          result[chainKey] = {
            tvl: 0,
            tvlUSD: 0,
            error: `Chain ${defiLlamaChainName} not found in DefiLlama data`,
            source: 'worker.defillama', // Worker 通过 DefiLlama 获取
          };
        }
      }
      
      return jsonResponse({
        success: true,
        data: result,
      });
    }
    
    // 返回单个链的TVL（向后兼容）
    const chainLower = chain.toLowerCase();
    
    // BTC 忽略 TVL
    if (chainLower === 'btc') {
      return jsonResponse({
        success: true,
        data: { 
          tvl: 0, 
          tvlUSD: 0,
          message: 'Bitcoin has no native DeFi ecosystem. TVL is not applicable.',
          source: 'worker.defillama', // Worker 通过 DefiLlama 获取
        },
      });
    }
    
    const defiLlamaChainName = chainNameMap[chainLower];
    if (!defiLlamaChainName) {
      return jsonResponse({
        success: false,
        error: { code: 'UNSUPPORTED_CHAIN', message: `TVL not supported for chain: ${chain}` },
      }, 400);
    }
    
    const chainData = chains.find((c: any) => c.name === defiLlamaChainName);
    
    if (!chainData) {
      throw new Error(`Chain ${defiLlamaChainName} not found in DefiLlama data`);
    }
    
    return jsonResponse({
      success: true,
      data: {
        tvl: Number(chainData.tvl) || 0,
        tvlUSD: Number(chainData.tvl) || 0,
        source: 'worker.defillama', // Worker 通过 DefiLlama 获取
      },
    });
  } catch (error) {
    return jsonResponse({
      success: false,
      error: { code: 'TVL_ERROR', message: error instanceof Error ? error.message : 'Unknown error' },
    }, 500);
  }
}


/**
 * 获取所有监控指标（一次性获取）
 */
export async function getAllMetrics(
  request: Request,
  chain: string,
  cache: Cache | null
): Promise<Response> {
  const results = await Promise.allSettled([
    getBlockTimeDelay(request, chain, cache),
    getGasPrice(request, chain, cache),
    getTPS(request, chain, cache),
    getActiveAddresses(request, chain, cache),
    getTVL(request, chain, cache),
  ]);
  
  const metrics: Record<string, any> = {};
  const keys = ['blockTimeDelay', 'gasPrice', 'tps', 'activeAddresses', 'tvl'];
  
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      const data = await result.value.json();
      if (data.success) metrics[keys[i]] = data.data;
    }
  }
  
  return jsonResponse({ success: true, data: metrics });
}

// 辅助函数
function jsonResponse(data: WorkerResponse, status = 200): Response {
  return new Response(JSON.stringify({ ...data, timestamp: Date.now() }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
