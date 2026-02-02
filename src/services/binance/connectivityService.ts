/**
 * Binance 连通性探测服务
 * 初始化时测试 Binance.com 和 Binance.US 的连通性，选择最优数据源
 */

// 是否在开发模式
const isDev = import.meta.env.DEV;

// API 端点（开发模式使用 Vite 代理）
const BINANCE_COM_PING = isDev ? '/binance-api/api/v3/ping' : 'https://api.binance.com/api/v3/ping';
const BINANCE_US_PING = isDev ? '/binance-us-api/api/v3/ping' : 'https://api.binance.us/api/v3/ping';

// 超时时间（毫秒）
const PING_TIMEOUT = 3000;

/**
 * 数据源类型
 */
export type DataSource = 'binance.com' | 'binance.us' | 'none';

/**
 * 连通性探测结果
 */
export interface ConnectivityResult {
  source: DataSource;
  latency: number | null;
}

// 当前数据源（单例状态）
let currentSource: DataSource = 'none';
let isInitialized = false;

/**
 * 带超时的 fetch
 */
async function fetchWithTimeout(url: string, timeout: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * 测试单个端点的连通性
 */
async function testEndpoint(url: string): Promise<{ success: boolean; latency: number }> {
  const start = performance.now();

  try {
    const response = await fetchWithTimeout(url, PING_TIMEOUT);
    const latency = performance.now() - start;

    if (response.ok) {
      return { success: true, latency };
    }
    return { success: false, latency: -1 };
  } catch (error) {
    console.warn(`[Connectivity] Failed to reach ${url}:`, error);
    return { success: false, latency: -1 };
  }
}

/**
 * 执行连通性探测
 * 优先测试 Binance.com，成功则使用；否则测试 Binance.US
 */
export async function probeConnectivity(): Promise<ConnectivityResult> {
  console.log('[Connectivity] Starting connectivity probe...');

  // 先测试 Binance.com
  const comResult = await testEndpoint(BINANCE_COM_PING);
  if (comResult.success) {
    console.log(`[Connectivity] Binance.com reachable (latency: ${comResult.latency.toFixed(0)}ms)`);
    currentSource = 'binance.com';
    isInitialized = true;
    return { source: 'binance.com', latency: comResult.latency };
  }

  // Binance.com 失败，测试 Binance.US
  console.log('[Connectivity] Binance.com unreachable, trying Binance.US...');
  const usResult = await testEndpoint(BINANCE_US_PING);
  if (usResult.success) {
    console.log(`[Connectivity] Binance.US reachable (latency: ${usResult.latency.toFixed(0)}ms)`);
    currentSource = 'binance.us';
    isInitialized = true;
    return { source: 'binance.us', latency: usResult.latency };
  }

  // 两者都失败
  console.error('[Connectivity] Both Binance.com and Binance.US are unreachable');
  currentSource = 'none';
  isInitialized = true;
  return { source: 'none', latency: null };
}

/**
 * 获取当前数据源
 */
export function getCurrentSource(): DataSource {
  return currentSource;
}

/**
 * 检查是否已完成初始化探测
 */
export function isConnectivityInitialized(): boolean {
  return isInitialized;
}

/**
 * 重置连通性状态（用于重新探测）
 */
export function resetConnectivity(): void {
  currentSource = 'none';
  isInitialized = false;
}

/**
 * 根据当前数据源获取 REST API 基础 URL
 */
export function getRestApiBase(): string {
  if (isDev) {
    // 开发模式使用 Vite 代理
    switch (currentSource) {
      case 'binance.com':
        return '/binance-api/api/v3';
      case 'binance.us':
        return '/binance-us-api/api/v3';
      default:
        return '/binance-api/api/v3';
    }
  }
  // 生产模式直接访问 API
  switch (currentSource) {
    case 'binance.com':
      return 'https://api.binance.com/api/v3';
    case 'binance.us':
      return 'https://api.binance.us/api/v3';
    default:
      // 默认使用 binance.com，让请求自己失败
      return 'https://api.binance.com/api/v3';
  }
}

/**
 * 根据当前数据源获取 BAPI 基础 URL（用于币种列表等）
 */
export function getBapiBase(): string {
  if (isDev) {
    // 开发模式使用 Vite 代理
    switch (currentSource) {
      case 'binance.com':
        return '/binance-bapi';
      case 'binance.us':
        return '/binance-us-bapi';
      default:
        return '/binance-bapi';
    }
  }
  // 生产模式直接访问 API
  switch (currentSource) {
    case 'binance.com':
      return 'https://www.binance.com';
    case 'binance.us':
      return 'https://www.binance.us';
    default:
      return 'https://www.binance.com';
  }
}

/**
 * 根据当前数据源获取 WebSocket 流 URL
 */
export function getWsStreamUrl(): string {
  switch (currentSource) {
    case 'binance.com':
      return 'wss://stream.binance.com:9443/stream';
    case 'binance.us':
      return 'wss://stream.binance.us:9443/stream';
    default:
      return 'wss://stream.binance.com:9443/stream';
  }
}
