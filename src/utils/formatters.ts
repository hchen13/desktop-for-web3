import type { ChainId, ChainMetrics } from '../services/chain-monitor/types';

/**
 * 格式化结果
 */
export interface FormattedNumber {
  value: string;
  unit: string;
}

/**
 * 格式化大数字（支持 K、M、B，保留1位小数）
 * 自动移除末尾的 0
 */
export function formatLargeNumber(num: number): FormattedNumber {
  if (num >= 1e9) {
    const value = (num / 1e9).toFixed(1).replace(/\.0$/, '');
    return { value, unit: 'B' };
  } else if (num >= 1e6) {
    const value = (num / 1e6).toFixed(1).replace(/\.0$/, '');
    return { value, unit: 'M' };
  } else if (num >= 1e3) {
    const value = (num / 1e3).toFixed(1).replace(/\.0$/, '');
    return { value, unit: 'K' };
  } else {
    const value = num.toFixed(2).replace(/\.?0+$/, '');
    return { value, unit: '' };
  }
}

/**
 * 格式化为指定小数位数，移除末尾的 0
 */
export function formatNumber(num: number, decimals: number): string {
  return num.toFixed(decimals).replace(/\.?0+$/, '');
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
  selectedChain: ChainId
): FormattedMetrics | null {
  if (!metrics) {
    return null;
  }

  const chain = metrics.chain;

  // 确保使用的是当前选中链的数据
  if (chain !== selectedChain) {
    return null;
  }

  const isBTC = chain === 'btc';
  const isSOL = chain === 'sol';

  // 格式化活跃地址（所有链通用）
  const activeAddressesFormatted = metrics.activeAddresses
    ? formatLargeNumber(metrics.activeAddresses.activeAddresses)
    : null;

  // 格式化 TPS（使用 K,M,B）
  const tpsFormatted = metrics.tps ? formatLargeNumber(metrics.tps.tps) : null;

  if (isBTC) {
    // BTC: fees 格式化
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
      blockDelay: metrics.blockTimeDelay ? Math.round(metrics.blockTimeDelay.delaySeconds / 60).toString() : null,
      blockDelayUnit: 'm',
      tps: tpsFormatted ? `${tpsFormatted.value}${tpsFormatted.unit}` : null,
      activeAddresses: activeAddressesFormatted ? `${activeAddressesFormatted.value}${activeAddressesFormatted.unit}` : null,
    };
  } else {
    // 非 BTC 链
    const tvlFormatted = metrics.tvl ? formatLargeNumber(metrics.tvl.tvl) : null;

    // Gas Price 格式化
    let gasPriceValue: string | null = null;
    let gasUnitDisplay = metrics.gasPrice?.unit || 'Gwei';

    if (metrics.gasPrice) {
      if (isSOL) {
        // SOL: 转换为 lamports 显示
        const lamports = metrics.gasPrice.avgGasGwei * 1e9;
        const formatted = formatLargeNumber(lamports);
        gasPriceValue = `${formatted.value}${formatted.unit}`;
        gasUnitDisplay = 'Lamports';
      } else {
        // EVM 链: Gas Price 使用 2 位小数
        gasPriceValue = formatNumber(metrics.gasPrice.avgGasGwei, 2);
        gasUnitDisplay = metrics.gasPrice?.unit || 'Gwei';
      }
    }

    // Block Delay 格式化
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
      activeAddresses: activeAddressesFormatted ? `${activeAddressesFormatted.value}${activeAddressesFormatted.unit}` : null,
    };
  }
}
