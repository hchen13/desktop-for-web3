/**
 * API KEY 认证工具
 * 从环境变量中安全获取 API KEY
 */

export function getAPIKey(service: 'DUNE' | 'ETHERSCAN' | 'COINMARKETCAP' | 'COINMARKETCAL' | 'RPC' | 'ALCHEMY'): string {
  const envKey = `${service}_API_KEY`;
  // 在 Cloudflare Workers 中，环境变量通过 globalThis 访问
  // 在本地开发时，wrangler dev 会注入环境变量
  const apiKey = (globalThis as any)[envKey];
  
  // Alchemy API key 是可选的（用于提升 RPC 稳定性）
  if (!apiKey && service !== 'ALCHEMY') {
    throw new Error(`Missing ${envKey} environment variable. Please set it using: wrangler secret put ${envKey}`);
  }
  
  return apiKey || '';
}

/**
 * 验证请求来源（可选：添加 CORS 或 API 密钥验证）
 */
export function validateRequest(request: Request): boolean {
  // 可以在这里添加请求验证逻辑
  // 例如：检查 Origin、Referer 等
  const origin = request.headers.get('Origin');
  
  // 允许来自 Extension 的请求（chrome-extension:// 协议）
  if (origin?.startsWith('chrome-extension://')) {
    return true;
  }
  
  // 允许来自 localhost 的请求（开发环境）
  if (origin?.includes('localhost') || origin?.includes('127.0.0.1')) {
    return true;
  }
  
  // 生产环境可以添加更严格的验证
  return true; // 暂时允许所有请求，后续可以加强
}
