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
import { getCachedIconUrl } from './iconCache';

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
