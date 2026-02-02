/**
 * 图标缓存系统 v2
 * 
 * 设计原则：
 * 1. 渐进式优化：请求同时发出，每个回来立即比较，更好就替换
 * 2. 简化缓存：只有一个持久化缓存 + 内存镜像
 * 3. 存储分数：允许后续继续优化
 * 4. 实时更新：通过回调通知 UI 更新
 */

import { getBuiltinIcon } from './builtinIcons';
import { createSignal } from 'solid-js';

// 存储加载状态信号
export const [isStorageLoaded, setStorageLoaded] = createSignal(false);

// 缓存版本号 - 修改此值强制刷新缓存
// v5: 修复子域名处理和占位符检测
const STORAGE_KEY = 'icon_cache_v5';

// 缓存过期策略
const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;      // 7天：完全过期，删除条目
const CACHE_SOFT_EXPIRE = 24 * 60 * 60 * 1000;      // 24小时：软过期，后台刷新但先用缓存
const CACHE_FORCE_REFRESH = 3 * 24 * 60 * 60 * 1000; // 3天：强制重新检测（忽略旧分数）

interface IconCacheEntry {
  url: string;
  score: number;
  timestamp: number;
}

// 来源优先级
// DDG 容易返回占位符，icon.horse 能获取高清官方图标
const SOURCE_PRIORITY: Record<string, number> = {
  'chrome-extension://': 80,
  '/favicon.ico': 70,
  'google.com/s2/favicons': 50,
  't3.gstatic.com/faviconV2': 50,
  't2.gstatic.com/faviconV2': 50,
  't1.gstatic.com/faviconV2': 50,
  't0.gstatic.com/faviconV2': 50,
  'icon.horse': 40,              // icon.horse 能获取高清官方图标
  'icons.duckduckgo.com': 10,    // DDG 容易返回占位符，大幅降低
  'favicone.com': 15,
};

// DDG 占位符特征：48x48 灰色箭头图标
// 当 DDG 找不到真实图标时会返回这个占位符
const DDG_PLACEHOLDER_SIZE = 48;

export const memoryCache = new Map<string, IconCacheEntry>();
const detectingDomains = new Set<string>();
const updateCallbacks = new Map<string, Array<(url: string) => void>>();

async function loadStorageCache(): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const stored = result[STORAGE_KEY] as Record<string, IconCacheEntry>;
      if (stored) {
        const now = Date.now();
        Object.entries(stored).forEach(([domain, entry]) => {
          if (now - entry.timestamp < CACHE_MAX_AGE) {
            memoryCache.set(domain, entry);
          }
        });
      }
    } else {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, IconCacheEntry>;
        const now = Date.now();
        Object.entries(parsed).forEach(([domain, entry]) => {
          if (now - entry.timestamp < CACHE_MAX_AGE) {
            memoryCache.set(domain, entry);
          }
        });
      }
    }
  } catch (e) {
    console.warn('[IconCache] Failed to load cache:', e);
  }
  setStorageLoaded(true);
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(): void {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    const obj = Object.fromEntries(memoryCache.entries());
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ [STORAGE_KEY]: obj });
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    }
  }, 1000);
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function getSourceScore(url: string): number {
  for (const [key, score] of Object.entries(SOURCE_PRIORITY)) {
    if (url.includes(key)) return score;
  }
  return 5;
}

function calculateSizeScore(width: number, height: number): number {
  const size = Math.max(width, height);
  if (size < 32) return 0;          // 太小，淘汰
  if (size < 40) return 10 + (size - 32);
  if (size <= 64) return 25;         // 最佳显示尺寸
  if (size <= 128) return 22;        // 高清，稍微缩放
  if (size <= 256) return 20;        // 高清
  if (size <= 512) return 18;        // 超高清（不再惩罚）
  return 15;                         // 超大图标（可能是原图）
}

function calculateAspectScore(width: number, height: number): number {
  const ratio = width / height;
  const deviation = Math.abs(ratio - 1);
  if (deviation < 0.05) return 20;
  if (deviation < 0.1) return 18;
  if (deviation < 0.2) return 15;
  if (deviation < 0.5) return 10;
  return 5;
}

