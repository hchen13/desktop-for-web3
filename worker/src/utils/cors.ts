/**
 * CORS 工具
 * 处理跨域请求
 */

export interface CORSOptions {
  allowedOrigins?: string[];
  allowedMethods?: string[];
  allowedHeaders?: string[];
  maxAge?: number;
}

const DEFAULT_OPTIONS: Required<CORSOptions> = {
  allowedOrigins: ['*'], // 允许所有来源（生产环境应该限制）
  allowedMethods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400, // 24 小时
};

/**
 * 处理 CORS 预检请求
 */
export function handleCORS(request: Request, options?: CORSOptions): Response | null {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  if (request.method === 'OPTIONS') {
    const origin = request.headers.get('Origin');
    const method = request.headers.get('Access-Control-Request-Method');
    const headers = request.headers.get('Access-Control-Request-Headers');
    
    // 检查来源是否允许
    if (origin && (opts.allowedOrigins.includes('*') || opts.allowedOrigins.includes(origin))) {
      const responseHeaders = new Headers({
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': opts.allowedMethods.join(', '),
        'Access-Control-Allow-Headers': opts.allowedHeaders.join(', '),
        'Access-Control-Max-Age': String(opts.maxAge),
      });
      
      return new Response(null, { status: 204, headers: responseHeaders });
    }
    
    return new Response(null, { status: 403 });
  }
  
  return null;
}

/**
 * 添加 CORS 头到响应
 */
export function addCORSHeaders(response: Response, request: Request, options?: CORSOptions): Response {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const origin = request.headers.get('Origin');
  
  if (!origin) {
    return response;
  }
  
  // 检查来源是否允许
  if (opts.allowedOrigins.includes('*') || opts.allowedOrigins.includes(origin)) {
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Access-Control-Expose-Headers', 'X-Cache-Status, X-RateLimit-Limit, X-RateLimit-Remaining');
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  
  return response;
}
