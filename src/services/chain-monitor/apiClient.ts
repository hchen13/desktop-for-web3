/**
 * Worker API 客户端
 * 所有需要 API KEY 的请求都通过 Worker 代理
 */

// Worker URL 配置
let WORKER_URL = 'https://desktop-for-web3-api-proxy.gradients-tech.workers.dev';

/**
 * Worker API 响应类型
 */
export interface WorkerResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  cached?: boolean;
  timestamp?: number;
}

/**
 * 调用 Worker API
 */
async function callWorkerAPI<T = any>(
  endpoint: string,
  options: {
    method?: 'GET' | 'POST';
    params?: Record<string, any>;
    body?: any;
  } = {}
): Promise<WorkerResponse<T>> {
  const url = new URL(endpoint, WORKER_URL);
  
  // 添加查询参数
  if (options.params) {
    Object.entries(options.params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, String(value));
      }
    });
  }

  try {
    const response = await fetch(url.toString(), {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      // 尝试解析错误响应
      let errorData: WorkerResponse | null = null;
      try {
        errorData = await response.json();
      } catch {
        // 如果无法解析 JSON，使用默认错误
      }

      throw new Error(
        errorData?.error?.message || 
        `Worker API error: ${response.status} ${response.statusText}`
      );
    }

    const data: WorkerResponse<T> = await response.json();
    
    if (!data.success) {
      throw new Error(data.error?.message || 'Unknown error from Worker API');
    }

    return data;
  } catch (error) {
    // 降级为 debug 级别，避免控制台过多错误日志
    // Worker API 失败是预期行为，上层有 fallback 机制
    console.debug('[Worker API] Request failed:', error);
    throw error;
  }
}

/**
 * Worker API 客户端
 */
export const workerAPI = {
  /**
   * Dune Analytics API
   */
  dune: {
    /**
     * 执行 Dune 查询
     */
    executeQuery: async (queryId: string, parameters?: Record<string, any>) => {
      return callWorkerAPI<{
        execution_id: string;
        state: 'PENDING' | 'COMPLETED' | 'FAILED';
        submitted_at: string;
        execution_started_at?: string;
        execution_ended_at?: string;
        result?: {
          rows: any[];
          metadata: {
            column_names: string[];
            result_set_bytes: number;
            total_row_count: number;
          };
        };
      }>('/api/dune/execute', {
        method: 'POST',
        body: { queryId, parameters },
      });
    },

    /**
     * 获取查询执行结果
     */
    getQueryResult: async (executionId: string) => {
      return callWorkerAPI(`/api/dune/result/${executionId}`);
    },
  },

  /**
   * Etherscan API
   */
  etherscan: {
    /**
     * 获取 Gas Oracle 数据
     * @param chain 链名称：ethereum, polygon, bsc, arbitrum, optimism, base 等
     */
    getGasOracle: async (chain: string = 'ethereum') => {
      return callWorkerAPI<{
        LastBlock: string;
        SafeGasPrice: string;
        ProposeGasPrice: string;
        FastGasPrice: string;
        suggestBaseFee: string;
        gasUsedRatio: string;
      }>('/api/etherscan/gas-oracle', {
        params: { chain },
      });
    },

    /**
     * 获取最新区块号
     */
    getLatestBlock: async (chain: string = 'ethereum') => {
      return callWorkerAPI<{
        blockNumber: number;
        hex: string;
      }>('/api/etherscan/latest-block', {
        params: { chain },
      });
    },
  },

  /**
   * CoinMarketCap API
   */
  coinmarketcap: {
    /**
     * 获取加密货币报价
     * @param symbols 币种符号数组，如 ['BTC', 'ETH', 'SOL']
     */
    getQuotes: async (symbols: string[]) => {
      return callWorkerAPI<Record<string, {
        id: number;
        name: string;
        symbol: string;
        quote: {
          USD: {
            price: number;
            volume_24h: number;
            percent_change_24h: number;
            market_cap: number;
          };
        };
      }>>('/api/coinmarketcap/quotes', {
        params: { symbols: symbols.join(',') },
      });
    },
  },

  /**
   * 健康检查
   */
  health: async () => {
    return callWorkerAPI<{ message: string; timestamp: number }>('/health');
  },

  /**
   * 链上监控 API
   */
  blockchainMonitor: {
    /**
     * 获取所有监控指标
     * @param chain 链 ID：btc, eth, sol, bsc, polygon
     */
    getAllMetrics: async (chain: string = 'eth') => {
      return callWorkerAPI('/api/blockchain-monitor/all-metrics', {
        params: { chain },
      });
    },

    /**
     * 获取区块时间延迟
     */
    getBlockTimeDelay: async (chain: string = 'eth') => {
      return callWorkerAPI<{
        blockNumber: number;
        latestBlockTime: number; // Unix timestamp (seconds)
        delaySeconds: number;
        fallback?: 'dune';
      }>('/api/blockchain-monitor/block-time-delay', {
        params: { chain },
      });
    },

    /**
     * 获取 Gas 价格（仅 EVM 链）
     */
    getGasPrice: async (chain: string = 'eth') => {
      return callWorkerAPI<{
        avgGasGwei: number;
        medianGasGwei: number;
        minGasGwei: number;
        maxGasGwei: number;
        unit: 'gwei' | 'sat/vB' | 'SOL';
      }>('/api/blockchain-monitor/gas-price', {
        params: { chain },
      });
    },

    /**
     * 获取 TPS（最近1小时）
     */
    getTPS: async (chain: string = 'eth') => {
      return callWorkerAPI<{
        tps: number;
        txCount?: number;
        sampleCount?: number;
        periodSeconds?: number;
        source?: string;
      }>('/api/blockchain-monitor/tps', {
        params: { chain },
      });
    },

    /**
     * 获取活跃地址数（24小时）
     */
    getActiveAddresses: async (chain: string = 'eth') => {
      return callWorkerAPI<{
        activeAddresses: number;
        source?: string;
      }>('/api/blockchain-monitor/active-addresses', {
        params: { chain },
      });
    },

    /**
     * 获取 TVL
     */
    getTVL: async (chain: string = 'eth') => {
      return callWorkerAPI<{
        tvl: number;
        tvlUSD: number;
        message?: string;
      }>('/api/blockchain-monitor/tvl', {
        params: { chain },
      });
    },

    /**
     * 获取 Nakamoto 系数
     */
    getNakamotoCoefficient: async (chain: string = 'eth') => {
      return callWorkerAPI<{
        nakamotoCoefficient: number;
        message?: string;
      }>('/api/blockchain-monitor/nakamoto-coefficient', {
        params: { chain },
      });
    },

    /**
     * 获取鲸鱼警报
     */
    getWhaleAlerts: async (chain: string = 'eth') => {
      return callWorkerAPI<{
        alerts: Array<{
          hash: string;
          from: string;
          to: string;
          amount: number;
          blockTime: string;
        }>;
        count: number;
      }>('/api/blockchain-monitor/whale-alerts', {
        params: { chain },
      });
    },

    /**
     * 获取最新区块信息
     */
    getLatestBlock: async (chain: string = 'eth') => {
      return callWorkerAPI<{
        blockNumber: number;
        blockTime: string;
        secondsAgo: number;
      }>('/api/blockchain-monitor/latest-block', {
        params: { chain },
      });
    },
  },
};

/**
 * 设置 Worker URL（用于动态配置）
 */
export function setWorkerURL(url: string): void {
  WORKER_URL = url;
}

/**
 * 获取当前 Worker URL
 */
export function getWorkerURL(): string {
  return WORKER_URL;
}
