/**
 * Worker 共享类型定义
 */

export interface WorkerRequest {
  endpoint: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params?: Record<string, any>;
  body?: any;
}

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

export interface APIError {
  code: string;
  message: string;
  status?: number;
}

/**
 * Dune API 相关类型
 */
export interface DuneExecuteRequest {
  queryId: string;
  parameters?: Record<string, any>;
}

export interface DuneExecuteResponse {
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
}

/**
 * Etherscan API 相关类型
 */
export interface EtherscanGasOracleResponse {
  status: string;
  message: string;
  result: {
    LastBlock: string;
    SafeGasPrice: string;
    ProposeGasPrice: string;
    FastGasPrice: string;
    suggestBaseFee: string;
    gasUsedRatio: string;
  };
}

/**
 * CoinMarketCap API 相关类型
 */
export interface CoinMarketCapQuotesResponse {
  status: {
    timestamp: string;
    error_code: number;
    error_message: string | null;
  };
  data: Record<string, {
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
  }>;
}
