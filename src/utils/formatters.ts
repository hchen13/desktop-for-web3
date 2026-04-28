import type { ChainId, ChainMetrics } from '../services/chain-monitor/types';

/**
 * 格式化结果
 */
export interface FormattedNumber {
  value: string;
  unit: string;
}

/**
 * 仅在小数点之后裁掉尾零，整数部分的 0 不会被误删
 *
 * "100"     -> "100"
 * "1.00"    -> "1"
 * "1.50"    -> "1.5"
 * "0.0001"  -> "0.0001"
 */
function trimTrailingZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/\.?0+$/, '');
}

/**
 * 格式化大数字（K / M / B）
 *
 * 支持负数、自动跳过 NaN / Infinity
 */
export function formatLargeNumber(num: number): FormattedNumber {
  if (!Number.isFinite(num)) {
    return { value: '-', unit: '' };
  }

  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);

  if (abs >= 1e9) {
    return { value: sign + trimTrailingZeros((abs / 1e9).toFixed(1)), unit: 'B' };
  }
  if (abs >= 1e6) {
    return { value: sign + trimTrailingZeros((abs / 1e6).toFixed(1)), unit: 'M' };
  }
  if (abs >= 1e3) {
    return { value: sign + trimTrailingZeros((abs / 1e3).toFixed(1)), unit: 'K' };
  }
  return { value: sign + trimTrailingZeros(abs.toFixed(2)), unit: '' };
}

/**
 * 格式化为指定小数位数；只裁小数点后的尾零
 */
export function formatNumber(num: number, decimals: number): string {
  if (!Number.isFinite(num)) return '-';
  return trimTrailingZeros(num.toFixed(decimals));
}

/**
 * UI 数据格式
 */
export interface FormattedMetrics {
  chain: ChainId;
  blockDelay?: string | null;
  gasPrice?: string | null;
  gasUnit?: string;
  fees?: string | null;
  feesUnit?: string;
  blockDelayUnit?: string;
  tps?: string | null;
  tvl?: string | null;
  activeAddresses?: string | null;
}

/**
 * 格式化 ChainMetrics 数据供 UI 使用
 */
export function formatMetricsForUI(
  metrics: ChainMetrics | null,
  selectedChain: ChainId,
): FormattedMetrics | null {
  if (!metrics) {
    return null;
  }

  const chain = metrics.chain;

  if (chain !== selectedChain) {
    return null;
  }

  const isBTC = chain === 'btc';
  const isSOL = chain === 'sol';

  const activeAddressesFormatted = metrics.activeAddresses
    ? formatLargeNumber(metrics.activeAddresses.activeAddresses)
    : null;

  const tpsFormatted = metrics.tps ? formatLargeNumber(metrics.tps.tps) : null;

  if (isBTC) {
    let feesValue: string | null = null;
    if (metrics.gasPrice) {
      const feesNum = metrics.gasPrice.avgGasGwei;
      if (feesNum >= 1e6) {
        const formatted = formatLargeNumber(feesNum);
        feesValue = `${formatted.value}${formatted.unit}`;
      } else if (feesNum >= 1e3) {
        feesValue = formatNumber(feesNum, 0);
      } else {
        feesValue = formatNumber(feesNum, 2);
      }
    }

    return {
      chain,
      fees: feesValue,
      feesUnit: metrics.gasPrice?.unit || 'sat/vB',
      blockDelay: metrics.blockTimeDelay
        ? Math.round(metrics.blockTimeDelay.delaySeconds / 60).toString()
        : null,
      blockDelayUnit: 'm',
      tps: tpsFormatted ? `${tpsFormatted.value}${tpsFormatted.unit}` : null,
      activeAddresses: activeAddressesFormatted
        ? `${activeAddressesFormatted.value}${activeAddressesFormatted.unit}`
        : null,
    };
  }

  const tvlFormatted = metrics.tvl ? formatLargeNumber(metrics.tvl.tvl) : null;

  let gasPriceValue: string | null = null;
  let gasUnitDisplay = metrics.gasPrice?.unit || 'Gwei';

  if (metrics.gasPrice) {
    if (isSOL) {
      const lamports = metrics.gasPrice.avgGasGwei * 1e9;
      const formatted = formatLargeNumber(lamports);
      gasPriceValue = `${formatted.value}${formatted.unit}`;
      gasUnitDisplay = 'Lamports';
    } else {
      gasPriceValue = formatNumber(metrics.gasPrice.avgGasGwei, 2);
      gasUnitDisplay = metrics.gasPrice?.unit || 'Gwei';
    }
  }

  let blockDelayValue: string | null = null;
  if (metrics.blockTimeDelay) {
    blockDelayValue = isSOL
      ? formatNumber(metrics.blockTimeDelay.delaySeconds, 0)
      : formatNumber(metrics.blockTimeDelay.delaySeconds, 1);
  }

  return {
    chain,
    blockDelay: blockDelayValue,
    gasPrice: gasPriceValue,
    gasUnit: gasUnitDisplay,
    tps: tpsFormatted ? `${tpsFormatted.value}${tpsFormatted.unit}` : null,
    tvl: tvlFormatted ? `${tvlFormatted.value}${tvlFormatted.unit}` : null,
    activeAddresses: activeAddressesFormatted
      ? `${activeAddressesFormatted.value}${activeAddressesFormatted.unit}`
      : null,
  };
}
