/**
 * CoinMarketCal API 代理路由
 * 文档: https://coinmarketcal.com/en/doc/redoc
 */

import type { WorkerResponse } from '../types';
import { getAPIKey } from '../utils/auth';
import { getOrSetCache } from '../utils/cache';

const COINMARKETCAL_API_BASE = 'https://developers.coinmarketcal.com/v1';

/**
 * CoinMarketCal API 类型定义
 */
export interface CoinMarketCalEvent {
  id: number;
  title: Record<string, string>; // { en: "...", ko: "...", ... }
  coins: Array<{
    id: number;
    name: string;
    symbol: string;
  }>;
  date_event: string;
  displayed_date: string; // 推荐使用这个字段显示
  can_occur_before: boolean;
  categories: Array<{
    id: number;
    name: string;
  }>;
  proof: string; // 截图证明链接
  source: string; // CoinMarketCal 详情页链接
  created_date: string;
  description: Record<string, string>;
  percentage: number; // 合法性评分
  vote_count: number;
  is_trending: boolean;
  is_popular: boolean;
  trending_index?: number;
  popular_index?: number;
  influential_score?: number; // 0-10
  catalyst_score?: number; // 0-10
  confirmed_by_officials?: boolean;
  alert_count?: number;
  vote_history?: Array<{
    date: string;
    percent: number;
  }>;
  view_history?: Array<{
    date: string;
    count: number;
  }>;
}

export interface CoinMarketCalCategory {
  id: number;
  name: string;
}

export interface CoinMarketCalCoin {
  id: number;
  name: string;
  symbol: string;
}

export interface CoinMarketCalEventsResponse {
  body: CoinMarketCalEvent[];
  _metadata: {
    max: number;
    page: number;
    page_count: number;
    total_count: number;
  };
  status: {
    error_code: number;
    error_message: string;
  };
}

export interface CoinMarketCalCategoriesResponse {
  body: CoinMarketCalCategory[];
  status: {
    error_code: number;
    error_message: string;
  };
}

export interface CoinMarketCalCoinsResponse {
  body: CoinMarketCalCoin[];
  status: {
    error_code: number;
    error_message: string;
  };
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
  cache: Cache | null
): Promise<Response> {
  try {
    const apiKey = getAPIKey('COINMARKETCAL');

    // 构建查询参数
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.append('page', params.page.toString());
    if (params.max) searchParams.append('max', params.max.toString());
    if (params.dateRangeStart) searchParams.append('dateRangeStart', params.dateRangeStart);
    if (params.dateRangeEnd) searchParams.append('dateRangeEnd', params.dateRangeEnd);
    if (params.coins) searchParams.append('coins', params.coins);
    if (params.categories) searchParams.append('categories', params.categories);
    if (params.sortBy) searchParams.append('sortBy', params.sortBy);
    if (params.showOnly) searchParams.append('showOnly', params.showOnly);
    if (params.showViews) searchParams.append('showViews', params.showViews.toString());
    if (params.showVotes) searchParams.append('showVotes', params.showVotes.toString());
    if (params.translations) searchParams.append('translations', params.translations);

    const url = `${COINMARKETCAL_API_BASE}/events?${searchParams.toString()}`;

    const response = await getOrSetCache(
      url,
      async () => {
        const cmcResponse = await fetch(url, {
          headers: {
            'x-api-key': apiKey,
            'Accept': 'application/json',
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
      cache
    );

    const data: CoinMarketCalEventsResponse = await response.json();

    if (data.status.error_code !== 0) {
      const workerResponse: WorkerResponse = {
        success: false,
        error: {
          code: 'COINMARKETCAL_API_ERROR',
          message: data.status.error_message || 'CoinMarketCal API returned an error',
        },
        timestamp: Date.now(),
      };

      return new Response(JSON.stringify(workerResponse), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const workerResponse: WorkerResponse<CoinMarketCalEventsResponse['body']> = {
      success: true,
      data: data.body,
      metadata: data._metadata,
      cached: response.headers.get('X-Cache-Status') === 'HIT',
      timestamp: Date.now(),
    };

    return new Response(JSON.stringify(workerResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
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
export async function getCategories(
  request: Request,
  cache: Cache | null
): Promise<Response> {
  try {
    const apiKey = getAPIKey('COINMARKETCAL');
    const url = `${COINMARKETCAL_API_BASE}/categories`;

    const response = await getOrSetCache(
      url,
      async () => {
        const cmcResponse = await fetch(url, {
          headers: {
            'x-api-key': apiKey,
            'Accept': 'application/json',
          },
        });

        if (!cmcResponse.ok) {
          const errorText = await cmcResponse.text();
          throw new Error(`CoinMarketCal API error: ${cmcResponse.status} ${errorText}`);
        }

        return cmcResponse;
      },
      { ttl: 3600 }, // 1 小时缓存
      cache
    );

    const data: CoinMarketCalCategoriesResponse = await response.json();

    if (data.status.error_code !== 0) {
      const workerResponse: WorkerResponse = {
        success: false,
        error: {
          code: 'COINMARKETCAL_API_ERROR',
          message: data.status.error_message || 'CoinMarketCal API returned an error',
        },
        timestamp: Date.now(),
      };

      return new Response(JSON.stringify(workerResponse), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const workerResponse: WorkerResponse<CoinMarketCalCategoriesResponse['body']> = {
      success: true,
      data: data.body,
      cached: response.headers.get('X-Cache-Status') === 'HIT',
      timestamp: Date.now(),
    };

    return new Response(JSON.stringify(workerResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
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
export async function getCoins(
  request: Request,
  cache: Cache | null
): Promise<Response> {
  try {
    const apiKey = getAPIKey('COINMARKETCAL');
    const url = `${COINMARKETCAL_API_BASE}/coins`;

    const response = await getOrSetCache(
      url,
      async () => {
        const cmcResponse = await fetch(url, {
          headers: {
            'x-api-key': apiKey,
            'Accept': 'application/json',
          },
        });

        if (!cmcResponse.ok) {
          const errorText = await cmcResponse.text();
          throw new Error(`CoinMarketCal API error: ${cmcResponse.status} ${errorText}`);
        }

        return cmcResponse;
      },
      { ttl: 3600 }, // 1 小时缓存
      cache
    );

    const data: CoinMarketCalCoinsResponse = await response.json();

    if (data.status.error_code !== 0) {
      const workerResponse: WorkerResponse = {
        success: false,
        error: {
          code: 'COINMARKETCAL_API_ERROR',
          message: data.status.error_message || 'CoinMarketCal API returned an error',
        },
        timestamp: Date.now(),
      };

      return new Response(JSON.stringify(workerResponse), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const workerResponse: WorkerResponse<CoinMarketCalCoinsResponse['body']> = {
      success: true,
      data: data.body,
      cached: response.headers.get('X-Cache-Status') === 'HIT',
      timestamp: Date.now(),
    };

    return new Response(JSON.stringify(workerResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
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
