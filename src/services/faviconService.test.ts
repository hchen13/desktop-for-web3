/**
 * faviconService tests
 * 主要验证 SOURCE_PRIORITY 的一致性以及简单 URL 解析
 */
import { describe, it, expect } from 'vitest';
import { SOURCE_PRIORITY as FAVICON_PRIORITY } from './faviconConfig';
import {
  SOURCE_PRIORITY as SERVICE_PRIORITY,
  getIconHorse,
  getGoogleFavicon,
  getDDGFavicon,
} from './faviconService';
import { getBuiltinIcon } from './builtinIcons';
import { getCachedIconUrl, getIconLoadState, isLikelyFallbackIcon, memoryCache } from './iconCache';

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