function checkImageSource(url: string): Promise<{ url: string; score: number; width: number; height: number } | null> {
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
      cleanup();

      if (url.includes('chrome-extension://') && width <= 16) {
        resolve(null);
        return;
      }

      // DDG 48x48 占位符检测 - 这是 DDG 找不到图标时返回的默认灰色箭头
      // 给它一个极低的分数，这样任何真实图标都能替代它
      if (url.includes('icons.duckduckgo.com') && width === DDG_PLACEHOLDER_SIZE && height === DDG_PLACEHOLDER_SIZE) {
        resolve({ url, score: 1, width, height }); // 极低分数
        return;
      }

      // icon.horse 512x512 通常是占位符
      if (url.includes('icon.horse') && width === 512 && height === 512) {
        resolve({ url, score: 1, width, height }); // 极低分数
        return;
      }

      const sourceScore = getSourceScore(url);
      const sizeScore = calculateSizeScore(width, height);
      const aspectScore = calculateAspectScore(width, height);
      const totalScore = sourceScore + sizeScore + aspectScore;

      resolve({ url, score: totalScore, width, height });
    };

    img.onerror = () => {
      cleanup();
      resolve(null);
    };

    timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 5000);

    img.src = url;
  });
}

/**
 * 从页面 HTML 解析 favicon link 标签
 * 用于获取网站声明的高清图标（尤其是内部网站）
 * 返回找到的图标 URL 列表
 */
async function parseFaviconFromHtml(siteUrl: string): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(siteUrl, {
      signal: controller.signal,
      headers: {
        'Accept': 'text/html',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    clearTimeout(timeout);

    if (!response.ok) return [];

    const html = await response.text();
    const origin = new URL(siteUrl).origin;

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
  } catch (e) {
    return [];
  }
}

/**
 * 判断域名是否是子域名（不是 www 或裸域名）
 * 例如：monitor-asdx.kayaquant.com → true
 *      www.google.com → false
 *      google.com → false
 */
function isSubdomain(domain: string): boolean {
  const parts = domain.split('.');
  if (parts.length <= 2) return false;
  // 如果第一部分是 www，不算作子域名
  if (parts[0] === 'www') return false;
  return true;
}

/**
 * 获取父域名（不带 www）
 * 例如：monitor-asdx.kayaquant.com → kayaquant.com
 */
function getParentDomain(domain: string): string {
  const parts = domain.split('.');
  if (parts.length <= 2) return '';
  return parts.slice(-2).join('.');
}

function getIconSources(siteUrl: string): string[] {
  try {
    const u = new URL(siteUrl);
    const domain = u.hostname;
    const origin = u.origin;

    const sources: string[] = [];
    const isSub = isSubdomain(domain);
    const parentDomain = getParentDomain(domain);

    // 1. Chrome 原生 API（扩展环境最佳）
    if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
      sources.push(`chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(siteUrl)}&size=64`);
    }

    // 2. 直接访问子域名的 favicon.ico（对内部网站至关重要）
    sources.push(`${origin}/favicon.ico`);

    // 3. Google Favicon（使用原始域名）
    sources.push(`https://www.google.com/s2/favicons?domain=${domain}&sz=64`);

    // 4. icon.horse - 子域名使用原域名，非子域名尝试 www 版本
    if (isSub) {
      // 子域名：只用原域名，不加 www
      sources.push(`https://icon.horse/icon/${domain}`);
    } else {
      // 非子域名：优先 www 版本
      const domainWithWww = domain.startsWith('www.') ? domain : `www.${domain}`;
      sources.push(`https://icon.horse/icon/${domainWithWww}`);
      if (domainWithWww !== domain) {
        sources.push(`https://icon.horse/icon/${domain}`);
      }
    }

    // 5. DuckDuckGo（使用原始域名）
    sources.push(`https://icons.duckduckgo.com/ip3/${domain}.ico`);

    // 6. 如果是子域名，也尝试父域名作为降级
    if (isSub && parentDomain) {
      sources.push(`https://icon.horse/icon/${parentDomain}`);
      sources.push(`https://icon.horse/icon/www.${parentDomain}`);
      sources.push(`https://icons.duckduckgo.com/ip3/${parentDomain}.ico`);
    }

    return sources;
  } catch {
    return [];
  }
}

