/**
 * 纯前端 RPC 客户端
 * 直接调用公共 RPC 端点，不需要 API KEY
 */

import type { BlockTimeDelay, GasPrice, TPS } from './types';

/**
 * RPC 端点配置（公共端点，不需要 API KEY）
 * 注意：前端只使用公共端点，不使用带 API KEY 的端点
 */
const RPC_ENDPOINTS: Record<string, string> = {
  // Cloudflare Ethereum Gateway 支持 CORS
  eth: 'https://cloudflare-eth.com',
  bsc: 'https://bsc-dataseed.binance.org/',
  polygon: 'https://polygon-rpc.com',
  btc: 'https://blockstream.info/api',
  // Solana: 使用公共 RPC 端点（不使用 Alchemy 带 API KEY 的端点）
  // 使用 PublicNode 的公共端点（稳定可靠）
  // 如果失败，会回退到 Worker API（Worker 使用 Alchemy 带 API KEY 的端点）
  sol: 'https://solana-rpc.publicnode.com',
};

/**
 * JSON-RPC 请求
 */
async function jsonRPC(endpoint: string, method: string, params: any[] = []): Promise<any> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC request failed: ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`RPC error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  return data.result;
}

/**
 * 获取 EVM 链最新区块
 */
async function getEVMBlock(chain: string): Promise<BlockTimeDelay> {
  const endpoint = RPC_ENDPOINTS[chain];
  if (!endpoint) {
    throw new Error(`Unsupported chain: ${chain}`);
  }

  const block = await jsonRPC(endpoint, 'eth_getBlockByNumber', ['latest', false]);
  const blockNumber = parseInt(block.number, 16);
  const timestamp = parseInt(block.timestamp, 16);
  const now = Math.floor(Date.now() / 1000);

  return {
    blockNumber,
    latestBlockTime: timestamp,
    delaySeconds: now - timestamp,
    source: 'rpc',
  };
}

/**
 * 获取 BTC 最新区块
 */
async function getBTCBlock(): Promise<BlockTimeDelay> {
  const endpoint = RPC_ENDPOINTS.btc;
  
  // Blockstream API: 获取最新区块（返回数组，第一个元素是最新区块）
  const response = await fetch(`${endpoint}/blocks/tip`);
  if (!response.ok) {
    throw new Error(`Blockstream API error: ${response.status}`);
  }

  const blocks = await response.json();
  // Blockstream API 返回数组，第一个元素是最新区块
  const block = Array.isArray(blocks) ? blocks[0] : blocks;
  const now = Math.floor(Date.now() / 1000);
  
  // Blockstream API 返回的 timestamp 可能是 null，需要处理
  const timestamp = block.timestamp || block.mediantime || now;
  const delaySeconds = now - timestamp;

  return {
    blockNumber: block.height || 0,
    latestBlockTime: timestamp,
    delaySeconds: delaySeconds >= 0 ? delaySeconds : 0,
    source: 'rpc',
  };
}

/**
 * 获取 SOL 最新区块
 */
async function getSOLBlock(): Promise<BlockTimeDelay> {
  const endpoint = RPC_ENDPOINTS.sol;

  try {
    // 1. 获取最新 slot
    const slot = await jsonRPC(endpoint, 'getSlot');
    if (!slot) {
      throw new Error('Failed to get Solana slot');
    }

    // 2. 获取区块时间
    const blockTime = await jsonRPC(endpoint, 'getBlockTime', [slot]);
    const now = Math.floor(Date.now() / 1000);

    // 如果 getBlockTime 返回 null，使用当前时间
    const timestamp = blockTime || now;

    return {
      blockNumber: slot,
      latestBlockTime: timestamp,
      delaySeconds: now - timestamp,
      source: 'rpc',
    };
  } catch (error) {
    // Solana 公共 RPC 有速率限制，如果失败直接抛出错误，让上层回退到 Worker
    // 降级日志级别，避免控制台过多错误
    console.debug('[Solana RPC] Failed (expected with rate limiting):', error);
    throw new Error(`Solana RPC failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * 获取区块时间延迟（优先级1：纯前端RPC）
 */
