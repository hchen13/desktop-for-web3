/**
 * 获取网站 Favicon
 * 支持图片质量检测和自动降级
 * 支持内置图标映射
 * 
 * 优先级策略：
 * 1. Chrome 原生 API（扩展环境最佳）
 * 2. Google Favicon 服务（自动添加背景，深色主题友好）
 * 3. 其他第三方服务按尺寸和宽高比评分
 */

import { getBuiltinIcon } from './builtinIcons';

interface FaviconOptions {
  size?: number;
}

// 目标图标尺寸（适应 40px 显示，稍大一点保持清晰）
const TARGET_SIZE = 64;
const MIN_ACCEPTABLE_SIZE = 32;
const MAX_ACCEPTABLE_SIZE = 256;

/**
 * 图标来源优先级配置
 * Google Favicon 服务会自动添加白色背景，对深色主题最友好
 * 给予 Google 服务极高分数确保优先选择（即使尺寸较小）
 */
const SOURCE_PRIORITY: Record<string, number> = {
  'chrome-extension://': 80,           // Chrome 原生 API，最可靠
  'google.com/s2/favicons': 75,        // Google 自动添加白底，深色主题最友好
  't3.gstatic.com/faviconV2': 75,      // Google 新版 API
  't2.gstatic.com/faviconV2': 75,      // Google 新版 API（不同 CDN）
  't1.gstatic.com/faviconV2': 75,      // Google 新版 API（不同 CDN）
  't0.gstatic.com/faviconV2': 75,      // Google 新版 API（不同 CDN）
  'icons.duckduckgo.com': 20,          // DuckDuckGo
  'favicone.com': 18,                  // Favicone
  'icon.horse': 15,                    // icon.horse
  'favicon.ico': 8,                    // 站点直接获取，可能被阻止
};

/**
 * 图片检测结果
 */
interface ImageCheckResult {
  url: string;
  width: number;
  height: number;
  isAcceptable: boolean;
  aspectRatio: number;      // 宽高比，1.0 为正方形
  totalScore: number;       // 综合评分
}

/**
 * 获取图标来源的基础分
 */
function getSourcePriority(url: string): number {
  for (const [key, score] of Object.entries(SOURCE_PRIORITY)) {
    if (url.includes(key)) return score;
  }
  return 5; // 未知来源给最低分
}

/**
 * 计算尺寸评分 (0-25分)
 * 尺寸在 48-128 之间最佳，太小或太大都扣分
 */
function calculateSizeScore(width: number, height: number): number {
  const size = Math.max(width, height);
  if (size < MIN_ACCEPTABLE_SIZE) return 0;
  if (size >= 48 && size <= 128) return 25;
  if (size >= 32 && size < 48) return 15;
  if (size > 128 && size <= 256) return 20;
  return 10;
}

/**
 * 计算宽高比评分 (0-20分)
 * 正方形最佳，允许一定偏差
 */
function calculateAspectScore(aspectRatio: number): number {
  const deviation = Math.abs(aspectRatio - 1);
  if (deviation < 0.05) return 20;      // 几乎正方形
  if (deviation < 0.1) return 18;
  if (deviation < 0.2) return 15;
  if (deviation < 0.5) return 10;
  return 5;
}

/**
 * 检测图片尺寸和宽高比
 * 注意：背景检测因 CORS 限制不可靠，改为依赖服务优先级
 * Google Favicon 服务会自动添加白色背景，对深色主题最友好
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
      const isSquareish = aspectRatio >= 0.5 && aspectRatio <= 2.0;

      // 检查尺寸是否合适
      const sizeOk = width >= MIN_ACCEPTABLE_SIZE && width <= MAX_ACCEPTABLE_SIZE &&
                    height >= MIN_ACCEPTABLE_SIZE && height <= MAX_ACCEPTABLE_SIZE;

      // 计算综合评分（来源优先级是关键，Google 服务自动添加背景）
      const sizeScore = calculateSizeScore(width, height);
      const aspectScore = calculateAspectScore(aspectRatio);
      const sourceScore = getSourcePriority(url);
      
      const totalScore = sizeScore + aspectScore + sourceScore;

      cleanup();
      resolve({
        url,
        width,
        height,
        isAcceptable: isSquareish && sizeOk,
        aspectRatio,
        totalScore,
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
 * 从页面 HTML 解析 favicon link 标签
 * 获取网站声明的高清图标（如 SVG、WebP、PNG）
 */
