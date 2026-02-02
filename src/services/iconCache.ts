/**
 * 图标缓存系统
 * 跨 session 持久化缓存已检测的高质量图标 URL
 */

import { getBuiltinIcon } from './builtinIcons';

interface IconCacheEntry {
  url: string;           // 最终使用的图标 URL
  timestamp: number;     // 缓存时间
  source: 'builtin' | 'detected' | 'default';
}

type IconState = 'loading' | 'loaded' | 'error';

// 内存缓存：domain -> entry
const memoryCache = new Map<string, IconCacheEntry>();

// 加载状态缓存：domain -> state
const loadingStates = new Map<string, IconState>();

// 检测结果缓存（避免重复检测）
const detectionCache = new Map<string, string>();

// STORAGE_KEY for chrome.storage
const STORAGE_KEY = 'icon_cache';

/**
 * 从 chrome.storage 加载缓存
 */
async function loadStorageCache(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage) {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const stored = result[STORAGE_KEY] as Record<string, IconCacheEntry>;
      if (stored) {
        Object.entries(stored).forEach(([domain, entry]) => {
          // 检查缓存是否过期（30天）
          const age = Date.now() - entry.timestamp;
          if (age < 30 * 24 * 60 * 60 * 1000) {
            memoryCache.set(domain, entry);
            detectionCache.set(domain, entry.url);
          }
        });
      }
    } catch (e) {
      console.warn('[IconCache] Failed to load from storage:', e);
    }
  }
}

/**
 * 保存缓存到 chrome.storage
 */
async function saveStorageCache(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage) {
    try {
      const obj = Object.fromEntries(memoryCache.entries());
      await chrome.storage.local.set({ [STORAGE_KEY]: obj });
    } catch (e) {
      console.warn('[IconCache] Failed to save to storage:', e);
    }
  }
}

// 初始化时加载持久化缓存
loadStorageCache();

// 保持预加载图片的引用，防止被垃圾回收
const preloadedImages = new Map<string, HTMLImageElement>();

// 预加载指定的图片 URL 列表（同步，立即执行）
export function preloadIcons(urls: string[]): void {
  urls.forEach(url => {
    if (url && !preloadedImages.has(url)) {
      const img = new Image();
      img.src = url;
      preloadedImages.set(url, img);
    }
  });
}

/**
 * 从 URL 提取 domain
 */
function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * 获取内置图标 URL
 */
function getBuiltinUrl(url: string): string | null {
  return getBuiltinIcon(url);
}

/**
 * 获取默认图标 URL（icon.horse）
 */
function getDefaultUrl(url: string): string {
  const domain = extractDomain(url);
  if (!domain) return '';
  return `https://icon.horse/icon/${domain}`;
}

/**
 * 获取缓存中的图标 URL（同步）
 * 优先级：内置图标 > 内存缓存(source=builtin) > 内存缓存 > 默认
 *
 * 内置图标优先，确保预加载的 URL 和实际使用的 URL 一致
 */
export function getCachedIconUrl(url: string): string {
  const domain = extractDomain(url);
  if (!domain) return '';

  // 1. 优先检查内置图标（确保使用预加载的 URL）
  const builtin = getBuiltinUrl(url);
  if (builtin) {
    // 如果内存缓存不是 builtin 类型，覆盖为内置图标
    const cached = memoryCache.get(domain);
    if (!cached || cached.source !== 'builtin') {
      memoryCache.set(domain, {
        url: builtin,
        timestamp: Date.now(),
        source: 'builtin',
      });
    }
    return builtin;
  }

  // 2. 检查内存缓存
  if (memoryCache.has(domain)) {
    return memoryCache.get(domain)!.url;
  }

  // 3. 返回默认 URL
  return getDefaultUrl(url);
}

/**
 * 获取图标的加载状态
 * 如果内存状态不存在，但从缓存或内置图标能获取到 URL，则认为已加载
 */
