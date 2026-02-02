/**
 * Dune 查询 ID 配置
 * 
 * 使用参数化查询，每个指标只需创建一个查询，通过参数传递链信息
 * 
 * 获取 query_id 的方法：
 * 1. 在 Dune 平台创建并保存参数化查询
 * 2. 查看浏览器地址栏，URL 格式：https://dune.com/queries/123456/1234
 * 3. 第一个数字（123456）就是 query_id
 */

/**
 * 链到 Dune Namespace 的映射
 */
export const CHAIN_TO_NAMESPACE: Record<string, string> = {
  btc: 'bitcoin',
  eth: 'ethereum',
  sol: 'solana',
  bsc: 'bnb',
  polygon: 'polygon',
};

/**
 * 链到表字段的映射（不同链的表结构可能不同）
 */
export interface ChainTableFields {
  blockNumberField: string; // 区块号字段名
  blockTimeField: string; // 区块时间字段名
  blockTable: string; // 区块表名
  txTable: string; // 交易表名
  valueDivisor: number; // 值转换除数（ETH: 1e18, BTC: 1e8）
}

export const CHAIN_TABLE_FIELDS: Record<string, ChainTableFields> = {
  btc: {
    blockNumberField: 'height',
    blockTimeField: 'time', // Bitcoin 表使用 'time' 字段
    blockTable: 'bitcoin.blocks',
    txTable: 'bitcoin.transactions',
    valueDivisor: 1e8,
  },
  eth: {
    blockNumberField: 'number',
    blockTimeField: 'time',
    blockTable: 'ethereum.blocks',
    txTable: 'ethereum.transactions',
    valueDivisor: 1e18,
  },
  sol: {
    blockNumberField: 'slot',
    blockTimeField: 'time', // Solana 表可能使用 'time' 而不是 'block_time'
    blockTable: 'solana.blocks',
    txTable: 'solana.transactions',
    valueDivisor: 1e9, // SOL 使用 9 位小数
  },
  bsc: {
    blockNumberField: 'number',
    blockTimeField: 'time',
    blockTable: 'bnb.blocks',
    txTable: 'bnb.transactions',
    valueDivisor: 1e18,
  },
  polygon: {
    blockNumberField: 'number',
    blockTimeField: 'time',
    blockTable: 'polygon.blocks',
    txTable: 'polygon.transactions',
    valueDivisor: 1e18,
  },
};

/**
 * 指标查询 ID 配置（按链配置）
 * 由于不同链的表结构不同，每个链需要单独的查询
 */
export const METRIC_QUERY_IDS: Record<string, Record<string, number>> = {
  blockTimeDelay: {
    eth: 6565581, // ✅ 已配置（参数化查询，支持所有 EVM 链）
    btc: 6565798, // ✅ 已配置（硬编码查询）
    sol: 6565820, // ✅ 已配置（硬编码查询）
    // BSC 和 Polygon 使用 ETH 的参数化查询
  },
  gasPrice: {
    eth: 0,
    bsc: 0,
    polygon: 0,
  },
  tps: {
    eth: 6568026, // 参数化查询，支持所有 EVM 链
    btc: 6568039, // 硬编码查询
    sol: 0, // SOL 使用 RPC，不需要 Dune query ID
    bsc: 6568026, // 使用 ETH 的参数化查询
    polygon: 6568026, // 使用 ETH 的参数化查询
  },
  activeAddresses: {
    eth: 6568351, // ✅ 已配置（参数化查询，支持所有 EVM 链）
    btc: 6568369, // ✅ 已配置（硬编码查询）
    sol: 6568389, // ✅ 已配置（硬编码查询）
    bsc: 6568351, // 使用 ETH 的参数化查询
    polygon: 6568351, // 使用 ETH 的参数化查询
  },
  tvl: {
    eth: 0,
    btc: 0, // BTC 忽略 TVL，不需要 query ID
    sol: 0,
    bsc: 0,
    polygon: 0,
  },
};

/**
 * 获取指定指标和链的查询 ID
 */
export function getQueryId(metric: string, chain?: string): number | undefined {
  const chainLower = chain?.toLowerCase() || 'eth';
  const metricQueries = METRIC_QUERY_IDS[metric];
  if (!metricQueries) return undefined;
  return metricQueries[chainLower];
}

/**
 * 获取链的 Dune Namespace
 */
export function getDuneNamespace(chain: string): string {
  const chainLower = chain.toLowerCase();
  const namespace = CHAIN_TO_NAMESPACE[chainLower];
  if (!namespace) {
    throw new Error(`Unsupported chain: ${chain}`);
  }
  return namespace;
}

/**
 * 获取链的表字段配置
 */
export function getChainTableFields(chain: string): ChainTableFields {
  const chainLower = chain.toLowerCase();
  const fields = CHAIN_TABLE_FIELDS[chainLower];
  if (!fields) {
    throw new Error(`Unsupported chain: ${chain}`);
  }
  return fields;
}

/**
 * 验证查询 ID 是否已配置
 */
export function isQueryIdConfigured(metric: string, chain?: string): boolean {
  const queryId = getQueryId(metric, chain);
  return queryId !== undefined && queryId > 0;
}

/**
 * 构建查询参数（用于参数化查询）
 * 根据指标类型只传递该指标实际需要的参数
 */
export function buildQueryParameters(chain: string, metric?: string, additionalParams?: Record<string, any>): Record<string, any> {
  const namespace = getDuneNamespace(chain);
  const fields = getChainTableFields(chain);
  
  // 根据指标类型返回对应的参数
  const baseParams: Record<string, any> = {
    namespace,
    block_number_field: fields.blockNumberField,
    block_time_field: fields.blockTimeField,
    block_table: fields.blockTable,
    tx_table: fields.txTable,
    value_divisor: fields.valueDivisor,
  };
  
  // 根据指标类型只返回需要的参数
  const chainLower = chain.toLowerCase();
  switch (metric) {
    case 'blockTimeDelay':
      // BTC 和 SOL 是硬编码查询，不需要参数
      if (['btc', 'sol'].includes(chainLower)) {
        return {};
      }
      return {
        block_number_field: fields.blockNumberField,
        block_time_field: fields.blockTimeField,
        block_table: fields.blockTable,
        ...additionalParams,
      };
    case 'gasPrice':
      return {
        tx_table: fields.txTable,
        ...additionalParams,
      };
    case 'tps':
      return {
        tx_table: fields.txTable,
        ...additionalParams,
      };
    case 'activeAddresses':
      // BTC 和 SOL 是硬编码查询，不需要参数
      if (['btc', 'sol'].includes(chain.toLowerCase())) {
        return {};
      }
      // EVM 链只需要 tx_table 参数
      return {
        tx_table: fields.txTable,
        ...additionalParams,
      };
    case 'tvl':
      return {
        namespace,
        ...additionalParams,
      };
    default:
      // 默认返回所有参数（向后兼容）
      return {
        ...baseParams,
        ...additionalParams,
      };
  }
}