export async function getBlockTimeDelayRPC(chain: string): Promise<BlockTimeDelay> {
  const chainLower = chain.toLowerCase();

  try {
    if (['eth', 'bsc', 'polygon'].includes(chainLower)) {
      return await getEVMBlock(chainLower);
    } else if (chainLower === 'btc') {
      return await getBTCBlock();
    } else if (chainLower === 'sol') {
      return await getSOLBlock();
    } else {
      throw new Error(`Unsupported chain: ${chain}`);
    }
  } catch (error) {
    throw new Error(`RPC call failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * 获取 EVM Gas 价格
 */
async function getEVMGasPrice(chain: string): Promise<GasPrice> {
  const endpoint = RPC_ENDPOINTS[chain];
  if (!endpoint) {
    throw new Error(`Unsupported chain: ${chain}`);
  }

  const gasPriceHex = await jsonRPC(endpoint, 'eth_gasPrice');
  const gasPriceWei = parseInt(gasPriceHex, 16);
  const gasPriceGwei = gasPriceWei / 1e9;

  return {
    avgGasGwei: gasPriceGwei,
    medianGasGwei: gasPriceGwei,
    minGasGwei: gasPriceGwei * 0.9,
    maxGasGwei: gasPriceGwei * 1.1,
    unit: 'gwei',
    source: 'rpc',
  };
}

/**
 * 获取 BTC 费率
 */
async function getBTCFeeRate(): Promise<GasPrice> {
  const endpoint = RPC_ENDPOINTS.btc;

  // Blockstream API: 获取费率估算
  const response = await fetch(`${endpoint}/fee-estimates`);
  if (!response.ok) {
    throw new Error(`Blockstream API error: ${response.status}`);
  }

  const estimates = await response.json();
  const feeRates = Object.values(estimates) as number[];
  const avgFee = feeRates.reduce((a, b) => a + b, 0) / feeRates.length;

  return {
    avgGasGwei: avgFee,
    medianGasGwei: avgFee,
    minGasGwei: Math.min(...feeRates),
    maxGasGwei: Math.max(...feeRates),
    unit: 'sat/vB',
    source: 'rpc',
  };
}

/**
 * 获取 SOL 费率
 */
async function getSOLFeeRate(): Promise<GasPrice> {
  const endpoint = RPC_ENDPOINTS.sol;

  try {
    // 获取最近的优先费用
    const fees = await jsonRPC(endpoint, 'getRecentPrioritizationFees', []);
    
    if (!fees || fees.length === 0) {
      // 默认值
      return {
        avgGasGwei: 0.000005,
        medianGasGwei: 0.000005,
        minGasGwei: 0.0000045,
        maxGasGwei: 0.0000055,
        unit: 'SOL',
        source: 'rpc',
      };
    }

    const feeValues = fees.map((f: any) => f.prioritizationFee || 0).filter((f: number) => f > 0);
    if (feeValues.length === 0) {
      return {
        avgGasGwei: 0.000005,
        medianGasGwei: 0.000005,
        minGasGwei: 0.0000045,
        maxGasGwei: 0.0000055,
        unit: 'SOL',
        source: 'rpc',
      };
    }

    const avgFee = feeValues.reduce((a: number, b: number) => a + b, 0) / feeValues.length;
    const sorted = [...feeValues].sort((a, b) => a - b);
    const medianFee = sorted[Math.floor(sorted.length / 2)];

    // 转换为 SOL（Lamports to SOL）
    const lamportsToSol = 1e9;
    return {
      avgGasGwei: avgFee / lamportsToSol,
      medianGasGwei: medianFee / lamportsToSol,
      minGasGwei: Math.min(...feeValues) / lamportsToSol,
      maxGasGwei: Math.max(...feeValues) / lamportsToSol,
      unit: 'SOL',
      source: 'rpc',
    };
  } catch (error) {
    // Solana 公共 RPC 有速率限制，如果失败直接抛出错误，让上层回退到 Worker
    // 降级日志级别，避免控制台过多错误
    console.debug('[Solana RPC] Failed (expected with rate limiting):', error);
    throw new Error(`Solana RPC failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * 获取 Gas 价格（优先级1：纯前端RPC）
 */
export async function getGasPriceRPC(chain: string): Promise<GasPrice> {
  const chainLower = chain.toLowerCase();

  try {
    if (['eth', 'bsc', 'polygon'].includes(chainLower)) {
      return await getEVMGasPrice(chainLower);
    } else if (chainLower === 'btc') {
      return await getBTCFeeRate();
    } else if (chainLower === 'sol') {
      return await getSOLFeeRate();
    } else {
      throw new Error(`Unsupported chain: ${chain}`);
    }
  } catch (error) {
    throw new Error(`RPC call failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * 获取 SOL TPS（优先级1：纯前端RPC）
 */
export async function getTPSRPC(chain: string): Promise<TPS> {
  const chainLower = chain.toLowerCase();

  if (chainLower !== 'sol') {
    throw new Error('RPC TPS only supported for SOL');
  }

  try {
    const endpoint = RPC_ENDPOINTS.sol;

    // 获取最近的性能样本
    const samples = await jsonRPC(endpoint, 'getRecentPerformanceSamples', [60]);
    
    if (!samples || samples.length === 0) {
      throw new Error('No performance samples returned');
    }

    // 计算平均 TPS（非投票交易）
    // 每个样本的 TPS = numNonVoteTransactions / samplePeriodSecs
    let totalTPS = 0;
    let validSamples = 0;

    for (const sample of samples) {
      if (sample.numNonVoteTransactions !== undefined && sample.samplePeriodSecs > 0) {
        const tps = sample.numNonVoteTransactions / sample.samplePeriodSecs;
        totalTPS += tps;
        validSamples++;
      }
    }

    const avgTps = validSamples > 0 ? totalTPS / validSamples : 0;

    return {
      tps: avgTps,
      txCount: samples.reduce((sum: number, s: any) => sum + (s.numNonVoteTransactions || 0), 0),
      sampleCount: validSamples,
      periodSeconds: samples[0]?.samplePeriodSecs || 60,
      source: 'rpc',
    };
  } catch (error) {
    // Solana 公共 RPC 有速率限制，如果失败直接抛出错误，让上层回退到 Worker
    // 降级日志级别，避免控制台过多错误
    console.debug('[Solana RPC] Failed (expected with rate limiting):', error);
    throw new Error(`Solana RPC failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
