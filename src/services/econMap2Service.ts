/**
 * EconMap2 数据服务 - 使用 IMF DataMapper API
 * https://www.imf.org/external/datamapper/api/v1/
 */

export type EconMap2Metric = 'gdp' | 'ur' | 'gdg' | 'intr' | 'iryy';

export interface EconMap2DataPoint {
  iso3: string; // IMF uses ISO 3166-1 alpha-3 codes
  value: number | null;
  year: number;
}

export interface EconMap2DataSet {
  metric: EconMap2Metric;
  data: Map<string, EconMap2DataPoint>; // key: iso3
  lastUpdated: number;
}

// IMF DataMapper indicator codes (legacy; kept as reference)
const IMF_INDICATORS: Record<EconMap2Metric, string> = {
  gdp: 'NGDPD', // GDP, current prices (Billions of U.S. dollars)
  ur: 'LUR', // Unemployment rate (Percent)
  gdg: 'GGXWDG_NGDP', // General government gross debt (Percent of GDP)
  intr: 'rltir', // Real long term government bond yield (percent)
  iryy: 'PCPIPCH', // Inflation rate, average consumer prices (Annual percent change)
};

const TRADINGVIEW_METRIC_ENDPOINTS: Record<EconMap2Metric, string> = {
  gdp: 'gdp',
  ur: 'ur',
  gdg: 'gdg',
  intr: 'intr',
  iryy: 'iryy',
};

const getTradingViewMetricUrl = (metric: EconMap2Metric): string => {
  return `https://widgets.tradingview-widget.com/data/economic/global/${TRADINGVIEW_METRIC_ENDPOINTS[metric]}.json`;
};

export const ECON_MAP2_METRICS: EconMap2Metric[] = ['gdp', 'ur', 'gdg', 'intr', 'iryy'];

export const ECON_MAP2_METRIC_NAMES: Record<EconMap2Metric, string> = {
  gdp: 'GDP',
  ur: 'Unemployment',
  gdg: 'Govt Debt',
  intr: 'Interest Rate',
  iryy: 'Inflation',
};

// Thresholds for color scale - matching TradingView's Economic Map legend exactly
// Each array has 5 thresholds defining 6 bins: [<t1, t1-t2, t2-t3, t3-t4, t4-t5, >t5]
export const ECON_MAP2_THRESHOLDS: Record<EconMap2Metric, number[]> = {
  gdp: [10, 20, 50, 120, 460], // Billions USD: <10B, 10-20B, 20-50B, 50-120B, 120-460B, >460B
  ur: [3, 5, 7, 10, 15], // Percent: <3%, 3-5%, 5-7%, 7-10%, 10-15%, >15%
  gdg: [30, 40, 50, 70, 90], // Percent of GDP: <30%, 30-40%, 40-50%, 50-70%, 70-90%, >90%
  intr: [3, 5, 7, 10, 18], // Percent: <3%, 3-5%, 5-7%, 7-10%, 10-18%, >18%
  iryy: [1, 2, 4, 5, 11], // Percent: <1%, 1-2%, 2-4%, 4-5%, 5-11%, >11%
};

// TradingView Economic Map color palette (6 bins, low to high)
// Extracted from TradingView widget CSS source - dark theme colors
export const ECON_MAP2_COLORS = [
  '#33261a', // Bin 1 - darkest brown (lowest values)
  '#593a1b', // Bin 2
  '#8c541c', // Bin 3
  '#cc7014', // Bin 4
  '#e57e16', // Bin 5
  '#ff9101', // Bin 6 - bright orange (highest values)
];

// Number of color bins
export const ECON_MAP2_BIN_COUNT = 6;

const CACHE_DURATION = 24 * 60 * 60 * 1000;
const dataCache = new Map<EconMap2Metric, EconMap2DataSet>();

