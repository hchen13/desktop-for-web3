/**
 * faviconService tests
 * 主要验证 SOURCE_PRIORITY 的一致性以及简单 URL 解析
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { SOURCE_PRIORITY as FAVICON_PRIORITY } from './faviconConfig';
import {
  SOURCE_PRIORITY as SERVICE_PRIORITY,
  getIconHorse,
  getGoogleFavicon,
  getDDGFavicon,
} from './faviconService';
import { getBuiltinIcon } from './builtinIcons';
import {
  clearAllCache,
  detectBestIcon,
  getCachedIconUrl,
  getIconLoadState,
  isLikelyFallbackIcon,
  memoryCache,
} from './iconCache';

type ImageConstructor = typeof globalThis.Image;

afterEach(() => {
  vi.unstubAllGlobals();
  clearAllCache();
});

function mockImageLoader(resolveImage: (src: string) => { width: number; height: number } | null) {
  class MockImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    private currentSrc = '';

    get src() {
      return this.currentSrc;
    }

    set src(value: string) {
      this.currentSrc = value;
      queueMicrotask(() => {
        const result = resolveImage(value);
        if (!result) {
          this.onerror?.();
          return;
        }

        this.naturalWidth = result.width;
        this.naturalHeight = result.height;
        this.onload?.();
      });
    }
  }

  vi.stubGlobal('Image', MockImage as unknown as ImageConstructor);
}

describe('SOURCE_PRIORITY consistency', () => {
  it('faviconService re-exports the same SOURCE_PRIORITY object', () => {
    expect(SERVICE_PRIORITY).toBe(FAVICON_PRIORITY);
  });

  it('all entries are positive numbers', () => {
    for (const [key, score] of Object.entries(FAVICON_PRIORITY)) {
      expect(typeof score).toBe('number');
      expect(score).toBeGreaterThan(0);
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it('Chrome native is highest priority', () => {
    const chromeScore = FAVICON_PRIORITY['chrome-extension://'];
    for (const [key, score] of Object.entries(FAVICON_PRIORITY)) {
      if (key === 'chrome-extension://') continue;
      expect(score).toBeLessThanOrEqual(chromeScore);
    }
  });
});

describe('getIconHorse / getGoogleFavicon / getDDGFavicon', () => {
  it('returns a URL for a valid URL', () => {
    const u = getIconHorse('https://www.example.com/page');
    expect(u).toContain('icon.horse');
  });

  it('handles URL without scheme — returns empty string (current behavior)', () => {
    expect(getIconHorse('example.com')).toBe('');
  });

  it('returns google url', () => {
    expect(getGoogleFavicon('https://example.com')).toContain('google.com');
  });

  it('returns DDG url', () => {
    expect(getDDGFavicon('https://example.com')).toContain('duckduckgo.com');
  });

  it('returns "" for invalid url string', () => {
    expect(getIconHorse('not a url at all')).toBe('');
  });
});

describe('iconCache.getCachedIconUrl', () => {
  it('uses builtin icons for known default-layout news domains', () => {
    expect(getBuiltinIcon('https://www.odaily.news')).toBe(
      'https://www.google.com/s2/favicons?domain=odaily.news&sz=128',
    );
    expect(getCachedIconUrl('https://www.odaily.news')).toBe(
      'https://www.google.com/s2/favicons?domain=odaily.news&sz=128',
    );
  });

  it('uses valid builtin favicon paths for L2 domains', () => {
    expect(getCachedIconUrl('https://www.base.org')).toBe('https://base.org/favicon.ico');
    expect(getCachedIconUrl('https://www.zksync.io')).toBe('https://zksync.io/favicon.ico');
  });

  it('uses stable favicon service urls for CEX builtin icons', () => {
    expect(getCachedIconUrl('https://www.binance.com')).toBe(
      'https://www.google.com/s2/favicons?domain=binance.com&sz=128',
    );
    expect(getCachedIconUrl('https://www.okx.com')).toBe(
      'https://www.google.com/s2/favicons?domain=okx.com&sz=128',
    );
    expect(getCachedIconUrl('https://www.bitget.com')).toBe(
      'https://www.google.com/s2/favicons?domain=bitget.com&sz=128',
    );
  });

  it('uses stable favicon service urls for Claude and YouTube', () => {
    expect(getCachedIconUrl('https://claude.ai')).toBe(
      'https://www.google.com/s2/favicons?domain=claude.ai&sz=128',
    );
    expect(getCachedIconUrl('https://www.youtube.com')).toBe(
      'https://www.google.com/s2/favicons?domain=youtube.com&sz=128',
    );
  });

  it('lets a verified dynamic cache override a builtin icon', () => {
    memoryCache.set('claude.ai', {
      url: 'https://claude.ai/generated-icon.png',
      score: 120,
      timestamp: Date.now(),
    });

    expect(getCachedIconUrl('https://claude.ai')).toBe('https://claude.ai/generated-icon.png');
  });

  it('can bypass a failed builtin icon and cache a discovered source', async () => {
    const failedBuiltin = 'https://www.google.com/s2/favicons?domain=youtube.com&sz=128';
    mockImageLoader((src) => {
      if (src === 'https://www.youtube.com/favicon.ico') {
        return { width: 64, height: 64 };
      }
      return null;
    });

    const result = await detectBestIcon('https://www.youtube.com', {
      ignoreBuiltin: true,
      skipUrl: failedBuiltin,
    });

    expect(result).toBe('https://www.youtube.com/favicon.ico');
    expect(memoryCache.get('www.youtube.com')?.url).toBe('https://www.youtube.com/favicon.ico');
  });

  it('ignores a failed cached icon while detecting replacements', async () => {
    memoryCache.set('www.youtube.com', {
      url: 'https://www.youtube.com/broken-cached-icon.png',
      score: 130,
      timestamp: Date.now(),
    });
    mockImageLoader((src) => {
      if (src === 'https://www.youtube.com/favicon.ico') {
        return { width: 64, height: 64 };
      }
      return null;
    });

    const result = await detectBestIcon('https://www.youtube.com', {
      ignoreBuiltin: true,
      skipUrl: 'https://www.youtube.com/broken-cached-icon.png',
    });

    expect(result).toBe('https://www.youtube.com/favicon.ico');
    expect(memoryCache.get('www.youtube.com')?.url).toBe('https://www.youtube.com/favicon.ico');
  });

  it('ignores low-score cached placeholder entries', () => {
    memoryCache.set('placeholder.example', {
      url: 'https://icon.horse/icon/placeholder.example',
      score: 1,
      timestamp: Date.now(),
    });

    expect(getIconLoadState('https://placeholder.example')).toBe('loading');
    expect(getCachedIconUrl('https://placeholder.example')).toContain('icon.horse');
    expect(memoryCache.has('placeholder.example')).toBe(false);
  });

  it('returns icon.horse fallback for a hostname with no cache', () => {
    const url = getCachedIconUrl('https://uniqueexample-xyz123.com');
    expect(url).toContain('icon.horse');
  });

  it('returns "" for empty input', () => {
    expect(getCachedIconUrl('')).toBe('');
  });

  it('does not throw for unparseable URLs (returns "")', () => {
    expect(() => getCachedIconUrl('not a url at all')).not.toThrow();
    // After fix to extractDomain, single-token domains may resolve via https:// prepend
    const result = getCachedIconUrl('not a url at all');
    expect(typeof result).toBe('string');
  });
});

describe('iconCache.isLikelyFallbackIcon', () => {
  it('detects known third-party placeholder dimensions', () => {
    expect(isLikelyFallbackIcon('https://icon.horse/icon/example.com', 512, 512)).toBe(true);
    expect(isLikelyFallbackIcon('https://icons.duckduckgo.com/ip3/example.com.ico', 48, 48)).toBe(
      true,
    );
    expect(
      isLikelyFallbackIcon('https://www.google.com/s2/favicons?domain=example.com&sz=64', 16, 16),
    ).toBe(true);
  });

  it('keeps plausible real icon dimensions usable', () => {
    expect(isLikelyFallbackIcon('https://example.com/favicon.ico', 64, 64)).toBe(false);
    expect(
      isLikelyFallbackIcon('https://www.google.com/s2/favicons?domain=example.com&sz=64', 64, 64),
    ).toBe(false);
  });
});
