import { describe, it, expect } from 'vitest';
import { formatLargeNumber, formatNumber, formatMetricsForUI } from './formatters';
import type { ChainMetrics } from '../services/chain-monitor/types';

describe('formatLargeNumber', () => {
  it('zero', () => {
    expect(formatLargeNumber(0)).toEqual({ value: '0', unit: '' });
  });

  it('999.99 → no unit', () => {
    expect(formatLargeNumber(999.99)).toEqual({ value: '999.99', unit: '' });
  });

  it('1000 → 1 K', () => {
    expect(formatLargeNumber(1000)).toEqual({ value: '1', unit: 'K' });
  });

  it('1234567 → 1.2 M', () => {
    expect(formatLargeNumber(1234567)).toEqual({ value: '1.2', unit: 'M' });
  });

  it('1.05e9 → 1.1 B (toFixed 1)', () => {
    expect(formatLargeNumber(1.05e9)).toEqual({ value: '1.1', unit: 'B' });
  });

  it('1e12 → 1000 B (current behavior — no T unit)', () => {
    expect(formatLargeNumber(1e12)).toEqual({ value: '1000', unit: 'B' });
  });

  it('NaN → "-"', () => {
    expect(formatLargeNumber(NaN)).toEqual({ value: '-', unit: '' });
  });

  it('Infinity → "-"', () => {
    expect(formatLargeNumber(Infinity)).toEqual({ value: '-', unit: '' });
  });

  it('-Infinity → "-"', () => {
    expect(formatLargeNumber(-Infinity)).toEqual({ value: '-', unit: '' });
  });

  it('negative -1234 → -1.2K', () => {
    expect(formatLargeNumber(-1234)).toEqual({ value: '-1.2', unit: 'K' });
  });

  it('negative -1.5e6 → -1.5M', () => {
    expect(formatLargeNumber(-1.5e6)).toEqual({ value: '-1.5', unit: 'M' });
  });

  it('negative -0.5 (small) preserves sign', () => {
    expect(formatLargeNumber(-0.5)).toEqual({ value: '-0.5', unit: '' });
  });
});

describe('formatNumber', () => {
  it('1.5 with 4 decimals trims trailing zeros', () => {
    expect(formatNumber(1.5, 4)).toBe('1.5');
  });

  it('integer with 0 decimals preserves integer trailing zeros', () => {
    expect(formatNumber(100, 0)).toBe('100');
    expect(formatNumber(1000, 0)).toBe('1000');
  });

  it('decimal trailing zero stripped to integer', () => {
    expect(formatNumber(1.0, 2)).toBe('1');
  });

  it('partial decimal trailing zero stripped', () => {
    expect(formatNumber(1.5, 4)).toBe('1.5');
    expect(formatNumber(1.23, 4)).toBe('1.23');
  });

  it('NaN → "-"', () => {
    expect(formatNumber(NaN, 2)).toBe('-');
  });

  it('Infinity → "-"', () => {
    expect(formatNumber(Infinity, 2)).toBe('-');
  });

  it('non-zero-tail integer is unaffected', () => {
    expect(formatNumber(123, 0)).toBe('123');
  });

  it('large number passes through', () => {
    expect(formatNumber(123456.789, 2)).toBe('123456.79');
  });

  it('precision 0.0001 keeps the value', () => {
    expect(formatNumber(0.0001, 4)).toBe('0.0001');
  });
});

const baseMetrics = (chain: ChainMetrics['chain']): ChainMetrics => ({
  chain,
  blockTimeDelay: { blockNumber: 1, latestBlockTime: 0, delaySeconds: 12.5, source: 'rpc' },
  gasPrice: {
    avgGasGwei: 25,
    medianGasGwei: 24,
    minGasGwei: 20,
    maxGasGwei: 30,
    unit: 'gwei',
    source: 'rpc',
  },
  tps: { tps: 15.4, source: 'rpc' },
  activeAddresses: { activeAddresses: 50000, source: 'worker.dune' },
  tvl: { tvl: 1.2e9, tvlUSD: 1.2e9, source: 'defillama' },
  lastUpdate: 0,
});

describe('formatMetricsForUI', () => {
  it('null metrics → null', () => {
    expect(formatMetricsForUI(null, 'eth')).toBeNull();
  });

  it('chain mismatch → null', () => {
    const m = baseMetrics('eth');
    expect(formatMetricsForUI(m, 'btc')).toBeNull();
  });

  it('ETH branch — formats gas price as Gwei', () => {
    const m = baseMetrics('eth');
    const out = formatMetricsForUI(m, 'eth')!;
    expect(out.chain).toBe('eth');
    expect(out.gasUnit).toBe('gwei');
    expect(out.gasPrice).toBe('25');
    expect(out.tvl).toBeDefined();
    expect(out.blockDelay).toBe('12.5');
  });

  it('SOL branch — converts gas to lamports', () => {
    const m = baseMetrics('sol');
    m.gasPrice = {
      avgGasGwei: 0.000005,
      medianGasGwei: 0.000005,
      minGasGwei: 0,
      maxGasGwei: 0,
      unit: 'gwei',
      source: 'rpc',
    };
    const out = formatMetricsForUI(m, 'sol')!;
    expect(out.gasUnit).toBe('Lamports');
    // 0.000005 * 1e9 = 5000 lamports → 5K
    expect(out.gasPrice).toContain('5');
    expect(out.blockDelay).toBe('13'); // SOL uses 0 decimals
  });

  it('BTC branch — formats fees and converts blockDelay to minutes', () => {
    const m = baseMetrics('btc');
    m.gasPrice = {
      avgGasGwei: 12.5,
      medianGasGwei: 12,
      minGasGwei: 10,
      maxGasGwei: 15,
      unit: 'sat/vB',
      source: 'rpc',
    };
    const out = formatMetricsForUI(m, 'btc')!;
    expect(out.fees).toBe('12.5');
    expect(out.feesUnit).toBe('sat/vB');
    // 12.5s / 60 = 0.208 -> rounded 0
    expect(out.blockDelay).toBe('0');
    expect(out.blockDelayUnit).toBe('m');
  });

  it('partial null fields fall back gracefully', () => {
    const m = baseMetrics('eth');
    m.gasPrice = null;
    m.tvl = null;
    const out = formatMetricsForUI(m, 'eth')!;
    expect(out.gasPrice).toBeNull();
    expect(out.tvl).toBeNull();
    // Other fields still present
    expect(out.blockDelay).toBeDefined();
  });

  it('BTC large fee uses K-formatted', () => {
    const m = baseMetrics('btc');
    m.gasPrice = {
      avgGasGwei: 1234,
      medianGasGwei: 1000,
      minGasGwei: 800,
      maxGasGwei: 2000,
      unit: 'sat/vB',
      source: 'rpc',
    };
    const out = formatMetricsForUI(m, 'btc')!;
    // 1234 falls into >=1e3 branch: formatNumber(1234, 0) = '1234'
    expect(out.fees).toBe('1234');
  });

  it('BTC mega fee uses M-formatted', () => {
    const m = baseMetrics('btc');
    m.gasPrice = {
      avgGasGwei: 2_500_000,
      medianGasGwei: 0,
      minGasGwei: 0,
      maxGasGwei: 0,
      unit: 'sat/vB',
      source: 'rpc',
    };
    const out = formatMetricsForUI(m, 'btc')!;
    expect(out.fees).toContain('M');
  });
});
