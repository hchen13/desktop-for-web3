/**
 * Economic Data Service - 使用 World Bank API 获取经济数据
 * 
 * World Bank 指标代码:
 * - NY.GDP.MKTP.CD: GDP (current US$)
 * - SL.UEM.TOTL.ZS: Unemployment, total (% of labor force)
 * - GC.DOD.TOTL.GD.ZS: Central government debt, total (% of GDP)
 * - FR.INR.RINR: Real interest rate (%)
 * - FP.CPI.TOTL.ZG: Inflation, consumer prices (annual %)
 */

export type EconomicMetric = 'gdp' | 'ur' | 'gdg' | 'intr' | 'iryy';

export interface EconomicDataPoint {
  countryCode: string;
  value: number | null;
  year: number;
}

export interface EconomicData {
  metric: EconomicMetric;
  data: Map<string, EconomicDataPoint>;
  lastUpdated: number;
}

// World Bank API 指标映射
const WORLD_BANK_INDICATORS: Record<EconomicMetric, string> = {
  gdp: 'NY.GDP.MKTP.CD',      // GDP (current US$)
  ur: 'SL.UEM.TOTL.ZS',       // Unemployment rate (%)
  gdg: 'GC.DOD.TOTL.GD.ZS',   // Government debt to GDP (%)
  intr: 'FR.INR.RINR',        // Real interest rate (%)
  iryy: 'FP.CPI.TOTL.ZG',     // Inflation rate (%)
};

// 指标友好名称
export const METRIC_NAMES: Record<EconomicMetric, string> = {
  gdp: 'GDP',
  ur: 'Unemployment Rate',
  gdg: 'Govt Debt to GDP',
  intr: 'Interest Rate',
  iryy: 'Inflation Rate',
};

// 色阶配置 (与 TradingView 一致)
const BILLION = 1e9;
export const COLOR_SCALES: Record<EconomicMetric, number[]> = {
  gdp: [10 * BILLION, 20 * BILLION, 50 * BILLION, 120 * BILLION, 460 * BILLION],
  ur: [3, 5, 7, 10, 15],
  gdg: [30, 40, 50, 70, 90],
  intr: [3, 5, 7, 10, 18],
  iryy: [1, 2, 4, 5, 11],
};

// 颜色定义 (橙色色系，与 TradingView 一致)
export const COLORS = [
  '#fff3e0', // 最低
  '#ffe0b2',
  '#ffcc80',
  '#ffb74d',
  '#ffa726',
  '#ff9800', // 最高
];

// 缓存
const dataCache = new Map<EconomicMetric, EconomicData>();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/**
 * 从 World Bank API 获取经济数据
 */
export async function fetchEconomicData(metric: EconomicMetric): Promise<EconomicData> {
  // 检查缓存
  const cached = dataCache.get(metric);
  if (cached && Date.now() - cached.lastUpdated < CACHE_DURATION) {
    return cached;
  }

  const indicator = WORLD_BANK_INDICATORS[metric];
  const currentYear = new Date().getFullYear();
  // 获取最近 5 年的数据，以确保有最新可用数据
  const url = `https://api.worldbank.org/v2/country/all/indicator/${indicator}?format=json&per_page=500&date=${currentYear - 5}:${currentYear}&mrnev=1`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`World Bank API error: ${response.status}`);
    }

    const json = await response.json();
    const records = json[1] || [];

    const data = new Map<string, EconomicDataPoint>();

    for (const record of records) {
      if (record.value !== null && record.countryiso2code) {
        const existing = data.get(record.countryiso2code);
        // 只保留最新年份的数据
        if (!existing || record.date > existing.year) {
          data.set(record.countryiso2code, {
            countryCode: record.countryiso2code,
            value: record.value,
            year: parseInt(record.date),
          });
        }
      }
    }

    const result: EconomicData = {
      metric,
      data,
      lastUpdated: Date.now(),
    };

    dataCache.set(metric, result);
    return result;
  } catch (error) {
    console.error('[EconomicData] Failed to fetch data:', error);
    // 如果有缓存数据，即使过期也返回
    if (cached) {
      return cached;
    }
    return {
      metric,
      data: new Map(),
      lastUpdated: Date.now(),
    };
  }
}

/**
 * 根据数值获取颜色
 */
export function getColorForValue(metric: EconomicMetric, value: number | null): string | null {
  if (value === null) return null;

  const thresholds = COLOR_SCALES[metric];
  
  for (let i = 0; i < thresholds.length; i++) {
    if (value < thresholds[i]) {
      return COLORS[i];
    }
  }
  return COLORS[COLORS.length - 1];
}

/**
 * 获取图例数据
 */
export function getLegendItems(metric: EconomicMetric): { color: string; label: string }[] {
  const thresholds = COLOR_SCALES[metric];
  const items: { color: string; label: string }[] = [];

  const formatValue = (val: number): string => {
    if (metric === 'gdp') {
      return `${Math.round(val / BILLION)}B`;
    }
    return val.toString();
  };

  const suffix = metric === 'gdp' ? ' USD' : '%';

  // 第一项: < 第一个阈值
  items.push({
    color: COLORS[0],
    label: `< ${formatValue(thresholds[0])}${suffix}`,
  });

  // 中间项
  for (let i = 0; i < thresholds.length - 1; i++) {
    items.push({
      color: COLORS[i + 1],
      label: `${formatValue(thresholds[i])} - ${formatValue(thresholds[i + 1])}${suffix}`,
    });
  }

  // 最后一项: > 最后一个阈值
  items.push({
    color: COLORS[COLORS.length - 1],
    label: `> ${formatValue(thresholds[thresholds.length - 1])}${suffix}`,
  });

  return items;
}