// ISO 3166-1 numeric to alpha-3 mapping for world-atlas TopoJSON
// world-atlas uses numeric codes as feature IDs
const ISO_NUMERIC_TO_ALPHA3: Record<number, string> = {
  4: 'AFG', 8: 'ALB', 12: 'DZA', 20: 'AND', 24: 'AGO', 28: 'ATG', 32: 'ARG', 51: 'ARM',
  36: 'AUS', 40: 'AUT', 31: 'AZE', 44: 'BHS', 48: 'BHR', 50: 'BGD', 52: 'BRB', 112: 'BLR',
  56: 'BEL', 84: 'BLZ', 204: 'BEN', 64: 'BTN', 68: 'BOL', 70: 'BIH', 72: 'BWA', 76: 'BRA',
  96: 'BRN', 100: 'BGR', 854: 'BFA', 108: 'BDI', 132: 'CPV', 116: 'KHM', 120: 'CMR',
  124: 'CAN', 140: 'CAF', 148: 'TCD', 152: 'CHL', 156: 'CHN', 170: 'COL', 174: 'COM',
  178: 'COG', 180: 'COD', 188: 'CRI', 384: 'CIV', 191: 'HRV', 192: 'CUB', 196: 'CYP',
  203: 'CZE', 208: 'DNK', 262: 'DJI', 212: 'DMA', 214: 'DOM', 218: 'ECU', 818: 'EGY',
  222: 'SLV', 226: 'GNQ', 232: 'ERI', 233: 'EST', 748: 'SWZ', 231: 'ETH', 242: 'FJI',
  246: 'FIN', 250: 'FRA', 266: 'GAB', 270: 'GMB', 268: 'GEO', 276: 'DEU', 288: 'GHA',
  300: 'GRC', 308: 'GRD', 320: 'GTM', 324: 'GIN', 624: 'GNB', 328: 'GUY', 332: 'HTI',
  340: 'HND', 348: 'HUN', 352: 'ISL', 356: 'IND', 360: 'IDN', 364: 'IRN', 368: 'IRQ',
  372: 'IRL', 376: 'ISR', 380: 'ITA', 388: 'JAM', 392: 'JPN', 400: 'JOR', 398: 'KAZ',
  404: 'KEN', 296: 'KIR', 408: 'PRK', 410: 'KOR', 414: 'KWT', 417: 'KGZ', 418: 'LAO',
  428: 'LVA', 422: 'LBN', 426: 'LSO', 430: 'LBR', 434: 'LBY', 438: 'LIE', 440: 'LTU',
  442: 'LUX', 450: 'MDG', 454: 'MWI', 458: 'MYS', 462: 'MDV', 466: 'MLI', 470: 'MLT',
  584: 'MHL', 478: 'MRT', 480: 'MUS', 484: 'MEX', 583: 'FSM', 498: 'MDA', 492: 'MCO',
  496: 'MNG', 499: 'MNE', 504: 'MAR', 508: 'MOZ', 104: 'MMR', 516: 'NAM', 520: 'NRU',
  524: 'NPL', 528: 'NLD', 554: 'NZL', 558: 'NIC', 562: 'NER', 566: 'NGA', 807: 'MKD',
  578: 'NOR', 512: 'OMN', 586: 'PAK', 585: 'PLW', 591: 'PAN', 598: 'PNG', 600: 'PRY',
  604: 'PER', 608: 'PHL', 616: 'POL', 620: 'PRT', 634: 'QAT', 642: 'ROU', 643: 'RUS',
  646: 'RWA', 659: 'KNA', 662: 'LCA', 670: 'VCT', 882: 'WSM', 674: 'SMR', 678: 'STP',
  682: 'SAU', 686: 'SEN', 688: 'SRB', 690: 'SYC', 694: 'SLE', 702: 'SGP', 703: 'SVK',
  705: 'SVN', 90: 'SLB', 706: 'SOM', 710: 'ZAF', 728: 'SSD', 724: 'ESP', 144: 'LKA',
  736: 'SDN', 740: 'SUR', 752: 'SWE', 756: 'CHE', 760: 'SYR', 158: 'TWN', 762: 'TJK',
  834: 'TZA', 764: 'THA', 626: 'TLS', 768: 'TGO', 776: 'TON', 780: 'TTO', 788: 'TUN',
  792: 'TUR', 795: 'TKM', 798: 'TUV', 800: 'UGA', 804: 'UKR', 784: 'ARE', 826: 'GBR',
  840: 'USA', 858: 'URY', 860: 'UZB', 548: 'VUT', 862: 'VEN', 704: 'VNM', 887: 'YEM',
  894: 'ZMB', 716: 'ZWE', 900: 'XKX', // Kosovo
};