async function parseFaviconFromHtml(url: string): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'text/html',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    clearTimeout(timeout);
    
    if (!response.ok) return [];
    
    const html = await response.text();
    const origin = new URL(url).origin;
    
    // 匹配 <link rel="icon" href="..."> 或 <link rel="apple-touch-icon" href="...">
    const linkRegex = /<link[^>]*rel=["'](?:icon|shortcut icon|apple-touch-icon)[^"']*["'][^>]*>/gi;
    const hrefRegex = /href=["']([^"']+)["']/i;
    const sizesRegex = /sizes=["']([^"']+)["']/i;
    
    const icons: { href: string; size: number }[] = [];
    let match;
    
    while ((match = linkRegex.exec(html)) !== null) {
      const linkTag = match[0];
      const hrefMatch = linkTag.match(hrefRegex);
      if (!hrefMatch) continue;
      
      let href = hrefMatch[1];
      
      // 转换为绝对 URL
      if (href.startsWith('//')) {
        href = 'https:' + href;
      } else if (href.startsWith('/')) {
        href = origin + href;
      } else if (!href.startsWith('http')) {
        href = origin + '/' + href;
      }
      
      // 解析尺寸
      const sizesMatch = linkTag.match(sizesRegex);
      let size = 0;
      if (sizesMatch) {
        const sizeStr = sizesMatch[1].split('x')[0];
        size = parseInt(sizeStr, 10) || 0;
      }
      
      // 优先 SVG（无限缩放）
      if (href.includes('.svg')) {
        size = 999;
      }
      
      icons.push({ href, size });
    }
    
    // 按尺寸排序，优先大图标
    icons.sort((a, b) => b.size - a.size);
    
    return icons.map(i => i.href);
  } catch {
    return [];
  }
}

/**
 * 获取图标的各个服务源
 * 优先级：Chrome 原生 > Google（自动加白底）> 其他第三方
 */
function getIconSources(url: string): string[] {
  try {
    const u = new URL(url);
    const domain = u.hostname;
    const origin = u.origin;
    
    const sources: string[] = [];

    // 1. Chrome 原生 Favicon 服务 (MV3 推荐方式) - 仅在扩展环境有效
    if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
      sources.push(`chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=${TARGET_SIZE}`);
    }

    // 2. Google Favicon 服务 - 自动添加白色背景，深色主题最友好
    sources.push(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`);
    // Google 新版 API（更高质量）
    sources.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(origin)}&size=128`);

    // 3. 其他第三方服务
    sources.push(`https://icons.duckduckgo.com/ip3/${domain}.ico`);
    sources.push(`https://favicone.com/${domain}?s=128`);
    sources.push(`https://icon.horse/icon/${domain}`);

    // 4. 站点根目录（放最后，因为很多站点会 403 或返回低质量图标）
    sources.push(`${origin}/favicon.ico`);

    // 子域名父级备选
    const parts = domain.split('.');
    if (parts.length > 2) {
      const rootDomain = parts.slice(-2).join('.');
      sources.push(`https://${rootDomain}/favicon.ico`);
    }

    return sources;
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
 * 
 * 综合评分算法（满分75分）：
 * - 来源可靠性：Chrome API +30, Google +28（自动白底）, 等
 * - 尺寸：48-128px +25 分
 * - 宽高比：正方形 +20 分
 * 
 * Google Favicon 服务会自动为透明图标添加白色背景，对深色主题最友好
 */
export const getBestQualityIcon = async (url: string): Promise<string> => {
  // 检查内置图标（不需要检测，直接返回）
  const builtin = getBuiltinIcon(url);
  if (builtin) return builtin;

  // 检查缓存
  const cacheKey = new URL(url).hostname;
  if (qualityCache.has(cacheKey)) {
    return qualityCache.get(cacheKey)!;
  }

  // 收集所有候选图标源
  const sources = getIconSources(url);
  
  // 尝试从页面 HTML 解析 favicon（通常能获取高清图标）
  const htmlIcons = await parseFaviconFromHtml(url);
  // 把 HTML 解析的图标加入候选（放在后面，因为可能是透明背景）
  const allSources = [...sources, ...htmlIcons.slice(0, 3)];

  if (allSources.length === 0) return '';

  // 并行检测所有源
  const results = await Promise.allSettled(
    allSources.map(src => checkImageSize(src))
  );

  // 筛选成功的结果
  const validResults = results
    .map((r, i) => r.status === 'fulfilled' && r.value ? { ...r.value, index: i } : null)
    .filter((r): r is ImageCheckResult & { index: number } => r !== null);

  if (validResults.length === 0) {
    // 全部失败，返回 Google 服务（会自动添加白底）
    const fallback = `https://www.google.com/s2/favicons?domain=${cacheKey}&sz=128`;
    qualityCache.set(cacheKey, fallback);
    return fallback;
  }

  // 按综合评分排序（评分相同时，index 小的优先）
  validResults.sort((a, b) => {
    if (b.totalScore !== a.totalScore) {
      return b.totalScore - a.totalScore;
    }
    return a.index - b.index;
  });

  const best = validResults[0];

  qualityCache.set(cacheKey, best.url);
  return best.url;
}

/**
 * 同步接口（兼容现有代码）
 */
export const getFavicon = (url: string, options: FaviconOptions = {}): string => {
  return getIconHorse(url);
};
