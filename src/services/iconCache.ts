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
import { getSourcePriorityScore } from './faviconConfig';

// 存储加载状态信号
export const [isStorageLoaded, setStorageLoaded] = createSignal(false);

// 缓存版本号 - 修改此值强制刷新缓存
// v9: 泛用图标服务不再作为最终态，避免错误图标锁死
const STORAGE_KEY = 'icon_cache_v9';

// 缓存过期策略
const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7天：完全过期，删除条目
const CACHE_SOFT_EXPIRE = 24 * 60 * 60 * 1000; // 24小时：软过期，后台刷新但先用缓存
const CACHE_FORCE_REFRESH = 3 * 24 * 60 * 60 * 1000; // 3天：强制重新检测（忽略旧分数）
const MIN_CACHE_SCORE = 50;

interface IconCacheEntry {
  url: string;
  score: number;
  timestamp: number;
}

interface DetectBestIconOptions {
  ignoreBuiltin?: boolean;
  skipUrl?: string;
  forceRefresh?: boolean;
}

interface FetchedText {
  text: string;
  responseUrl: string;
  baseUrl: string;
}

// 来源优先级 — 从 faviconConfig 单一来源 import，与 faviconService 保持一致

export const memoryCache = new Map<string, IconCacheEntry>();
const detectingDomains = new Map<string, Promise<string>>();
const updateCallbacks = new Map<string, Array<(url: string) => void>>();
const HTML_FETCH_TIMEOUT_MS = 5000;
const CORS_HTML_PROXIES = [
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

function isUsableCacheEntry(entry: IconCacheEntry | undefined): entry is IconCacheEntry {
  return Boolean(entry && entry.score >= MIN_CACHE_SCORE);
}

function isDisplayableCacheEntry(entry: IconCacheEntry | undefined): entry is IconCacheEntry {
  return Boolean(
    entry && isUsableCacheEntry(entry) && (!isGenericIconService(entry.url) || entry.score >= 110),
  );
}

function isTrustedCacheEntry(entry: IconCacheEntry | undefined): entry is IconCacheEntry {
  return Boolean(entry && isUsableCacheEntry(entry) && !isGenericIconService(entry.url));
}

async function loadStorageCache(): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const stored = result[STORAGE_KEY] as Record<string, IconCacheEntry>;
      if (stored) {
        const now = Date.now();
        Object.entries(stored).forEach(([domain, entry]) => {
          if (now - entry.timestamp < CACHE_MAX_AGE && isDisplayableCacheEntry(entry)) {
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
          if (now - entry.timestamp < CACHE_MAX_AGE && isDisplayableCacheEntry(entry)) {
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
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    // 输入可能没有 scheme（例如 'example.com'）— 自动补全 https:// 后再尝试
    try {
      return new URL(`https://${url}`).hostname;
    } catch {
      return null;
    }
  }
}

function getSourceScore(url: string, siteUrl?: string): number {
  if (siteUrl) {
    try {
      if (new URL(url).origin === new URL(siteUrl).origin) {
        return 95;
      }
    } catch {}
  }

  return getSourcePriorityScore(url);
}

function isSameOriginIconUrl(url: string, siteUrl?: string): boolean {
  if (!siteUrl) return false;
  try {
    return new URL(url).origin === new URL(siteUrl).origin;
  } catch {
    return false;
  }
}

function calculateSizeScore(width: number, height: number, url: string, siteUrl?: string): number {
  const size = Math.max(width, height);
  if (size >= 16 && size < 32 && isSameOriginIconUrl(url, siteUrl)) return 12;
  if (size < 32) return 0; // 太小，淘汰
  if (size < 40) return 10 + (size - 32);
  if (size <= 64) return 25; // 最佳显示尺寸
  if (size <= 128) return 22; // 高清，稍微缩放
  if (size <= 256) return 20; // 高清
  if (size <= 512) return 18; // 超高清（不再惩罚）
  return 15; // 超大图标（可能是原图）
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

export function isLikelyFallbackIcon(url: string, width: number, height: number): boolean {
  const normalizedUrl = url.toLowerCase();

  if (isChromeFaviconUrl(normalizedUrl)) {
    return true;
  }

  if (normalizedUrl.includes('icons.duckduckgo.com') && width === 48 && height === 48) {
    return true;
  }

  if (normalizedUrl.includes('icon.horse') && width === 512 && height === 512) {
    return true;
  }

  if (
    (normalizedUrl.includes('google.com/s2/favicons') ||
      normalizedUrl.includes('gstatic.com/faviconv2')) &&
    width <= 16 &&
    height <= 16
  ) {
    return true;
  }

  return false;
}

function isChromeFaviconUrl(url: string): boolean {
  const normalizedUrl = url.toLowerCase();
  return normalizedUrl.startsWith('chrome-extension://') && normalizedUrl.includes('/_favicon/');
}

function isGenericIconService(url: string): boolean {
  return (
    isChromeFaviconUrl(url) ||
    url.includes('google.com/s2/favicons') ||
    url.includes('gstatic.com/faviconV2') ||
    url.includes('icons.duckduckgo.com') ||
    url.includes('favicone.com') ||
    url.includes('icon.horse')
  );
}

export function isGenericIconUrl(url: string): boolean {
  return isGenericIconService(url);
}

function isSkippedIconUrl(sourceUrl: string, skipUrl?: string): boolean {
  if (!skipUrl) return false;
  return sourceUrl === skipUrl;
}

function isCacheableIconResult(result: { url: string; score: number }): boolean {
  return (
    result.score >= MIN_CACHE_SCORE && (!isGenericIconService(result.url) || result.score >= 110)
  );
}

function isTrustedIconResult(result: { url: string }): boolean {
  return !isGenericIconService(result.url);
}

async function fetchTextWithTimeout(url: string, accept: string): Promise<Response | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), HTML_FETCH_TIMEOUT_MS);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: accept,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) return null;
    return response;
  } catch {
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function fetchTextFromSite(
  url: string,
  accept: string,
  useProxyFallback = true,
): Promise<FetchedText | null> {
  const candidates = [
    { url, baseUrl: url, proxied: false },
    ...(useProxyFallback
      ? CORS_HTML_PROXIES.map((buildProxyUrl) => ({
          url: buildProxyUrl(url),
          baseUrl: url,
          proxied: true,
        }))
      : []),
  ];

  for (const candidate of candidates) {
    const response = await fetchTextWithTimeout(candidate.url, accept);
    if (!response) continue;

    const text = await response.text();
    if (!text.trim()) continue;

    return {
      text,
      responseUrl: candidate.proxied ? candidate.baseUrl : response.url || candidate.baseUrl,
      baseUrl: candidate.proxied ? candidate.baseUrl : response.url || candidate.baseUrl,
    };
  }

  return null;
}

function checkImageSource(
  url: string,
  siteUrl?: string,
): Promise<{ url: string; score: number; width: number; height: number } | null> {
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

      if (isLikelyFallbackIcon(url, width, height)) {
        resolve(null);
        return;
      }

      const sizeScore = calculateSizeScore(width, height, url, siteUrl);
      if (sizeScore === 0) {
        resolve(null);
        return;
      }

      const sourceScore = getSourceScore(url, siteUrl);
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
async function parseManifestIcons(
  manifestUrl: string,
): Promise<Array<{ href: string; size: number }>> {
  try {
    const fetched = await fetchTextFromSite(
      manifestUrl,
      'application/manifest+json, application/json',
    );
    if (!fetched) return [];

    const manifest = JSON.parse(fetched.text) as {
      icons?: Array<{ src?: string; sizes?: string; type?: string }>;
    };
    if (!Array.isArray(manifest.icons)) return [];

    return manifest.icons
      .filter((icon) => icon.src)
      .map((icon) => ({
        href: new URL(icon.src!, fetched.responseUrl || manifestUrl).href,
        size: parseIconSize(icon.sizes || ''),
      }))
      .sort((a, b) => b.size - a.size);
  } catch {
    return [];
  }
}

function parseIconSize(value: string): number {
  const sizes = value
    .split(/\s+/)
    .map((size) => parseInt(size.split('x')[0], 10))
    .filter((size) => Number.isFinite(size));
  return sizes.length ? Math.max(...sizes) : 0;
}

function resolveIconHref(href: string, baseUrl: string): string {
  return new URL(href, baseUrl).href;
}

async function parseFaviconFromHtml(siteUrl: string): Promise<string[]> {
  try {
    const fetched = await fetchTextFromSite(siteUrl, 'text/html');
    if (!fetched) return [];

    const html = fetched.text;
    const baseUrl = fetched.baseUrl;

    const linkRegex = /<link\b[^>]*>/gi;
    const relRegex = /rel=["']([^"']+)["']/i;
    const hrefRegex = /href=["']([^"']+)["']/i;
    const sizesRegex = /sizes=["']([^"']+)["']/i;
    const metaRegex = /<meta\b[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*>/gi;
    const contentRegex = /content=["']([^"']+)["']/i;

    const icons: { href: string; size: number }[] = [];
    const manifestUrls: string[] = [];
    const metaImages: string[] = [];
    let match;

    while ((match = linkRegex.exec(html)) !== null) {
      const linkTag = match[0];
      const hrefMatch = linkTag.match(hrefRegex);
      const relMatch = linkTag.match(relRegex);
      if (!relMatch) continue;
      if (!hrefMatch) continue;

      const rel = relMatch[1].toLowerCase();
      const href = resolveIconHref(hrefMatch[1], baseUrl);

      if (rel.split(/\s+/).includes('manifest')) {
        manifestUrls.push(href);
        continue;
      }

      const isIcon =
        rel.includes('icon') || rel.includes('mask-icon') || rel.includes('apple-touch-icon');
      if (!isIcon) continue;

      const sizesMatch = linkTag.match(sizesRegex);
      let size = sizesMatch ? parseIconSize(sizesMatch[1]) : 0;

      if (href.includes('.svg')) {
        size = 999;
      }

      icons.push({ href, size });
    }

    icons.sort((a, b) => b.size - a.size);

    while ((match = metaRegex.exec(html)) !== null) {
      const contentMatch = match[0].match(contentRegex);
      if (contentMatch) {
        metaImages.push(resolveIconHref(contentMatch[1], baseUrl));
      }
    }

    const manifestIcons = (
      await Promise.all(
        manifestUrls.slice(0, 2).map((manifestUrl) => parseManifestIcons(manifestUrl)),
      )
    ).flat();

    return [...icons, ...manifestIcons, ...metaImages].map((i) =>
      typeof i === 'string' ? i : i.href,
    );
  } catch {
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

    // 1. 直接访问站点同源常见图标路径（对内部网站至关重要）
    sources.push(`${origin}/favicon.ico`);
    sources.push(`${origin}/favicon.svg`);
    sources.push(`${origin}/favicon.png`);
    sources.push(`${origin}/favicon-32x32.png`);
    sources.push(`${origin}/apple-touch-icon.png`);
    sources.push(`${origin}/logo.png`);
    sources.push(`${origin}/logo.svg`);
    sources.push(`${origin}/assets/logo.png`);

    // 2. Google Favicon（使用原始域名）
    sources.push(`https://www.google.com/s2/favicons?domain=${domain}&sz=64`);
    sources.push(
      `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(origin)}&size=64`,
    );

    // 3. icon.horse - 子域名使用原域名，非子域名尝试 www 版本
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

    // 4. DuckDuckGo（使用原始域名）
    sources.push(`https://icons.duckduckgo.com/ip3/${domain}.ico`);

    // 5. 如果是子域名，也尝试父域名作为降级
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
    callbacks.forEach((cb) => cb(iconUrl));
  }
}

export function getCachedIconUrl(url: string): string {
  const domain = extractDomain(url);
  if (!domain) return '';

  const cached = memoryCache.get(domain);
  if (isDisplayableCacheEntry(cached)) return cached.url;
  if (cached) memoryCache.delete(domain);

  const builtin = getBuiltinIcon(url);
  if (builtin) return builtin;

  return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
}

export function getIconLoadState(url: string): 'loading' | 'loaded' | 'error' {
  const domain = extractDomain(url);
  if (!domain) return 'loading';

  const cached = memoryCache.get(domain);
  if (isTrustedCacheEntry(cached)) return 'loaded';
  if (cached) memoryCache.delete(domain);
  if (getBuiltinIcon(url)) return 'loaded';

  return 'loading';
}

export function setIconLoadState(_url: string, _state: 'loading' | 'loaded' | 'error'): void {
  // 状态由缓存决定
}

export async function detectBestIcon(
  url: string,
  options: DetectBestIconOptions = {},
): Promise<string> {
  const domain = extractDomain(url);
  if (!domain) return '';

  const builtin = getBuiltinIcon(url);
  if (!options.ignoreBuiltin && builtin && !isSkippedIconUrl(builtin, options.skipUrl)) {
    return builtin;
  }

  const detectionKey = `${domain}:${options.ignoreBuiltin ? 'dynamic' : 'default'}:${options.forceRefresh ? 'force' : 'normal'}:${options.skipUrl ?? ''}`;
  const activeDetection = detectingDomains.get(detectionKey);
  if (activeDetection) {
    return activeDetection;
  }

  const detection = detectBestIconForDomain(url, domain, options).finally(() => {
    detectingDomains.delete(detectionKey);
  });
  detectingDomains.set(detectionKey, detection);

  return detection;
}

async function detectBestIconForDomain(
  url: string,
  domain: string,
  options: DetectBestIconOptions,
): Promise<string> {
  const storedEntry = memoryCache.get(domain);
  const currentEntry =
    isDisplayableCacheEntry(storedEntry) && !isSkippedIconUrl(storedEntry.url, options.skipUrl)
      ? storedEntry
      : undefined;
  if (storedEntry && !currentEntry) memoryCache.delete(domain);

  const now = Date.now();
  const entryAge = currentEntry ? now - currentEntry.timestamp : Infinity;

  // 判断缓存状态
  const isFresh = !options.forceRefresh && entryAge < CACHE_SOFT_EXPIRE; // 新鲜：24小时内
  const needsForceRefresh = options.forceRefresh || entryAge >= CACHE_FORCE_REFRESH; // 强制刷新

  // 如果缓存新鲜且分数足够高，直接返回不做检测
  if (isFresh && currentEntry && isTrustedCacheEntry(currentEntry)) {
    return currentEntry.url;
  }

  // 强制刷新时忽略旧分数，从 0 开始
  let currentScore = needsForceRefresh ? 0 : (currentEntry?.score ?? 0);
  let bestUrl = currentEntry?.url ?? '';

  const htmlIconsPromise = parseFaviconFromHtml(url);

  // 阶段 1: 检测标准图标源
  const sources = getIconSources(url);

  const promises = sources.map(async (sourceUrl) => {
    if (isSkippedIconUrl(sourceUrl, options.skipUrl)) return null;

    const result = await checkImageSource(sourceUrl, url);

    if (result && isCacheableIconResult(result) && result.score > currentScore) {
      currentScore = result.score;
      bestUrl = result.url;

      memoryCache.set(domain, {
        url: result.url,
        score: result.score,
        timestamp: Date.now(),
      });

      scheduleSave();
      if (isTrustedIconResult(result)) {
        notifyIconUpdate(domain, result.url);
      }
    }

    return result;
  });

  await Promise.allSettled(promises);

  // 阶段 2: 如果当前分数较低，尝试从 HTML 解析 favicon
  // 这对内部网站特别有用，因为 DDG/icon.horse 无法获取
  if (currentScore < 140 || isGenericIconService(bestUrl)) {
    const htmlIcons = await htmlIconsPromise;

    // 检测从 HTML 解析出的图标
    const htmlPromises = htmlIcons.slice(0, 5).map(async (iconUrl) => {
      if (isSkippedIconUrl(iconUrl, options.skipUrl)) return null;

      const result = await checkImageSource(iconUrl, url);

      if (result && isCacheableIconResult(result) && result.score > currentScore) {
        // 从原网站直接获取的图标给予额外加分
        const bonusScore = result.score + 30;

        if (bonusScore > currentScore) {
          currentScore = bonusScore;
          bestUrl = result.url;

          memoryCache.set(domain, {
            url: result.url,
            score: bonusScore,
            timestamp: Date.now(),
          });

          scheduleSave();
          notifyIconUpdate(domain, result.url);
        }
      }

      return result;
    });

    await Promise.allSettled(htmlPromises);
  }

  return bestUrl;
}

async function removeDomainFromStorage(domain: string): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const stored = result[STORAGE_KEY] as Record<string, IconCacheEntry> | undefined;
      if (stored && domain in stored) {
        delete stored[domain];
        await chrome.storage.local.set({ [STORAGE_KEY]: stored });
      }
    } else {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as Record<string, IconCacheEntry>;
      if (domain in parsed) {
        delete parsed[domain];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      }
    }
  } catch (e) {
    console.warn('[IconCache] Failed to remove domain cache:', e);
  }
}

export async function refreshIcon(url: string, skipUrl?: string): Promise<string> {
  const domain = extractDomain(url);
  if (!domain) return '';

  memoryCache.delete(domain);
  await removeDomainFromStorage(domain);

  return detectBestIcon(url, {
    ignoreBuiltin: Boolean(skipUrl),
    skipUrl,
    forceRefresh: true,
  });
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
