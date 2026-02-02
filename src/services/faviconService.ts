/**
 * 获取网站 Favicon
 * 支持图片质量检测和自动降级
 * 支持内置图标映射
 * 优先选择正方形、分辨率合适的图标
 */

import { getBuiltinIcon } from './builtinIcons';

interface FaviconOptions {
  size?: number;
}

// 目标图标尺寸（略大于 GRID_UNIT = 100px）
const TARGET_SIZE = 128;
const MIN_ACCEPTABLE_SIZE = 64;
const MAX_ACCEPTABLE_SIZE = 256;

/**
 * 图片检测结果
 */
interface ImageCheckResult {
  url: string;
  width: number;
  height: number;
  isAcceptable: boolean;
  aspectRatio: number; // 宬高比，1.0 为正方形
  sizeScore: number;  // 尺寸评分，越接近 TARGET_SIZE 越好
}

/**
 * 计算尺寸评分
 */
function calculateSizeScore(width: number, height: number): number {
  const size = Math.max(width, height);
  const diff = Math.abs(size - TARGET_SIZE);
  // 尺寸越接近 TARGET_SIZE，评分越高（0-100）
  return Math.max(0, 100 - diff);
}

/**
 * 检测图片尺寸和宽高比
 */
async function checkImageSize(url: string): Promise<ImageCheckResult | null> {
  return new Promise((resolve) => {
    const img = new Image();
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      img.onload = null;
      img.onerror = null;
      if (timeout) clearTimeout(timeout);
    };

    img.onload = () => {
      const { naturalWidth: width, naturalHeight: height } = img;

      // 计算宽高比
      const aspectRatio = width / height;
      // 检查是否接近正方形（宽高比在 0.5 到 2.0 之间）
      const isSquareish = aspectRatio >= 0.5 && aspectRatio <= 2.0;

      // 检查尺寸是否合适
      const sizeOk = width >= MIN_ACCEPTABLE_SIZE && width <= MAX_ACCEPTABLE_SIZE &&
                    height >= MIN_ACCEPTABLE_SIZE && height <= MAX_ACCEPTABLE_SIZE;

      cleanup();
      resolve({
        url,
        width,
        height,
        isAcceptable: isSquareish && sizeOk,
        aspectRatio,
        sizeScore: calculateSizeScore(width, height),
      });
    };

    img.onerror = () => {
      cleanup();
      resolve(null);
    };

    // 设置超时
    timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 3000);

    img.src = url;
  });
}

/**
 * 获取图标的各个服务源
 */
function getIconSources(url: string): string[] {
  try {
    const domain = new URL(url).hostname;
    return [
      // icon.horse - 高质量，优先
      `https://icon.horse/icon/${domain}`,
      // DuckDuckGo - 通常质量较好
      `https://icons.duckduckgo.com/ip3/${domain}.ico`,
      // Google - 备用，指定较大尺寸
      `https://www.google.com/s2/favicons?domain=${domain}&sz=${TARGET_SIZE}`,
    ];
  } catch {
    return [];
  }
}

/**
 * 同步获取图标 URL（用于组件渲染）
 * 优先使用内置图标，否则返回 icon.horse
 */
export const getIconHorse = (url: string): string => {
  try {
    // 优先检查内置图标
    const builtin = getBuiltinIcon(url);
    if (builtin) return builtin;

    const domain = new URL(url).hostname;
    return `https://icon.horse/icon/${domain}`;
  } catch {
    return '';
  }
};

export const getGoogleFavicon = (url: string, size = 128): string => {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
  } catch {
    return '';
  }
};

export const getDDGFavicon = (url: string): string => {
  try {
    const domain = new URL(url).hostname;
    return `https://icons.duckduckgo.com/ip3/${domain}.ico`;
  } catch {
    return '';
  }
};

/**
 * 缓存检测结果
 */
const qualityCache = new Map<string, string>();

/**
 * 获取最佳质量图标（带检测）
 * 优先使用内置图标，然后按以下优先级选择：
 * 1. 正方形（宽高比 0.5-2.0）且尺寸合适
 * 2. 如果没有正方形，选择最接近正方形的
 * 3. 如果都不合适，选择第一个成功加载的
 */
export const getBestQualityIcon = async (url: string): Promise<string> => {
  // 检查内置图标（不需要检测，直接返回）
  const builtin = getBuiltinIcon(url);
  if (builtin) return builtin;

  const sources = getIconSources(url);
  if (sources.length === 0) return '';

  // 检查缓存
  const cacheKey = new URL(url).hostname;
  if (qualityCache.has(cacheKey)) {
    return qualityCache.get(cacheKey)!;
  }

  // 并行检测所有源
  const results = await Promise.allSettled(
    sources.map(src => checkImageSize(src))
  );

  // 筛选出成功加载的结果
  const validResults = results
    .filter((r): r is PromiseFulfilledResult<ImageCheckResult | null> =>
      r.status === 'fulfilled' && r.value !== null
    )
    .map(r => (r as PromiseFulfilledResult<ImageCheckResult>).value);

  if (validResults.length === 0) {
    // 全部失败，返回默认源
    return sources[0];
  }

  // 第一优先级：正方形 + 尺寸合适
  const squareAcceptable = validResults.find(r =>
    r.isAcceptable
  );
  if (squareAcceptable) {
    qualityCache.set(cacheKey, squareAcceptable.url);
    return squareAcceptable.url;
  }

  // 第二优先级：最接近正方形的（宽高比最接近 1）
  const mostSquare = [...validResults].sort((a, b) => {
    const ratioA = Math.abs(a.aspectRatio - 1);
    const ratioB = Math.abs(b.aspectRatio - 1);
    return ratioA - ratioB;
  })[0];

  if (mostSquare && Math.abs(mostSquare.aspectRatio - 1) < 3) {
    // 宽高比在可接受范围内
    qualityCache.set(cacheKey, mostSquare.url);
    return mostSquare.url;
  }

  // 都不理想，返回第一个成功加载的
  qualityCache.set(cacheKey, validResults[0].url);
  return validResults[0].url;
}

/**
 * 同步接口（兼容现有代码）
 */
export const getFavicon = (url: string, options: FaviconOptions = {}): string => {
  return getIconHorse(url);
};