// ISO 3166-1 alpha-2 to alpha-3 mapping (TradingView intr.json uses alpha-2)
const ISO2_TO_ALPHA3: Record<string, string> = {
  AF: 'AFG', AX: 'ALA', AL: 'ALB', DZ: 'DZA', AS: 'ASM', AD: 'AND', AO: 'AGO', AI: 'AIA',
  AQ: 'ATA', AG: 'ATG', AR: 'ARG', AM: 'ARM', AW: 'ABW', AU: 'AUS', AT: 'AUT', AZ: 'AZE',
  BS: 'BHS', BH: 'BHR', BD: 'BGD', BB: 'BRB', BY: 'BLR', BE: 'BEL', BZ: 'BLZ', BJ: 'BEN',
  BM: 'BMU', BT: 'BTN', BO: 'BOL', BQ: 'BES', BA: 'BIH', BW: 'BWA', BV: 'BVT', BR: 'BRA',
  IO: 'IOT', BN: 'BRN', BG: 'BGR', BF: 'BFA', BI: 'BDI', CV: 'CPV', KH: 'KHM', CM: 'CMR',
  CA: 'CAN', KY: 'CYM', CF: 'CAF', TD: 'TCD', CL: 'CHL', CN: 'CHN', CX: 'CXR', CC: 'CCK',
  CO: 'COL', KM: 'COM', CD: 'COD', CG: 'COG', CK: 'COK', CR: 'CRI', CI: 'CIV', HR: 'HRV',
  CU: 'CUB', CW: 'CUW', CY: 'CYP', CZ: 'CZE', DK: 'DNK', DJ: 'DJI', DM: 'DMA', DO: 'DOM',
  EC: 'ECU', EG: 'EGY', SV: 'SLV', GQ: 'GNQ', ER: 'ERI', EE: 'EST', SZ: 'SWZ', ET: 'ETH',
  FK: 'FLK', FO: 'FRO', FJ: 'FJI', FI: 'FIN', FR: 'FRA', GF: 'GUF', PF: 'PYF', TF: 'ATF',
  GA: 'GAB', GM: 'GMB', GE: 'GEO', DE: 'DEU', GH: 'GHA', GI: 'GIB', GR: 'GRC', GL: 'GRL',
  GD: 'GRD', GP: 'GLP', GU: 'GUM', GT: 'GTM', GG: 'GGY', GN: 'GIN', GW: 'GNB', GY: 'GUY',
  HT: 'HTI', HM: 'HMD', VA: 'VAT', HN: 'HND', HK: 'HKG', HU: 'HUN', IS: 'ISL', IN: 'IND',
  ID: 'IDN', IR: 'IRN', IQ: 'IRQ', IE: 'IRL', IM: 'IMN', IL: 'ISR', IT: 'ITA', JM: 'JAM',
  JP: 'JPN', JE: 'JEY', JO: 'JOR', KZ: 'KAZ', KE: 'KEN', KI: 'KIR', KP: 'PRK', KR: 'KOR',
  KW: 'KWT', KG: 'KGZ', LA: 'LAO', LV: 'LVA', LB: 'LBN', LS: 'LSO', LR: 'LBR', LY: 'LBY',
  LI: 'LIE', LT: 'LTU', LU: 'LUX', MO: 'MAC', MK: 'MKD', MG: 'MDG', MW: 'MWI', MY: 'MYS',
  MV: 'MDV', ML: 'MLI', MT: 'MLT', MH: 'MHL', MQ: 'MTQ', MR: 'MRT', MU: 'MUS', YT: 'MYT',
  MX: 'MEX', FM: 'FSM', MD: 'MDA', MC: 'MCO', MN: 'MNG', ME: 'MNE', MS: 'MSR', MA: 'MAR',
  MZ: 'MOZ', MM: 'MMR', NA: 'NAM', NR: 'NRU', NP: 'NPL', NL: 'NLD', NC: 'NCL', NZ: 'NZL',
  NI: 'NIC', NE: 'NER', NG: 'NGA', NU: 'NIU', NF: 'NFK', MP: 'MNP', NO: 'NOR', OM: 'OMN',
  PK: 'PAK', PW: 'PLW', PS: 'PSE', PA: 'PAN', PG: 'PNG', PY: 'PRY', PE: 'PER', PH: 'PHL',
  PN: 'PCN', PL: 'POL', PT: 'PRT', PR: 'PRI', QA: 'QAT', RE: 'REU', RO: 'ROU', RU: 'RUS',
  RW: 'RWA', BL: 'BLM', SH: 'SHN', KN: 'KNA', LC: 'LCA', MF: 'MAF', PM: 'SPM', VC: 'VCT',
  WS: 'WSM', SM: 'SMR', ST: 'STP', SA: 'SAU', SN: 'SEN', RS: 'SRB', SC: 'SYC', SL: 'SLE',
  SG: 'SGP', SX: 'SXM', SK: 'SVK', SI: 'SVN', SB: 'SLB', SO: 'SOM', ZA: 'ZAF', GS: 'SGS',
  SS: 'SSD', ES: 'ESP', LK: 'LKA', SD: 'SDN', SR: 'SUR', SJ: 'SJM', SE: 'SWE', CH: 'CHE',
  SY: 'SYR', TW: 'TWN', TJ: 'TJK', TZ: 'TZA', TH: 'THA', TL: 'TLS', TG: 'TGO', TK: 'TKL',
  TO: 'TON', TT: 'TTO', TN: 'TUN', TR: 'TUR', TM: 'TKM', TC: 'TCA', TV: 'TUV', UG: 'UGA',
  UA: 'UKR', AE: 'ARE', GB: 'GBR', UM: 'UMI', US: 'USA', UY: 'URY', UZ: 'UZB', VU: 'VUT',
  VE: 'VEN', VN: 'VNM', VG: 'VGB', VI: 'VIR', WF: 'WLF', EH: 'ESH', YE: 'YEM', ZM: 'ZMB',
  ZW: 'ZWE', XK: 'XKX',
};

