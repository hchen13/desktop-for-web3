import type { ActiveAddresses, BlockTimeDelay, ChainId, GasPrice, TPS } from './types';

const REQUEST_TIMEOUT_MS = 8000;
const EVM_SAMPLE_BLOCKS = 6;
const SOL_SAMPLE_BLOCK_LOOKBACK = 24;

const EVM_RPC_ENDPOINTS: Record<Exclude<ChainId, 'btc' | 'sol'>, string[]> = {
  eth: ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com'],
  bsc: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.binance.org/'],
  polygon: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon-rpc.com'],
};

const SOL_RPC_ENDPOINTS = ['https://solana-rpc.publicnode.com'];
const BTC_REST_ENDPOINTS = ['https://blockstream.info/api'];

interface EVMTransaction {
  from?: string;
  to?: string | null;
}

interface EVMBlock {
  number: string;
  timestamp: string;
  transactions?: EVMTransaction[];
}

interface BTCBlock {
  id?: string;
  height: number;
  timestamp: number;
  tx_count?: number;
}

interface BTCTx {
  vin?: Array<{ prevout?: { scriptpubkey_address?: string } }>;
  vout?: Array<{ scriptpubkey_address?: string }>;
}

type SolanaAccountKey = string | { pubkey?: string };

interface SolanaTransaction {
  transaction?: {
    message?: {
      accountKeys?: SolanaAccountKey[];
    };
  };
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithTimeout(url, init);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
}

