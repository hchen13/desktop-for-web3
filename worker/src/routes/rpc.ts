/**
 * RPC 节点数据源
 * 用于获取实时区块数据（替代 Dune，因为 Dune 有延迟）
 */

import type { WorkerResponse } from '../types';
import { getAPIKey } from '../utils/auth';

/**
 * Solana RPC 端点配置
 * 优先使用 Alchemy（如果配置了 API key），否则使用公共端点
 */
function getSolanaRPCEndpoint(): string {
  // 尝试获取 Alchemy API key
  let alchemyKey: string | undefined;
  try {
    alchemyKey = getAPIKey('ALCHEMY');
    if (alchemyKey) {
      return `https://solana-mainnet.g.alchemy.com/v2/${alchemyKey}`;
    }
  } catch (error) {
    // Alchemy key 不存在，使用默认端点
  }
  
  // 如果没有 Alchemy key，使用硬编码的 Alchemy 端点（用户提供的）
  return 'https://solana-mainnet.g.alchemy.com/v2/edfV6Ht9xy452w6VzwlpP4OFwlccCJYT';
}

/**
 * 获取 RPC 端点 URL
 */
function getRPCEndpoint(chain: string): string {
  const chainLower = chain.toLowerCase();

  // 尝试获取 Alchemy API key（可选）
  let alchemyKey: string | undefined;
  try {
    alchemyKey = getAPIKey('ALCHEMY');
    console.log('[RPC] Alchemy API key found:', { chain: chainLower, hasKey: !!alchemyKey });
  } catch (error) {
    console.log('[RPC] Alchemy API key not found:', { chain: chainLower });
    alchemyKey = undefined;
  }

  const endpoints: Record<string, string> = {
    eth: alchemyKey
      ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`
      : 'https://eth.llamarpc.com',
    bsc: 'https://bsc-dataseed.binance.org/',
    polygon: alchemyKey
      ? `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`
      : 'https://polygon-rpc.com',
    btc: 'https://blockstream.info/api/',
    // Solana: 使用 Alchemy 端点（优先使用配置的 API key，否则使用硬编码的 key）
    sol: getSolanaRPCEndpoint(),
  };

  const endpoint = endpoints[chainLower] || endpoints.eth;
  console.log('[RPC] Selected endpoint:', { chain: chainLower, endpoint: endpoint.replace(/\/v2\/[^/]+/, '/v2/***') });

  return endpoint;
}

/**
 * EVM 链：获取最新区块
 */
async function getEVMBlock(chain: string): Promise<any> {
  const endpoint = getRPCEndpoint(chain);
  
  console.log('[RPC] getEVMBlock:', { chain, endpoint: endpoint.replace(/\/v2\/[^/]+/, '/v2/***') });
  
  // 直接获取最新区块详情（包含区块号和时间戳）
  const requestBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_getBlockByNumber',
    params: ['latest', false],
  };
  
  console.log('[RPC] Request:', { chain, method: requestBody.method });
  
  const blockResponse = await fetch(endpoint, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });
  
  console.log('[RPC] Response status:', { chain, status: blockResponse.status, ok: blockResponse.ok });
  
  if (!blockResponse.ok) {
    const errorText = await blockResponse.text();
    console.error('[RPC] HTTP error:', { chain, status: blockResponse.status, error: errorText });
    throw new Error(`RPC request failed: ${blockResponse.status} ${errorText}`);
  }
  
  const blockData = await blockResponse.json();
  console.log('[RPC] Response data:', { chain, hasResult: !!blockData.result, hasError: !!blockData.error });
  
  if (blockData.error) {
    console.error('[RPC] RPC error:', { chain, error: blockData.error });
    throw new Error(`RPC error: ${blockData.error.message || JSON.stringify(blockData.error)}`);
  }
  
  if (!blockData.result) {
    console.error('[RPC] No result:', { chain, blockData });
    throw new Error('RPC returned no result');
  }
  
  const block = blockData.result;
  const blockNumber = parseInt(block.number, 16);
  const timestamp = parseInt(block.timestamp, 16);
  
  console.log('[RPC] Success:', { chain, blockNumber, timestamp });
  
  return {
    blockNumber,
    timestamp, // Unix timestamp (seconds)
    delaySeconds: Math.floor(Date.now() / 1000) - timestamp,
  };
}

/**
 * Bitcoin：获取最新区块
 */
async function getBTCBlock(): Promise<any> {
  const endpoint = getRPCEndpoint('btc');
  
  // Blockstream API: 获取最新区块（返回数组，取第一个）
  const blockResponse = await fetch(`${endpoint}blocks/tip`);
  if (!blockResponse.ok) {
    throw new Error(`Blockstream API error: ${blockResponse.status}`);
  }
  
  const blocks = await blockResponse.json();
  const block = Array.isArray(blocks) ? blocks[0] : blocks;
  
  return {
    blockNumber: block.height,
    timestamp: block.timestamp, // Unix timestamp (seconds)
    delaySeconds: Math.floor(Date.now() / 1000) - block.timestamp,
  };
}

/**
 * Solana：获取最新区块
 */
async function getSOLBlock(): Promise<any> {
  const endpoint = getSolanaRPCEndpoint();
  
  // Solana RPC: 获取最新 slot
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getSlot',
      params: [],
    }),
  });
  
  const slotData = await response.json();
  
  if (slotData.error) {
    throw new Error(`Solana RPC error: ${slotData.error.message || slotData.error.code}`);
  }
  
  const slot = slotData.result;
  
  if (!slot) {
    throw new Error('Failed to get Solana slot');
  }
  
  // 获取区块时间
  const blockTimeResponse = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'getBlockTime',
      params: [slot],
    }),
  });
  
  const blockTimeData = await blockTimeResponse.json();
  const timestamp = blockTimeData.result;
  
  // 如果 getBlockTime 返回 null，尝试使用 getBlock 获取时间戳
  if (!timestamp) {
    const blockResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'getBlock',
        params: [slot, { encoding: 'json', transactionDetails: 'none' }],
      }),
    });
    const blockData = await blockResponse.json();
    
    if (blockData.error) {
      // 如果 getBlock 也失败，使用当前时间作为估算
      const currentTimestamp = Math.floor(Date.now() / 1000);
      return {
        blockNumber: slot,
        timestamp: currentTimestamp,
        delaySeconds: 0,
      };
    }
    
    const blockTimestamp = blockData.result?.blockTime || Math.floor(Date.now() / 1000);
    return {
      blockNumber: slot,
      timestamp: blockTimestamp,
      delaySeconds: blockTimestamp ? Math.floor(Date.now() / 1000) - blockTimestamp : 0,
    };
  }
  
  return {
    blockNumber: slot,
    timestamp: timestamp, // Unix timestamp (seconds)
    delaySeconds: Math.floor(Date.now() / 1000) - timestamp,
  };
}

/**
 * 获取最新区块延迟（使用 RPC）
 */
export async function getBlockTimeDelayRPC(
  request: Request,
  chain: string,
  cache: Cache | null
): Promise<Response> {
  try {
    const chainLower = chain.toLowerCase();
    console.log('[BlockTimeDelayRPC] Starting:', { chain: chainLower });
    
    let result;
    
    if (['eth', 'bsc', 'polygon'].includes(chainLower)) {
      result = await getEVMBlock(chainLower);
    } else if (chainLower === 'btc') {
      result = await getBTCBlock();
    } else if (chainLower === 'sol') {
      result = await getSOLBlock();
    } else {
      console.error('[BlockTimeDelayRPC] Unsupported chain:', { chain: chainLower });
      return jsonResponse({
        success: false,
        error: { code: 'UNSUPPORTED_CHAIN', message: `Unsupported chain: ${chain}` },
      }, 400);
    }
    
    console.log('[BlockTimeDelayRPC] Success:', { chain: chainLower, blockNumber: result.blockNumber, delaySeconds: result.delaySeconds });
    
    return jsonResponse({
      success: true,
      data: {
        blockNumber: result.blockNumber,
        latestBlockTime: result.timestamp,
        delaySeconds: result.delaySeconds,
        source: 'worker.rpc', // Worker 通过 RPC（Alchemy）获取
      },
    });
  } catch (error) {
    console.error('[BlockTimeDelayRPC] Error:', { chain, error: error instanceof Error ? error.message : 'Unknown error', stack: error instanceof Error ? error.stack : undefined });
    return jsonResponse({
      success: false,
      error: { code: 'RPC_ERROR', message: error instanceof Error ? error.message : 'Unknown error' },
    }, 500);
  }
}

/**
 * EVM 链：获取 Gas Price
 */
async function getEVMGasPrice(chain: string): Promise<any> {
  const endpoint = getRPCEndpoint(chain);
  
  // 获取当前建议的 gas price
  const gasPriceResponse = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_gasPrice',
      params: [],
    }),
  });
  
  if (!gasPriceResponse.ok) {
    throw new Error(`RPC request failed: ${gasPriceResponse.status}`);
  }
  
  const gasPriceData = await gasPriceResponse.json();
  
  if (gasPriceData.error) {
    throw new Error(`RPC error: ${gasPriceData.error.message}`);
  }
  
  // 转换为 Gwei (1 Gwei = 10^9 Wei)
  const gasPriceWei = parseInt(gasPriceData.result, 16);
  const gasPriceGwei = gasPriceWei / 1e9;
  
  return {
    avgGasGwei: gasPriceGwei,
    medianGasGwei: gasPriceGwei, // RPC 只返回一个值，用平均值作为中位数
    minGasGwei: gasPriceGwei * 0.9, // 估算最小值
    maxGasGwei: gasPriceGwei * 1.1, // 估算最大值
  };
}

/**
 * Bitcoin：获取交易费用（sat/vB）
 */
async function getBTCFeeRate(): Promise<any> {
  const endpoint = getRPCEndpoint('btc');
  
  // Blockstream API: 获取费用估算
  const feeResponse = await fetch(`${endpoint}fee-estimates`);
  if (!feeResponse.ok) {
    throw new Error(`Blockstream API error: ${feeResponse.status}`);
  }
  
  const feeEstimates = await feeResponse.json();
  // 获取 6 个区块确认的费用（sat/vB）
  const feeRate = feeEstimates['6'] || feeEstimates['1'] || Object.values(feeEstimates)[0];
  
  // 转换为类似 Gwei 的格式（保留为 sat/vB，但统一接口）
  return {
    avgGasGwei: Number(feeRate),
    medianGasGwei: Number(feeRate),
    minGasGwei: Number(feeRate) * 0.8,
    maxGasGwei: Number(feeRate) * 1.2,
    unit: 'sat/vB', // 标记单位
  };
}

/**
 * Solana：获取交易费用（lamports per signature）
 * 使用 getRecentPrioritizationFees 获取优先费
 * 支持多个 RPC 端点回退
 */
async function getSOLFeeRate(): Promise<any> {
  // Solana 基础交易费用：5000 lamports per signature
  const BASE_FEE_LAMPORTS = 5000;

  // 使用 Alchemy 端点
  const endpoint = getSolanaRPCEndpoint();
  
  try {
    console.log('[SOLFeeRate] Using endpoint:', endpoint.replace(/\/v2\/[^/]+/, '/v2/***'));

    const feeResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getRecentPrioritizationFees',
        params: [[]], // 获取所有账户的优先费
      }),
    });

    if (!feeResponse.ok) {
      throw new Error(`HTTP error: ${feeResponse.status}`);
    }

    const feeData = await feeResponse.json();

    if (feeData.error) {
      throw new Error(`RPC error: ${feeData.error.message || JSON.stringify(feeData.error)}`);
    }

    // 解析优先费数据
    const priorityFees = feeData.result || [];
    if (priorityFees.length > 0) {
      // 取中位数作为平均优先费
      const fees = priorityFees
        .map((f: any) => f.prioritizationFee || 0)
        .sort((a: number, b: number) => a - b);
      const medianFee = fees[Math.floor(fees.length / 2)] || 0;

      // 总费用 = 基础费用 + 优先费
      const totalFee = BASE_FEE_LAMPORTS + medianFee;

      console.log('[SOLFeeRate] Success:', {
        baseFee: BASE_FEE_LAMPORTS,
        priorityFee: medianFee,
        totalFee,
      });

      return {
        avgGasGwei: totalFee / 1e9,
        medianGasGwei: totalFee / 1e9,
        minGasGwei: BASE_FEE_LAMPORTS / 1e9, // 最小就是基础费用
        maxGasGwei: (BASE_FEE_LAMPORTS + (fees[fees.length - 1] || 0)) / 1e9,
        unit: 'SOL',
      };
    }
  } catch (error) {
    console.error('[SOLFeeRate] Error:', error instanceof Error ? error.message : 'Unknown error');
  }

  // 如果请求失败，返回基础费用
  console.log('[SOLFeeRate] Using base fee as fallback:', BASE_FEE_LAMPORTS);
  return {
    avgGasGwei: BASE_FEE_LAMPORTS / 1e9,
    medianGasGwei: BASE_FEE_LAMPORTS / 1e9,
    minGasGwei: BASE_FEE_LAMPORTS / 1e9,
    maxGasGwei: BASE_FEE_LAMPORTS / 1e9,
    unit: 'SOL',
  };
}

/**
 * Solana：获取 TPS（使用 getRecentPerformanceSamples）
 * 使用真实TPS（numNonVoteTransactions），计算所有采样点的平均值
 * 支持多个 RPC 端点回退
 */
async function getSOLTPS(): Promise<any> {
  // 使用 Alchemy 端点
  const endpoint = getSolanaRPCEndpoint();
  
  try {
    console.log('[SOLTPS] Using endpoint:', endpoint.replace(/\/v2\/[^/]+/, '/v2/***'));

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getRecentPerformanceSamples',
        params: [60],
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(`RPC error: ${data.error.message || JSON.stringify(data.error)}`);
    }

    const samples = data.result || [];

    if (samples.length === 0) {
      throw new Error('No samples returned');
    }

    let totalTPS = 0;
    let validSamples = 0;

    for (const sample of samples) {
      if (sample.numNonVoteTransactions !== undefined && sample.samplePeriodSecs > 0) {
        const tps = sample.numNonVoteTransactions / sample.samplePeriodSecs;
        totalTPS += tps;
        validSamples++;
      }
    }

    const avgTPS = validSamples > 0 ? totalTPS / validSamples : 0;

    console.log('[SOLTPS] Success:', { tps: avgTPS.toFixed(2), validSamples });

    return {
      tps: avgTPS,
      txCount: samples.reduce((sum: number, s: any) => sum + (s.numNonVoteTransactions || 0), 0),
      sampleCount: validSamples,
      periodSeconds: samples[0]?.samplePeriodSecs || 60,
    };
  } catch (error) {
    console.error('[SOLTPS] Error:', error instanceof Error ? error.message : 'Unknown error');
    throw new Error(`Solana TPS RPC failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * 获取 TPS（使用 RPC，仅支持 SOL）
 */
export async function getTPSRPC(
  request: Request,
  chain: string,
  cache: Cache | null
): Promise<Response> {
  try {
    const chainLower = chain.toLowerCase();
    
    if (chainLower !== 'sol') {
      return jsonResponse({
        success: false,
        error: { 
          code: 'UNSUPPORTED_CHAIN', 
          message: `TPS RPC is only supported for Solana. Chain: ${chain}` 
        },
      }, 400);
    }
    
    const result = await getSOLTPS();
    
    return jsonResponse({
      success: true,
      data: {
        tps: result.tps,
        txCount: result.txCount,
        sampleCount: result.sampleCount,
        periodSeconds: result.periodSeconds,
        source: 'worker.rpc', // Worker 通过 RPC（Alchemy）获取
      },
    });
  } catch (error) {
    return jsonResponse({
      success: false,
      error: { code: 'RPC_ERROR', message: error instanceof Error ? error.message : 'Unknown error' },
    }, 500);
  }
}

/**
 * 获取 Gas Price（使用 RPC）
 * 支持 EVM 链（Gas Price）和非 EVM 链（交易费用）
 */
export async function getGasPriceRPC(
  request: Request,
  chain: string,
  cache: Cache | null
): Promise<Response> {
  try {
    const chainLower = chain.toLowerCase();
    let result;
    
    if (['eth', 'bsc', 'polygon'].includes(chainLower)) {
      // EVM 链：获取 Gas Price
      result = await getEVMGasPrice(chainLower);
      result.unit = 'gwei';
    } else if (chainLower === 'btc') {
      // Bitcoin：获取交易费用
      result = await getBTCFeeRate();
    } else if (chainLower === 'sol') {
      // Solana：获取交易费用
      result = await getSOLFeeRate();
    } else {
      return jsonResponse({
        success: false,
        error: { code: 'UNSUPPORTED_CHAIN', message: `Unsupported chain: ${chain}` },
      }, 400);
    }
    
    return jsonResponse({
      success: true,
      data: {
        ...result,
        source: 'worker.rpc', // Worker 通过 RPC（Alchemy）获取
      },
    });
  } catch (error) {
    return jsonResponse({
      success: false,
      error: { code: 'RPC_ERROR', message: error instanceof Error ? error.message : 'Unknown error' },
    }, 500);
  }
}

function jsonResponse(data: WorkerResponse, status = 200): Response {
  return new Response(JSON.stringify({ ...data, timestamp: Date.now() }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
