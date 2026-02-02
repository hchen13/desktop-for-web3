/**
 * Dune Analytics API 代理路由
 */

import type { DuneExecuteRequest, DuneExecuteResponse, WorkerResponse } from '../types';
import { getAPIKey } from '../utils/auth';
import { getOrSetCache } from '../utils/cache';

const DUNE_API_BASE = 'https://api.dune.com/api/v1';

/**
 * 执行 Dune 查询
 */
export async function executeDuneQuery(
  request: Request,
  body: DuneExecuteRequest,
  cache: Cache | null
): Promise<Response> {
  try {
    const apiKey = getAPIKey('DUNE');
    const { queryId, parameters } = body;
    
    // 构建 Dune API 请求
    const duneUrl = `${DUNE_API_BASE}/query/${queryId}/execute`;
    const duneRequest = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dune-API-Key': apiKey,
      },
      // Dune API 的 query_parameters 格式：对象，键名必须匹配查询中定义的参数名
      body: JSON.stringify(parameters ? { query_parameters: parameters } : {}),
    };
    
    // 使用缓存获取或执行查询
    const response = await getOrSetCache(
      `${duneUrl}:${JSON.stringify(parameters || {})}`,
      async () => {
        const duneResponse = await fetch(duneUrl, duneRequest);
        
        if (!duneResponse.ok) {
          const errorText = await duneResponse.text();
          throw new Error(`Dune API error: ${duneResponse.status} ${errorText}`);
        }
        
        return duneResponse;
      },
      { ttl: 300 }, // 5 分钟缓存
      cache
    );
    
    const data: any = await response.json();
    
    // Dune API 返回的 state 可能是 'QUERY_STATE_PENDING', 'QUERY_STATE_EXECUTING' 或 'QUERY_STATE_COMPLETED'
    // 转换为我们的格式
    const normalizedState = (data.state === 'QUERY_STATE_PENDING' || data.state === 'QUERY_STATE_EXECUTING') ? 'PENDING' : 
                           data.state === 'QUERY_STATE_COMPLETED' ? 'COMPLETED' :
                           data.state === 'QUERY_STATE_FAILED' ? 'FAILED' : data.state;
    
    const normalizedData: DuneExecuteResponse = {
      ...data,
      state: normalizedState as 'PENDING' | 'COMPLETED' | 'FAILED',
    };
    
    // 如果查询还在执行中，返回执行 ID
    if (normalizedData.state === 'PENDING') {
      const workerResponse: WorkerResponse<DuneExecuteResponse> = {
        success: true,
        data: normalizedData,
        cached: response.headers.get('X-Cache-Status') === 'HIT',
        timestamp: Date.now(),
      };
      
      return new Response(JSON.stringify(workerResponse), {
        status: 202, // Accepted
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // 查询完成，返回结果
    const workerResponse: WorkerResponse<DuneExecuteResponse> = {
      success: true,
      data: normalizedData,
      cached: response.headers.get('X-Cache-Status') === 'HIT',
      timestamp: Date.now(),
    };
    
    return new Response(JSON.stringify(workerResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[Dune] Error executing query:', error);
    
    const workerResponse: WorkerResponse = {
      success: false,
      error: {
        code: 'DUNE_API_ERROR',
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
 * 直接执行 Dune SQL 查询
 * 根据 Dune API 文档，需要先创建查询，然后执行
 * 注意：Dune API 不支持直接执行 SQL，需要先创建查询获得 query_id
 * 这里我们使用一个简化的方式：假设查询已预先创建好，通过 query_id 执行
 * 实际使用时，需要在 Dune 平台先创建查询，然后使用 query_id
 */
export async function executeDuneSQL(
  request: Request,
  sql: string,
  cache: Cache | null
): Promise<Response> {
  try {
    const apiKey = getAPIKey('DUNE');
    
    // 注意：Dune API 不支持直接执行 SQL
    // 需要先在 Dune 平台创建查询，获得 query_id
    // 这里我们返回一个错误提示，建议使用预创建的查询
    const workerResponse: WorkerResponse = {
      success: false,
      error: {
        code: 'DUNE_SQL_NOT_SUPPORTED',
        message: 'Dune API does not support direct SQL execution. Please create queries in Dune platform first and use query_id.',
      },
      timestamp: Date.now(),
    };
    
    return new Response(JSON.stringify(workerResponse), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[Dune] Error executing SQL:', error);
    
    const workerResponse: WorkerResponse = {
      success: false,
      error: {
        code: 'DUNE_SQL_ERROR',
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
 * 获取查询执行结果
 */
export async function getDuneQueryResult(
  request: Request,
  executionId: string,
  cache: Cache | null
): Promise<Response> {
  try {
    const apiKey = getAPIKey('DUNE');
    const duneUrl = `${DUNE_API_BASE}/execution/${executionId}/results`;
    
    const response = await getOrSetCache(
      duneUrl,
      async () => {
        const duneResponse = await fetch(duneUrl, {
          headers: {
            'X-Dune-API-Key': apiKey,
          },
        });
        
        if (!duneResponse.ok) {
          const errorText = await duneResponse.text();
          throw new Error(`Dune API error: ${duneResponse.status} ${errorText}`);
        }
        
        return duneResponse;
      },
      { ttl: 60 }, // 1 分钟缓存（查询结果可能还在更新）
      cache
    );
    
    const data: any = await response.json();
    
    // 标准化状态格式
    const normalizedState = data.state === 'QUERY_STATE_EXECUTING' ? 'PENDING' : 
                           data.state === 'QUERY_STATE_COMPLETED' ? 'COMPLETED' :
                           data.state === 'QUERY_STATE_FAILED' ? 'FAILED' : data.state;
    
    const normalizedData: DuneExecuteResponse = {
      ...data,
      state: normalizedState as 'PENDING' | 'COMPLETED' | 'FAILED',
    };
    
    const workerResponse: WorkerResponse<DuneExecuteResponse> = {
      success: true,
      data: normalizedData,
      cached: response.headers.get('X-Cache-Status') === 'HIT',
      timestamp: Date.now(),
    };
    
    return new Response(JSON.stringify(workerResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[Dune] Error getting query result:', error);
    
    const workerResponse: WorkerResponse = {
      success: false,
      error: {
        code: 'DUNE_API_ERROR',
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
