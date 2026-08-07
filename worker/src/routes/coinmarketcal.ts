/**
 * CoinMarketCal API 代理路由
 * 文档: https://coinmarketcal.com/developer/docs/events
 */

import type { WorkerResponse } from '../types';
import { getAPIKey } from '../utils/auth';
import { getOrSetCache } from '../utils/cache';

const COINMARKETCAL_API_BASE = 'https://api.coinmarketcal.com/v2';

/**
 * CoinMarketCal API 类型定义
 */
export interface CoinMarketCalEvent {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  date: string;
  dateEnd?: string;
  dateType?: 'date' | 'month' | 'quarter' | string;
  isEstimated?: boolean;
  displayedDate?: string;
  categories?: string[];
  coins: Array<{
    slug: string;
    symbol: string;
    name: string;
  }>;
  impact?: string | number | null;
  impactSummary?: string | null;
  sourceUrl?: string | null;
  snapshotUrl?: string | null;
}

export interface CoinMarketCalCategory {
  id: string;
  name: string;
}

export interface CoinMarketCalCoin {
  slug: string;
  name: string;
  symbol: string;
}

export interface CoinMarketCalEventsResponse {
  data: CoinMarketCalEvent[];
  meta?: {
    total?: number;
    limit?: number;
    cursor?: string | null;
  };
}

type CoinMarketCalCollectionResponse<T> = {
  data?: T[];
  meta?: Record<string, unknown>;
  error?: { message?: string };
};

function jsonResponse<T>(body: WorkerResponse<T>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * 获取事件列表
 * @param request 原始请求
 * @param params 查询参数
 * @param cache 缓存实例
 */
export async function getEvents(
  request: Request,
  params: {
    page?: number;
    max?: number;
    dateRangeStart?: string;
    dateRangeEnd?: string;
    coins?: string;
    categories?: string;
    sortBy?: string;
    showOnly?: string;
    showViews?: boolean;
    showVotes?: boolean;
    translations?: string;
  },
  cache: Cache | null,
): Promise<Response> {
  try {
    const apiKey = getAPIKey('COINMARKETCAL');

    // 构建查询参数
    const searchParams = new URLSearchParams();
    // Keep the worker's public query contract stable while translating to V2.
    if (params.page) {
      console.warn('[CoinMarketCal] V2 uses cursor pagination; ignoring legacy page parameter');
    }
    if (params.max) searchParams.append('limit', Math.min(Math.max(params.max, 1), 100).toString());
    if (params.dateRangeStart) searchParams.append('from', params.dateRangeStart);
    if (params.dateRangeEnd) searchParams.append('to', params.dateRangeEnd);
    if (params.coins) searchParams.append('coins', params.coins);
    if (params.categories) searchParams.append('categories', params.categories);
    if (params.sortBy) searchParams.append('sortBy', params.sortBy);

    const url = `${COINMARKETCAL_API_BASE}/events?${searchParams.toString()}`;

    const response = await getOrSetCache(
      url,
      async () => {
        const cmcResponse = await fetch(url, {
          headers: {
            'x-api-key': apiKey,
            Accept: 'application/json',
            'Accept-Encoding': 'gzip, deflate',
          },
        });

        if (!cmcResponse.ok) {
          const errorText = await cmcResponse.text();
          throw new Error(`CoinMarketCal API error: ${cmcResponse.status} ${errorText}`);
        }

        return cmcResponse;
      },
      { ttl: 300 }, // 5 分钟缓存
      cache,
    );

    const data: CoinMarketCalEventsResponse = await response.json();
    if (!Array.isArray(data.data)) {
      return jsonResponse(
        {
          success: false,
          error: {
            code: 'COINMARKETCAL_API_ERROR',
            message: 'CoinMarketCal V2 returned an invalid response',
          },
          timestamp: Date.now(),
        },
        502,
      );
    }

    const workerResponse: WorkerResponse<CoinMarketCalEventsResponse['data']> = {
      success: true,
      data: data.data,
      metadata: data.meta,
      cached: response.headers.get('X-Cache-Status') === 'HIT',
      timestamp: Date.now(),
    };
    return jsonResponse(workerResponse);
  } catch (error) {
    console.error('[CoinMarketCal] Error getting events:', error);

    const workerResponse: WorkerResponse = {
      success: false,
      error: {
        code: 'COINMARKETCAL_API_ERROR',
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
 * 获取分类列表
 */
export async function getCategories(request: Request, cache: Cache | null): Promise<Response> {
  try {
    const apiKey = getAPIKey('COINMARKETCAL');
    const url = `${COINMARKETCAL_API_BASE}/categories`;

    const response = await getOrSetCache(
      url,
      async () => {
        const cmcResponse = await fetch(url, {
          headers: {
            'x-api-key': apiKey,
            Accept: 'application/json',
          },
        });

        if (!cmcResponse.ok) {
          const errorText = await cmcResponse.text();
          throw new Error(`CoinMarketCal API error: ${cmcResponse.status} ${errorText}`);
        }

        return cmcResponse;
      },
      { ttl: 3600 }, // 1 小时缓存
      cache,
    );

    const data: CoinMarketCalCollectionResponse<CoinMarketCalCategory> = await response.json();
    if (!Array.isArray(data.data)) {
      return jsonResponse(
        {
          success: false,
          error: {
            code: 'COINMARKETCAL_API_ERROR',
            message: data.error?.message || 'Invalid response',
          },
          timestamp: Date.now(),
        },
        502,
      );
    }

    const workerResponse: WorkerResponse<CoinMarketCalCategory[]> = {
      success: true,
      data: data.data,
      metadata: data.meta,
      cached: response.headers.get('X-Cache-Status') === 'HIT',
      timestamp: Date.now(),
    };

    return jsonResponse(workerResponse);
  } catch (error) {
    console.error('[CoinMarketCal] Error getting categories:', error);

    const workerResponse: WorkerResponse = {
      success: false,
      error: {
        code: 'COINMARKETCAL_API_ERROR',
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
 * 获取币种列表
 */
export async function getCoins(request: Request, cache: Cache | null): Promise<Response> {
  try {
    const apiKey = getAPIKey('COINMARKETCAL');
    const url = `${COINMARKETCAL_API_BASE}/coins`;

    const response = await getOrSetCache(
      url,
      async () => {
        const cmcResponse = await fetch(url, {
          headers: {
            'x-api-key': apiKey,
            Accept: 'application/json',
          },
        });

        if (!cmcResponse.ok) {
          const errorText = await cmcResponse.text();
          throw new Error(`CoinMarketCal API error: ${cmcResponse.status} ${errorText}`);
        }

        return cmcResponse;
      },
      { ttl: 3600 }, // 1 小时缓存
      cache,
    );

    const data: CoinMarketCalCollectionResponse<CoinMarketCalCoin> = await response.json();
    if (!Array.isArray(data.data)) {
      return jsonResponse(
        {
          success: false,
          error: {
            code: 'COINMARKETCAL_API_ERROR',
            message: data.error?.message || 'Invalid response',
          },
          timestamp: Date.now(),
        },
        502,
      );
    }

    const workerResponse: WorkerResponse<CoinMarketCalCoin[]> = {
      success: true,
      data: data.data,
      metadata: data.meta,
      cached: response.headers.get('X-Cache-Status') === 'HIT',
      timestamp: Date.now(),
    };

    return jsonResponse(workerResponse);
  } catch (error) {
    console.error('[CoinMarketCal] Error getting coins:', error);

    const workerResponse: WorkerResponse = {
      success: false,
      error: {
        code: 'COINMARKETCAL_API_ERROR',
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
