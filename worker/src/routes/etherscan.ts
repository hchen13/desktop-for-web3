/**
 * Etherscan API 代理路由
 * 支持多个 EVM 链：Ethereum、Polygon、BSC、Arbitrum 等
 */

import type { EtherscanGasOracleResponse, WorkerResponse } from '../types';
import { getAPIKey } from '../utils/auth';
import { getOrSetCache } from '../utils/cache';

// 支持的链及其 API 端点
const CHAIN_ENDPOINTS: Record<string, string> = {
  ethereum: 'https://api.etherscan.io/api',
  polygon: 'https://api.polygonscan.com/api',
  bsc: 'https://api.bscscan.com/api',
  arbitrum: 'https://api.arbiscan.io/api',
  optimism: 'https://api-optimistic.etherscan.io/api',
  base: 'https://api.basescan.org/api',
  avalanche: 'https://api.snowtrace.io/api',
  fantom: 'https://api.ftmscan.com/api',
};

/**
 * 获取 Gas Oracle 数据
 */
export async function getGasOracle(
  request: Request,
  chain: string = 'ethereum',
  cache: Cache | null
): Promise<Response> {
  try {
    const apiKey = getAPIKey('ETHERSCAN');
    const endpoint = CHAIN_ENDPOINTS[chain.toLowerCase()];
    
    if (!endpoint) {
      const workerResponse: WorkerResponse = {
        success: false,
        error: {
          code: 'INVALID_CHAIN',
          message: `Unsupported chain: ${chain}. Supported chains: ${Object.keys(CHAIN_ENDPOINTS).join(', ')}`,
        },
        timestamp: Date.now(),
      };
      
      return new Response(JSON.stringify(workerResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    const url = `${endpoint}?module=gastracker&action=gasoracle&apikey=${apiKey}`;
    
    const response = await getOrSetCache(
      url,
      async () => {
        const etherscanResponse = await fetch(url);
        
        if (!etherscanResponse.ok) {
          const errorText = await etherscanResponse.text();
          throw new Error(`Etherscan API error: ${etherscanResponse.status} ${errorText}`);
        }
        
        return etherscanResponse;
      },
      { ttl: 30 }, // 30 秒缓存（Gas 价格变化频繁）
      cache
    );
    
    const data: EtherscanGasOracleResponse = await response.json();
    
    if (data.status !== '1') {
      const workerResponse: WorkerResponse = {
        success: false,
        error: {
          code: 'ETHERSCAN_API_ERROR',
          message: data.message || 'Etherscan API returned an error',
        },
        timestamp: Date.now(),
      };
      
      return new Response(JSON.stringify(workerResponse), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    const workerResponse: WorkerResponse<EtherscanGasOracleResponse['result']> = {
      success: true,
      data: data.result,
      cached: response.headers.get('X-Cache-Status') === 'HIT',
      timestamp: Date.now(),
    };
    
    return new Response(JSON.stringify(workerResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[Etherscan] Error getting gas oracle:', error);
    
    const workerResponse: WorkerResponse = {
      success: false,
      error: {
        code: 'ETHERSCAN_API_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      timestamp: Date.now(),
    };
    
    return new Response(JSON.stringify(workerResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * 获取最新区块号
 */
export async function getLatestBlock(
  request: Request,
  chain: string = 'ethereum',
  cache: Cache | null
): Promise<Response> {
  try {
    const apiKey = getAPIKey('ETHERSCAN');
    const endpoint = CHAIN_ENDPOINTS[chain.toLowerCase()];
    
    if (!endpoint) {
      const workerResponse: WorkerResponse = {
        success: false,
        error: {
          code: 'INVALID_CHAIN',
          message: `Unsupported chain: ${chain}`,
        },
        timestamp: Date.now(),
      };
      
      return new Response(JSON.stringify(workerResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    const url = `${endpoint}?module=proxy&action=eth_blockNumber&apikey=${apiKey}`;
    
    const response = await getOrSetCache(
      url,
      async () => {
        const etherscanResponse = await fetch(url);
        
        if (!etherscanResponse.ok) {
          throw new Error(`Etherscan API error: ${etherscanResponse.status}`);
        }
        
        return etherscanResponse;
      },
      { ttl: 15 }, // 15 秒缓存
      cache
    );
    
    const data = await response.json();
    
    if (data.status !== '1') {
      const workerResponse: WorkerResponse = {
        success: false,
        error: {
          code: 'ETHERSCAN_API_ERROR',
          message: data.message || 'Etherscan API returned an error',
        },
        timestamp: Date.now(),
      };
      
      return new Response(JSON.stringify(workerResponse), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    const blockNumber = parseInt(data.result, 16);
    
    const workerResponse: WorkerResponse<{ blockNumber: number; hex: string }> = {
      success: true,
      data: {
        blockNumber,
        hex: data.result,
      },
      cached: response.headers.get('X-Cache-Status') === 'HIT',
      timestamp: Date.now(),
    };
    
    return new Response(JSON.stringify(workerResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[Etherscan] Error getting latest block:', error);
    
    const workerResponse: WorkerResponse = {
      success: false,
      error: {
        code: 'ETHERSCAN_API_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      timestamp: Date.now(),
    };
    
    return new Response(JSON.stringify(workerResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
