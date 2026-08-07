/**
 * Wallstreetcn 宏观日历代理。
 *
 * Wallstreetcn 的日历接口是公开接口，但需要浏览器客户端标识，且扩展
 * 直接请求会受到 CORS 影响，所以统一由 Worker 代理并缓存。
 */

import type { WorkerResponse } from '../types';
import { getOrSetCache } from '../utils/cache';

const WALLSTREETCN_API_BASE = 'https://api-one-wscn.awtmt.com/apiv1';
const CLIENT_HEADERS = {
  'X-Client-Type': 'pc',
  'X-Ivanka-Platform': 'wscn-platform',
  'X-Ivanka-App': 'wscn|web|0.40.46|0.0|0',
  Accept: 'application/json',
};

export interface WallstreetcnMacroEvent {
  id: number | string;
  public_date: number;
  country?: string;
  country_id?: string;
  title: string;
  event?: string;
  importance: number;
  actual?: string;
  forecast?: string;
  previous?: string;
  revised?: string;
  unit?: string;
  period?: string;
  uri?: string;
  flag_uri?: string;
}

interface WallstreetcnResponse {
  code: number;
  message?: string;
  data?: {
    items?: WallstreetcnMacroEvent[];
    total?: number;
  };
}

function response<T>(body: WorkerResponse<T>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parseDate(value: string | null, name: string): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${name} must be an ISO date (YYYY-MM-DD)`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${name} is invalid`);
  }
  return date;
}

/** 获取指定 UTC 日期范围内的最高重要性事件（3 星）。 */
export async function getMacroEvents(request: Request, cache: Cache | null): Promise<Response> {
  try {
    const requestUrl = new URL(request.url);
    const start = parseDate(requestUrl.searchParams.get('start'), 'start');
    const end = parseDate(requestUrl.searchParams.get('end'), 'end');
    if (end < start) {
      return response(
        {
          success: false,
          error: { code: 'INVALID_PARAM', message: 'end must be on or after start' },
        },
        400,
      );
    }

    const upstreamUrl = new URL(`${WALLSTREETCN_API_BASE}/finance/macrodatas`);
    upstreamUrl.searchParams.set('start', Math.floor(start.getTime() / 1000).toString());
    // Inclusive end-of-day, matching the Wallstreetcn web calendar.
    upstreamUrl.searchParams.set('end', Math.floor(end.getTime() / 1000 + 86399).toString());
    upstreamUrl.searchParams.set('importances', '3');

    const upstreamResponse = await getOrSetCache(
      upstreamUrl.toString(),
      async () => {
        const upstream = await fetch(upstreamUrl.toString(), { headers: CLIENT_HEADERS });
        if (!upstream.ok) {
          const text = await upstream.text();
          throw new Error(`Wallstreetcn API error: ${upstream.status} ${text}`);
        }
        return upstream;
      },
      { ttl: 300 },
      cache,
    );

    const data: WallstreetcnResponse = await upstreamResponse.json();
    if (data.code !== 20000 || !Array.isArray(data.data?.items)) {
      return response(
        {
          success: false,
          error: {
            code: 'WALLSTREETCN_API_ERROR',
            message: data.message || 'Wallstreetcn returned an invalid response',
          },
        },
        502,
      );
    }

    return response({
      success: true,
      data: data.data.items,
      metadata: { total: data.data.total ?? data.data.items.length },
      cached: upstreamResponse.headers.get('X-Cache-Status') === 'HIT',
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('[Wallstreetcn] Error getting macro events:', error);
    return response(
      {
        success: false,
        error: {
          code: 'WALLSTREETCN_API_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        timestamp: Date.now(),
      },
      502,
    );
  }
}
