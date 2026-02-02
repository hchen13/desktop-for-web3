/**
 * 速率限制工具
 * 使用 Cloudflare Workers KV 实现简单的速率限制
 */

export interface RateLimitOptions {
  maxRequests: number; // 最大请求数
  windowSeconds: number; // 时间窗口（秒）
  key?: string; // 自定义限制键（默认使用 IP）
}

/**
 * 检查速率限制
 * 
 * @param request 请求对象
 * @param options 限制选项
 * @param kv KV 存储（可选，如果未提供则跳过限制）
 * @returns 是否允许请求
 */
export async function checkRateLimit(
  request: Request,
  options: RateLimitOptions,
  kv?: KVNamespace
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  // 如果没有 KV，跳过限制（开发环境）
  if (!kv) {
    return { allowed: true, remaining: options.maxRequests, resetAt: Date.now() + options.windowSeconds * 1000 };
  }
  
  // 生成限制键
  const clientId = request.headers.get('CF-Connecting-IP') || 'unknown';
  const limitKey = options.key || `ratelimit:${clientId}`;
  
  // 获取当前计数
  const current = await kv.get(limitKey, 'json') as { count: number; resetAt: number } | null;
  const now = Date.now();
  const resetAt = now + options.windowSeconds * 1000;
  
  if (!current || current.resetAt < now) {
    // 首次请求或窗口已过期，重置计数
    await kv.put(limitKey, JSON.stringify({ count: 1, resetAt }), {
      expirationTtl: options.windowSeconds,
    });
    return { allowed: true, remaining: options.maxRequests - 1, resetAt };
  }
  
  // 检查是否超过限制
  if (current.count >= options.maxRequests) {
    return { allowed: false, remaining: 0, resetAt: current.resetAt };
  }
  
  // 增加计数
  const newCount = current.count + 1;
  await kv.put(limitKey, JSON.stringify({ count: newCount, resetAt: current.resetAt }), {
    expirationTtl: Math.ceil((current.resetAt - now) / 1000),
  });
  
  return { allowed: true, remaining: options.maxRequests - newCount, resetAt: current.resetAt };
}

/**
 * 创建速率限制中间件
 */
export function createRateLimitMiddleware(
  options: RateLimitOptions,
  kv?: KVNamespace
) {
  return async (request: Request): Promise<Response | null> => {
    const result = await checkRateLimit(request, options, kv);
    
    if (!result.allowed) {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `Rate limit exceeded. Try again after ${new Date(result.resetAt).toISOString()}`,
          },
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': String(options.maxRequests),
            'X-RateLimit-Remaining': String(result.remaining),
            'X-RateLimit-Reset': String(result.resetAt),
            'Retry-After': String(Math.ceil((result.resetAt - Date.now()) / 1000)),
          },
        }
      );
    }
    
    return null; // 允许请求继续
  };
}
