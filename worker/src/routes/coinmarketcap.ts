/**
 * CoinMarketCap API 代理路由
 */

import type { CoinMarketCapQuotesResponse, WorkerResponse } from '../types';
import { getAPIKey } from '../utils/auth';
import { getOrSetCache } from '../utils/cache';

const COINMARKETCAP_API_BASE = 'https://pro-api.coinmarketcap.com/v1';

/**
 * 获取加密货币报价
 */
export async function getQuotes(
  request: Request,
  symbols: string[],
  cache: Cache | null
): Promise<Response> {
  try {
    const apiKey = getAPIKey('COINMARKETCAP');
    const symbolsParam = symbols.join(',');
    const url = `${COINMARKETCAP_API_BASE}/cryptocurrency/quotes/latest?symbol=${symbolsParam}`;
    
    const response = await getOrSetCache(
      url,
      async () => {
        const cmcResponse = await fetch(url, {
          headers: {
            'X-CMC_PRO_API_KEY': apiKey,
            'Accept': 'application/json',
          },
        });
        
        if (!cmcResponse.ok) {
          const errorText = await cmcResponse.text();
          throw new Error(`CoinMarketCap API error: ${cmcResponse.status} ${errorText}`);
        }
        
        return cmcResponse;
      },
      { ttl: 60 }, // 1 分钟缓存
      cache
    );
    
    const data: CoinMarketCapQuotesResponse = await response.json();
    
    if (data.status.error_code !== 0) {
      const workerResponse: WorkerResponse = {
        success: false,
        error: {
          code: 'COINMARKETCAP_API_ERROR',
          message: data.status.error_message || 'CoinMarketCap API returned an error',
        },
        timestamp: Date.now(),
      };
      
      return new Response(JSON.stringify(workerResponse), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    const workerResponse: WorkerResponse<CoinMarketCapQuotesResponse['data']> = {
      success: true,
      data: data.data,
      cached: response.headers.get('X-Cache-Status') === 'HIT',
      timestamp: Date.now(),
    };
    
    return new Response(JSON.stringify(workerResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[CoinMarketCap] Error getting quotes:', error);
    
    const workerResponse: WorkerResponse = {
      success: false,
      error: {
        code: 'COINMARKETCAP_API_ERROR',
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