async function withCandidates<T>(
  candidates: string[],
  run: (endpoint: string) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (const endpoint of candidates) {
    try {
      return await run(endpoint);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('All endpoints failed');
}

async function jsonRPC<T>(endpoints: string[], method: string, params: unknown[] = []): Promise<T> {
  return withCandidates(endpoints, async (endpoint) => {
    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`RPC request failed: ${response.status}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`RPC error: ${data.error.message || JSON.stringify(data.error)}`);
    }

    return data.result as T;
  });
}

function getEVMEndpoints(chain: ChainId): string[] {
  if (chain === 'btc' || chain === 'sol') {
    throw new Error(`Unsupported EVM chain: ${chain}`);
  }
  return EVM_RPC_ENDPOINTS[chain];
}

async function getEVMBlock(chain: Exclude<ChainId, 'btc' | 'sol'>): Promise<BlockTimeDelay> {
  const block = await jsonRPC<EVMBlock>(getEVMEndpoints(chain), 'eth_getBlockByNumber', [
    'latest',
    false,
  ]);
  const blockNumber = parseInt(block.number, 16);
  const timestamp = parseInt(block.timestamp, 16);
  const now = Math.floor(Date.now() / 1000);

  return {
    blockNumber,
    latestBlockTime: timestamp,
    delaySeconds: Math.max(0, now - timestamp),
    source: 'rpc',
  };
}

async function getBTCBlock(): Promise<BlockTimeDelay> {
  return withCandidates(BTC_REST_ENDPOINTS, async (endpoint) => {
    const height = Number((await fetchText(`${endpoint}/blocks/tip/height`)).trim());
    const hash = (await fetchText(`${endpoint}/block-height/${height}`)).trim();
    const block = await fetchJSON<BTCBlock>(`${endpoint}/block/${hash}`);
    const now = Math.floor(Date.now() / 1000);

    return {
      blockNumber: block.height,
      latestBlockTime: block.timestamp,
      delaySeconds: Math.max(0, now - block.timestamp),
      source: 'rpc',
    };
  });
}

async function getSOLBlock(): Promise<BlockTimeDelay> {
  const slot = await jsonRPC<number>(SOL_RPC_ENDPOINTS, 'getSlot', [{ commitment: 'confirmed' }]);
  const blockTime = await jsonRPC<number | null>(SOL_RPC_ENDPOINTS, 'getBlockTime', [slot]);
  const now = Math.floor(Date.now() / 1000);
  const timestamp = blockTime || now;

  return {
    blockNumber: slot,
    latestBlockTime: timestamp,
    delaySeconds: Math.max(0, now - timestamp),
    source: 'rpc',
  };
}

export async function getBlockTimeDelayRPC(chain: string): Promise<BlockTimeDelay> {
  const chainLower = chain.toLowerCase() as ChainId;

  if (chainLower === 'btc') {
    return getBTCBlock();
  }
  if (chainLower === 'sol') {
    return getSOLBlock();
  }
  if (chainLower === 'eth' || chainLower === 'bsc' || chainLower === 'polygon') {
    return getEVMBlock(chainLower);
  }

  throw new Error(`Unsupported chain: ${chain}`);
}

async function getEVMGasPrice(chain: Exclude<ChainId, 'btc' | 'sol'>): Promise<GasPrice> {
  const gasPriceHex = await jsonRPC<string>(getEVMEndpoints(chain), 'eth_gasPrice');
  const gasPriceWei = parseInt(gasPriceHex, 16);
  const gasPriceGwei = gasPriceWei / 1e9;

  return {
    avgGasGwei: gasPriceGwei,
    medianGasGwei: gasPriceGwei,
    minGasGwei: gasPriceGwei * 0.9,
    maxGasGwei: gasPriceGwei * 1.1,
    unit: 'gwei',
    source: 'rpc',
  };
}

async function getBTCFeeRate(): Promise<GasPrice> {
  return withCandidates(BTC_REST_ENDPOINTS, async (endpoint) => {
    const estimates = await fetchJSON<Record<string, number>>(`${endpoint}/fee-estimates`);
    const feeRates = Object.values(estimates).filter(Number.isFinite);
    if (feeRates.length === 0) {
      throw new Error('No BTC fee estimates returned');
    }
    const targetFee = estimates['6'] || estimates['3'] || estimates['1'] || feeRates[0];

    return {
      avgGasGwei: targetFee,
      medianGasGwei: targetFee,
      minGasGwei: Math.min(...feeRates),
      maxGasGwei: Math.max(...feeRates),
      unit: 'sat/vB',
      source: 'rpc',
    };
  });
}

async function getSOLFeeRate(): Promise<GasPrice> {
  const baseFeeLamports = 5000;
  const fees = await jsonRPC<Array<{ prioritizationFee?: number }>>(
    SOL_RPC_ENDPOINTS,
    'getRecentPrioritizationFees',
    [[]],
  );
  const priorityFees = fees
    .map((fee) => fee.prioritizationFee || 0)
    .filter((fee) => Number.isFinite(fee) && fee >= 0)
    .sort((a, b) => a - b);
  const medianPriorityFee = priorityFees[Math.floor(priorityFees.length / 2)] || 0;
  const maxPriorityFee = priorityFees[priorityFees.length - 1] || 0;
  const totalFee = baseFeeLamports + medianPriorityFee;

  return {
    avgGasGwei: totalFee / 1e9,
    medianGasGwei: totalFee / 1e9,
    minGasGwei: baseFeeLamports / 1e9,
    maxGasGwei: (baseFeeLamports + maxPriorityFee) / 1e9,
    unit: 'SOL',
    source: 'rpc',
  };
}

export async function getGasPriceRPC(chain: string): Promise<GasPrice> {
  const chainLower = chain.toLowerCase() as ChainId;

  if (chainLower === 'btc') {
    return getBTCFeeRate();
  }
  if (chainLower === 'sol') {
    return getSOLFeeRate();
  }
  if (chainLower === 'eth' || chainLower === 'bsc' || chainLower === 'polygon') {
    return getEVMGasPrice(chainLower);
  }

  throw new Error(`Unsupported chain: ${chain}`);
}

async function getEVMRecentBlocks(
  chain: Exclude<ChainId, 'btc' | 'sol'>,
  count = EVM_SAMPLE_BLOCKS,
): Promise<EVMBlock[]> {
  const endpoints = getEVMEndpoints(chain);
  const latestHex = await jsonRPC<string>(endpoints, 'eth_blockNumber');
  const latest = parseInt(latestHex, 16);
  const blocks: EVMBlock[] = [];

  for (let i = 0; i < count; i += 1) {
    const blockNumber = `0x${(latest - i).toString(16)}`;
    const block = await jsonRPC<EVMBlock | null>(endpoints, 'eth_getBlockByNumber', [
      blockNumber,
      true,
    ]);
    if (block) {
      blocks.push(block);
    }
  }

  if (blocks.length === 0) {
    throw new Error('No EVM sample blocks returned');
  }
  return blocks;
}

function getBlockPeriodSeconds(timestamps: number[]): number {
  const sorted = timestamps.filter(Number.isFinite).sort((a, b) => b - a);
  if (sorted.length < 2) {
    return 1;
  }
  return Math.max(1, sorted[0] - sorted[sorted.length - 1]);
}

async function getEVMTPS(chain: Exclude<ChainId, 'btc' | 'sol'>): Promise<TPS> {
  const blocks = await getEVMRecentBlocks(chain);
  const timestamps = blocks.map((block) => parseInt(block.timestamp, 16));
  const periodSeconds = getBlockPeriodSeconds(timestamps);
  const txCount = blocks.reduce((sum, block) => sum + (block.transactions?.length || 0), 0);

  return {
    tps: txCount / periodSeconds,
    txCount,
    sampleCount: blocks.length,
    periodSeconds,
    source: 'rpc',
  };
}

async function getBTCRecentBlocks(): Promise<BTCBlock[]> {
  return withCandidates(BTC_REST_ENDPOINTS, async (endpoint) => {
    const blocks = await fetchJSON<BTCBlock[]>(`${endpoint}/blocks`);
    if (!Array.isArray(blocks) || blocks.length === 0) {
      throw new Error('No BTC blocks returned');
    }
    return blocks;
  });
}

async function getBTCTPS(): Promise<TPS> {
  const blocks = await getBTCRecentBlocks();
  const timestamps = blocks.map((block) => block.timestamp);
  const periodSeconds = getBlockPeriodSeconds(timestamps);
  const txCount = blocks.reduce((sum, block) => sum + (block.tx_count || 0), 0);

  return {
    tps: txCount / periodSeconds,
    txCount,
    sampleCount: blocks.length,
    periodSeconds,
    source: 'rpc',
  };
}

async function getSOLTPS(): Promise<TPS> {
  const samples = await jsonRPC<
    Array<{ numTransactions?: number; numNonVoteTransactions?: number; samplePeriodSecs?: number }>
  >(SOL_RPC_ENDPOINTS, 'getRecentPerformanceSamples', [10]);
  if (!samples || samples.length === 0) {
    throw new Error('No Solana performance samples returned');
  }

  let txCount = 0;
  let periodSeconds = 0;
  for (const sample of samples) {
    txCount += sample.numNonVoteTransactions ?? sample.numTransactions ?? 0;
    periodSeconds += sample.samplePeriodSecs || 60;
  }

  return {
    tps: txCount / Math.max(1, periodSeconds),
    txCount,
    sampleCount: samples.length,
    periodSeconds,
    source: 'rpc',
  };
}

export async function getTPSRPC(chain: string): Promise<TPS> {
  const chainLower = chain.toLowerCase() as ChainId;

  if (chainLower === 'btc') {
    return getBTCTPS();
  }
  if (chainLower === 'sol') {
    return getSOLTPS();
  }
  if (chainLower === 'eth' || chainLower === 'bsc' || chainLower === 'polygon') {
    return getEVMTPS(chainLower);
  }

  throw new Error(`Unsupported chain: ${chain}`);
}

async function getEVMActiveAddresses(
  chain: Exclude<ChainId, 'btc' | 'sol'>,
): Promise<ActiveAddresses> {
  const blocks = await getEVMRecentBlocks(chain);
  const addresses = new Set<string>();
  const timestamps = blocks.map((block) => parseInt(block.timestamp, 16));

  for (const block of blocks) {
    for (const tx of block.transactions || []) {
      if (tx.from) {
        addresses.add(tx.from.toLowerCase());
      }
      if (tx.to) {
        addresses.add(tx.to.toLowerCase());
      }
    }
  }

  return {
    activeAddresses: addresses.size,
    sampleSize: blocks.length,
    periodSeconds: getBlockPeriodSeconds(timestamps),
    source: 'rpc',
  };
}

async function getBTCActiveAddresses(): Promise<ActiveAddresses> {
  return withCandidates(BTC_REST_ENDPOINTS, async (endpoint) => {
    const blocks = await getBTCRecentBlocks();
    const latestBlock = blocks[0];
    const hash =
      latestBlock.id || (await fetchText(`${endpoint}/block-height/${latestBlock.height}`)).trim();
    const txs = await fetchJSON<BTCTx[]>(`${endpoint}/block/${hash}/txs`);
    const addresses = new Set<string>();

    for (const tx of txs) {
      for (const input of tx.vin || []) {
        const address = input.prevout?.scriptpubkey_address;
        if (address) {
          addresses.add(address);
        }
      }
      for (const output of tx.vout || []) {
        if (output.scriptpubkey_address) {
          addresses.add(output.scriptpubkey_address);
        }
      }
    }

    return {
      activeAddresses: addresses.size || latestBlock.tx_count || 0,
      sampleSize: txs.length,
      periodSeconds: 600,
      source: 'rpc',
    };
  });
}

function normalizeSolanaAccountKey(accountKey: SolanaAccountKey): string | null {
  if (typeof accountKey === 'string') {
    return accountKey;
  }
  return accountKey.pubkey || null;
}

async function getSOLActiveAddresses(): Promise<ActiveAddresses> {
  const latestSlot = await jsonRPC<number>(SOL_RPC_ENDPOINTS, 'getSlot', [
    { commitment: 'confirmed' },
  ]);
  let lastError: unknown;

  for (let offset = 0; offset <= SOL_SAMPLE_BLOCK_LOOKBACK; offset += 1) {
    try {
      const slot = latestSlot - offset;
      const block = await jsonRPC<{ transactions?: SolanaTransaction[] } | null>(
        SOL_RPC_ENDPOINTS,
        'getBlock',
        [
          slot,
          {
            encoding: 'json',
            transactionDetails: 'full',
            rewards: false,
            maxSupportedTransactionVersion: 0,
          },
        ],
      );
      const addresses = new Set<string>();

      for (const tx of block?.transactions || []) {
        for (const accountKey of tx.transaction?.message?.accountKeys || []) {
          const address = normalizeSolanaAccountKey(accountKey);
          if (address) {
            addresses.add(address);
          }
        }
      }

      if (addresses.size > 0) {
        return {
          activeAddresses: addresses.size,
          sampleSize: block?.transactions?.length || 0,
          periodSeconds: 1,
          source: 'rpc',
        };
      }
    } catch (error) {
      lastError = error;
    }
  }

  const tps = await getSOLTPS().catch(() => null);
  if (tps?.txCount) {
    return {
      activeAddresses: tps.txCount,
      sampleSize: tps.sampleCount,
      periodSeconds: tps.periodSeconds,
      source: 'rpc',
    };
  }

  throw lastError instanceof Error ? lastError : new Error('No Solana activity sample returned');
}

export async function getActiveAddressesRPC(chain: string): Promise<ActiveAddresses> {
  const chainLower = chain.toLowerCase() as ChainId;

  if (chainLower === 'btc') {
    return getBTCActiveAddresses();
  }
  if (chainLower === 'sol') {
    return getSOLActiveAddresses();
  }
  if (chainLower === 'eth' || chainLower === 'bsc' || chainLower === 'polygon') {
    return getEVMActiveAddresses(chainLower);
  }

  throw new Error(`Unsupported chain: ${chain}`);
}