export function getIconLoadState(url: string): IconState {
  const domain = extractDomain(url);
  if (!domain) return 'loading';

  // 优先返回内存中的状态
  const memState = loadingStates.get(domain);
  if (memState) return memState;

  // 如果没有内存状态，检查是否有缓存（包括内置图标）
  if (memoryCache.has(domain) || detectionCache.has(domain) || getBuiltinUrl(url)) {
    return 'loaded';
  }

  return 'loading';
}

/**
 * 设置图标的加载状态
 */
export function setIconLoadState(url: string, state: IconState): void {
  const domain = extractDomain(url);
  if (!domain) return;
  loadingStates.set(domain, state);
}

/**
 * 检测并缓存最佳图标 URL（异步）
 * 首次调用时执行检测，后续调用返回缓存结果
 */
export async function detectBestIcon(url: string): Promise<string> {
  const domain = extractDomain(url);
  if (!domain) return '';

  // 1. 检查检测缓存
  if (detectionCache.has(domain)) {
    return detectionCache.get(domain)!;
  }

  // 2. 内置图标不需要检测
  const builtin = getBuiltinUrl(url);
  if (builtin) {
    detectionCache.set(domain, builtin);
    return builtin;
  }

  // 3. 执行检测
  const sources = [
    `https://icon.horse/icon/${domain}`,
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
    `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
  ];

  const results = await checkMultipleSources(sources);

  if (results.length > 0) {
    // 选择最佳（优先正方形且尺寸合适的）
    const best = selectBestIcon(results);
    detectionCache.set(domain, best.url);

    // 更新内存缓存
    memoryCache.set(domain, {
      url: best.url,
      timestamp: Date.now(),
      source: 'detected',
    });

    // 异步保存到持久化存储
    saveStorageCache();

    return best.url;
  }

  // 检测失败，使用默认
  const defaultUrl = getDefaultUrl(url);
  detectionCache.set(domain, defaultUrl);
  return defaultUrl;
}

/**
 * 检测多个图片源
 */
interface ImageCheckResult {
  url: string;
  width: number;
  height: number;
  aspectRatio: number;
  sizeScore: number;
}

async function checkMultipleSources(sources: string[]): Promise<ImageCheckResult[]> {
  const checkPromises = sources.map(src => checkImageSize(src));
  const results = await Promise.allSettled(checkPromises);

  return results
    .filter((r): r is PromiseFulfilledResult<ImageCheckResult | null> =>
      r.status === 'fulfilled' && r.value !== null
    )
    .map(r => r.value as ImageCheckResult);
}

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
      cleanup();
      resolve({
        url,
        width,
        height,
        aspectRatio: width / height,
        sizeScore: calculateSizeScore(width, height),
      });
    };

    img.onerror = () => {
      cleanup();
      resolve(null);
    };

    timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 3000);

    img.src = url;
  });
}

function calculateSizeScore(width: number, height: number): number {
  const size = Math.max(width, height);
  const diff = Math.abs(size - 128);
  return Math.max(0, 100 - diff);
}

function selectBestIcon(results: ImageCheckResult[]): ImageCheckResult {
  // 第一优先级：正方形 + 尺寸合适
  const squareAcceptable = results.find(r =>
    r.aspectRatio >= 0.5 && r.aspectRatio <= 2.0 &&
    r.width >= 64 && r.width <= 256 &&
    r.height >= 64 && r.height <= 256
  );

  if (squareAcceptable) return squareAcceptable;

  // 第二优先级：最接近正方形的
  const mostSquare = [...results].sort((a, b) =>
    Math.abs(a.aspectRatio - 1) - Math.abs(b.aspectRatio - 1)
  )[0];

  return mostSquare || results[0];
}

/**
 * 清除过期缓存
 */
export function clearExpiredCache(): void {
  const now = Date.now();
  const maxAge = 30 * 24 * 60 * 60 * 1000; // 30天

  for (const [domain, entry] of memoryCache.entries()) {
    if (now - entry.timestamp > maxAge) {
      memoryCache.delete(domain);
      detectionCache.delete(domain);
    }
  }

  saveStorageCache();
}

/**
 * 清除所有缓存
 */
export function clearAllCache(): void {
  memoryCache.clear();
  detectionCache.clear();
  loadingStates.clear();

  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.remove(STORAGE_KEY);
  }
}