function iso2ToAlpha3(iso2: string): string | null {
  return ISO2_TO_ALPHA3[iso2.toUpperCase()] ?? null;
}

export function numericToAlpha3(numericCode: number): string | null {
  return ISO_NUMERIC_TO_ALPHA3[numericCode] ?? null;
}

// Use proxy in dev mode to avoid CORS issues
const getImfApiUrl = (indicator: string): string => {
  const path = `/external/datamapper/api/v1/${indicator}`;
  // In dev mode, use Vite proxy
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return `/api-proxy/imf${path}`;
  }
  // In production (Chrome extension), direct URL works with manifest permissions
  return `https://www.imf.org${path}`;
};

export async function fetchEconMap2Data(metric: EconMap2Metric): Promise<EconMap2DataSet> {
  const cached = dataCache.get(metric);
  if (cached && Date.now() - cached.lastUpdated < CACHE_DURATION) {
    return cached;
  }

  const url = getTradingViewMetricUrl(metric);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`TradingView ${metric}.json error: ${response.status}`);
    }

    const json = await response.json();
    const data = new Map<string, EconMap2DataPoint>();
    const entries: Record<string, { v: number }> = json?.data || {};
    const lastUpdate = typeof json?.lastUpdate === 'number' ? json.lastUpdate : Date.now();
    const year = new Date(lastUpdate).getFullYear();

    for (const [iso2, payload] of Object.entries(entries)) {
      if (!payload || typeof payload.v !== 'number' || Number.isNaN(payload.v)) continue;
      const iso3 = iso2ToAlpha3(iso2);
      if (!iso3) continue;
      const value = metric === 'gdp' ? payload.v / 1e9 : payload.v;
      data.set(iso3, {
        iso3,
        value,
        year,
      });
    }

    const result: EconMap2DataSet = {
      metric,
      data,
      lastUpdated: lastUpdate,
    };

    dataCache.set(metric, result);
    console.log(`[EconMap2] Fetched ${data.size} countries for ${metric} (TradingView)`);
    return result;
  } catch (error) {
    console.error('[EconMap2] Failed to fetch TradingView data', error);
    if (cached) return cached;
    return {
      metric,
      data: new Map(),
      lastUpdated: Date.now(),
    };
  }
}

// Get color based on fixed thresholds (matching TradingView's Economic Map)
export function getEconMap2Color(
  metric: EconMap2Metric,
  value: number | null
): string | null {
  if (value === null || Number.isNaN(value)) return null;
  
  const thresholds = ECON_MAP2_THRESHOLDS[metric];
  
  // Find which bin this value falls into based on thresholds
  // thresholds = [t1, t2, t3, t4, t5] defines 6 bins:
  // bin 0: value < t1
  // bin 1: t1 <= value < t2
  // bin 2: t2 <= value < t3
  // bin 3: t3 <= value < t4
  // bin 4: t4 <= value < t5
  // bin 5: value >= t5
  let binIndex = 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (value >= thresholds[i]) {
      binIndex = i + 1;
    } else {
      break;
    }
  }
  
  return ECON_MAP2_COLORS[binIndex];
}

export function formatEconValue(metric: EconMap2Metric, value: number | null): string {
  if (value === null || Number.isNaN(value)) return 'N/A';
  if (metric === 'gdp') {
    if (value >= 1000) return `$${(value / 1000).toFixed(1)}T`;
    return `$${value.toFixed(0)}B`;
  }
  return `${value.toFixed(1)}%`;
}
