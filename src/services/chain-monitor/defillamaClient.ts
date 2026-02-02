/**
 * DefiLlama API 客户端
 * 纯前端调用，不需要 API KEY
 */

import type { TVL } from './types';

const DEFILLAMA_API = 'https://api.llama.fi/v2/chains';

/**
 * DefiLlama 链名映射
 */
const CHAIN_NAME_MAP: Record<string, string> = {
  eth: 'Ethereum',
  bsc: 'BSC',
  polygon: 'Polygon',
  sol: 'Solana',
  btc: 'Bitcoin', // BTC 在 DefiLlama 中可能不存在
};

/**
 * 获取所有链的 TVL（优先级1：纯前端调用）
 */
export async function getTVLDefiLlama(chain: string): Promise<TVL | null> {
  const chainLower = chain.toLowerCase();

  // BTC 没有 TVL
  if (chainLower === 'btc') {
    return {
      tvl: 0,
      tvlUSD: 0,
      message: 'Bitcoin has no native DeFi ecosystem. TVL is not applicable.',
      source: 'defillama',
    };
  }

  try {
    const response = await fetch(DEFILLAMA_API);
    if (!response.ok) {
      throw new Error(`DefiLlama API error: ${response.status}`);
    }

    const chains = await response.json();
    const defiLlamaChainName = CHAIN_NAME_MAP[chainLower];
    
    if (!defiLlamaChainName) {
      throw new Error(`Chain ${chain} not supported by DefiLlama`);
    }

    const chainData = chains.find((c: any) => c.name === defiLlamaChainName);
    
    if (!chainData) {
      return {
        tvl: 0,
        tvlUSD: 0,
        message: `Chain ${defiLlamaChainName} not found in DefiLlama data`,
        source: 'defillama',
      };
    }

    return {
      tvl: Number(chainData.tvl) || 0,
      tvlUSD: Number(chainData.tvl) || 0,
      source: 'defillama',
    };
  } catch (error) {
    throw new Error(`DefiLlama API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * 获取所有链的 TVL（一次性获取）
 */
export async function getAllTVLDefiLlama(): Promise<Record<string, TVL>> {
  try {
    const response = await fetch(DEFILLAMA_API);
    if (!response.ok) {
      throw new Error(`DefiLlama API error: ${response.status}`);
    }

    const chains = await response.json();
    const result: Record<string, TVL> = {};

    for (const [chainId, defiLlamaChainName] of Object.entries(CHAIN_NAME_MAP)) {
      if (chainId === 'btc') {
        result[chainId] = {
          tvl: 0,
          tvlUSD: 0,
          message: 'Bitcoin has no native DeFi ecosystem. TVL is not applicable.',
          source: 'defillama',
        };
        continue;
      }

      const chainData = chains.find((c: any) => c.name === defiLlamaChainName);
      if (chainData) {
        result[chainId] = {
          tvl: Number(chainData.tvl) || 0,
          tvlUSD: Number(chainData.tvl) || 0,
          source: 'defillama',
        };
      } else {
        result[chainId] = {
          tvl: 0,
          tvlUSD: 0,
          message: `Chain ${defiLlamaChainName} not found`,
          source: 'defillama',
        };
      }
    }

    return result;
  } catch (error) {
    throw new Error(`DefiLlama API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
