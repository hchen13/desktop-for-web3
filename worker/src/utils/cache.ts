/**
 * 缓存工具
 * 使用 Cloudflare Workers Cache API 实现响应缓存
 */

export interface CacheOptions {
  ttl?: number; // 缓存时间（秒），默认 300 秒（5 分钟）
  key?: string; // 自定义缓存键
}

/**
 * 生成缓存键
 */
function generateCacheKey(url: string, options?: CacheOptions): string {
  if (options?.key) {
    return options.key;
  }
  return `api:${url}`;
}

/**
 * 从缓存获取数据
 */
export async function getCached(cacheKey: string, cache: Cache | null): Promise<Response | null> {
  if (!cache) {
    return null;
  }
  
  try {
    const cachedResponse = await cache.match(cacheKey);
    return cachedResponse;
  } catch (error) {
    console.error('[Cache] Error getting cached data:', error);
    return null;
  }
}

/**
 * 将响应存入缓存
 */
export async function setCached(
  cacheKey: string,
  response: Response,
  options: CacheOptions,
  cache: Cache | null
): Promise<void> {
  if (!cache) {
    return;
  }
  
  try {
    // 创建可缓存的响应副本
    const cacheResponse = response.clone();
    
    // 设置缓存头
    const headers = new Headers(cacheResponse.headers);
    headers.set('Cache-Control', `public, max-age=${options.ttl || 300}`);
    headers.set('X-Cached-At', new Date().toISOString());
    
    const cachedResponse = new Response(cacheResponse.body, {
      status: cacheResponse.status,
      statusText: cacheResponse.statusText,
      headers,
    });
    
    await cache.put(cacheKey, cachedResponse);
  } catch (error) {
    console.error('[Cache] Error setting cached data:', error);
  }
}

/**
 * 获取或设置缓存
 */
export async function getOrSetCache(
  url: string,
  fetchFn: () => Promise<Response>,
  options: CacheOptions,
  cache: Cache | null
): Promise<Response> {
  const cacheKey = generateCacheKey(url, options);
  
  // 尝试从缓存获取
  const cached = await getCached(cacheKey, cache);
  if (cached) {
    // 添加缓存标识头
    const headers = new Headers(cached.headers);
    headers.set('X-Cache-Status', 'HIT');
    return new Response(cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers,
    });
  }
  
  // 缓存未命中，获取新数据
  const response = await fetchFn();
  
  // 只缓存成功的响应
  if (response.ok) {
    await setCached(cacheKey, response, options, cache);
  }
  
  // 添加缓存标识头
  const headers = new Headers(response.headers);
  headers.set('X-Cache-Status', 'MISS');
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