export function onIconUpdate(url: string, callback: (iconUrl: string) => void): () => void {
  const domain = extractDomain(url);
  if (!domain) return () => {};

  if (!updateCallbacks.has(domain)) {
    updateCallbacks.set(domain, []);
  }
  updateCallbacks.get(domain)!.push(callback);

  return () => {
    const callbacks = updateCallbacks.get(domain);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index >= 0) callbacks.splice(index, 1);
    }
  };
}

function notifyIconUpdate(domain: string, iconUrl: string): void {
  const callbacks = updateCallbacks.get(domain);
  if (callbacks) {
    callbacks.forEach(cb => cb(iconUrl));
  }
}

export function getCachedIconUrl(url: string): string {
  const domain = extractDomain(url);
  if (!domain) return '';

  const builtin = getBuiltinIcon(url);
  if (builtin) return builtin;

  const cached = memoryCache.get(domain);
  if (cached) return cached.url;

  // 默认使用 icon.horse，因为 DDG 容易返回占位符
  return `https://icon.horse/icon/${domain}`;
}

export function getIconLoadState(url: string): 'loading' | 'loaded' | 'error' {
  const domain = extractDomain(url);
  if (!domain) return 'loading';

  if (getBuiltinIcon(url)) return 'loaded';
  if (memoryCache.has(domain)) return 'loaded';

  return 'loading';
}

export function setIconLoadState(_url: string, _state: 'loading' | 'loaded' | 'error'): void {
  // 状态由缓存决定
}

export async function detectBestIcon(url: string): Promise<string> {
  const domain = extractDomain(url);
  if (!domain) return '';

  const builtin = getBuiltinIcon(url);
  if (builtin) return builtin;

  if (detectingDomains.has(domain)) {
    return getCachedIconUrl(url);
  }

  const currentEntry = memoryCache.get(domain);
  const now = Date.now();
  const entryAge = currentEntry ? now - currentEntry.timestamp : Infinity;
  
  // 判断缓存状态
  const isFresh = entryAge < CACHE_SOFT_EXPIRE;           // 新鲜：24小时内
  const needsForceRefresh = entryAge >= CACHE_FORCE_REFRESH; // 强制刷新：超过3天
  
  // 如果缓存新鲜且分数足够高，直接返回不做检测
  if (isFresh && currentEntry && currentEntry.score >= 60) {
    return currentEntry.url;
  }
  
  // 强制刷新时忽略旧分数，从 0 开始
  let currentScore = needsForceRefresh ? 0 : (currentEntry?.score ?? 0);
  let bestUrl = currentEntry?.url ?? '';

  detectingDomains.add(domain);

  // 阶段 1: 检测标准图标源
  const sources = getIconSources(url);
  
  const promises = sources.map(async (sourceUrl) => {
    const result = await checkImageSource(sourceUrl);
    
    if (result && result.score > currentScore) {
      currentScore = result.score;
      bestUrl = result.url;

      memoryCache.set(domain, {
        url: result.url,
        score: result.score,
        timestamp: Date.now()
      });

      scheduleSave();
      notifyIconUpdate(domain, result.url);
    }

    return result;
  });

  await Promise.allSettled(promises);

  // 阶段 2: 如果当前分数较低，尝试从 HTML 解析 favicon
  // 这对内部网站特别有用，因为 DDG/icon.horse 无法获取
  if (currentScore < 50) {
    const htmlIcons = await parseFaviconFromHtml(url);
    
    // 检测从 HTML 解析出的图标
    const htmlPromises = htmlIcons.slice(0, 5).map(async (iconUrl) => {
      const result = await checkImageSource(iconUrl);
      
      if (result && result.score > currentScore) {
        // 从原网站直接获取的图标给予额外加分
        const bonusScore = result.score + 30;

        currentScore = bonusScore;
        bestUrl = result.url;

        memoryCache.set(domain, {
          url: result.url,
          score: bonusScore,
          timestamp: Date.now()
        });

        scheduleSave();
        notifyIconUpdate(domain, result.url);
      }

      return result;
    });

    await Promise.allSettled(htmlPromises);
  }

  detectingDomains.delete(domain);

  if (!bestUrl) {
    bestUrl = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
  }

  return bestUrl;
}

export function clearAllCache(): void {
  memoryCache.clear();
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.remove(STORAGE_KEY);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function preloadIcons(_urls: string[]): void {
  // 不再需要预加载
}

loadStorageCache();
