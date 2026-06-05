/**
 * RSS service tests
 * 通过暴露的纯函数 helper 测试核心逻辑
 */
import { describe, it, expect, vi } from 'vitest';
import {
  dedupeBySourceForTest,
  parseXMLForTest,
  mergeAndSortForTest,
  RSSService,
  type RSSItem,
} from './rssService';

const item = (overrides: Partial<RSSItem>): RSSItem => ({
  guid: 'g',
  title: 't',
  link: 'l',
  pubDate: new Date().toISOString(),
  description: '',
  source: 's',
  category: '',
  combinedTag: '',
  ...overrides,
});

describe('parseXML', () => {
  it('parses simple RSS items', () => {
    const xml = `<?xml version="1.0"?>
<rss>
  <channel>
    <item>
      <title>Hello</title>
      <link>https://example.com/1</link>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
      <guid>id-1</guid>
    </item>
    <item>
      <title>World</title>
      <link>https://example.com/2</link>
      <guid>id-2</guid>
    </item>
  </channel>
</rss>`;
    const parsed = parseXMLForTest(xml);
    expect(parsed).not.toBeNull();
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0].title).toBe('Hello');
    expect(parsed.items[0].guid).toBe('id-1');
  });

  it('returns null for malformed XML (no <rss>)', () => {
    expect(parseXMLForTest('<not-rss/>')).toBeNull();
  });

  it('handles dc:creator namespace gracefully', () => {
    const xml = `<?xml version="1.0"?>
<rss xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <item>
      <title>NS</title>
      <dc:creator>Alice</dc:creator>
      <link>https://example.com/x</link>
      <guid>ns-1</guid>
    </item>
  </channel>
</rss>`;
    const parsed = parseXMLForTest(xml);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].title).toBe('NS');
    // creator field stripped of namespace
    expect(parsed.items[0].creator).toBe('Alice');
  });

  it('preserves multiple categories', () => {
    const xml = `<?xml version="1.0"?>
<rss>
  <channel>
    <item>
      <title>Cats</title>
      <category domain="tag">News</category>
      <category domain="tag">Crypto</category>
      <link>l</link>
      <guid>c-1</guid>
    </item>
  </channel>
</rss>`;
    const parsed = parseXMLForTest(xml);
    expect(parsed.items[0].categories).toHaveLength(2);
  });
});

describe('dedupeBySource', () => {
  it('keeps newer pubDate when guid duplicates', () => {
    const older = item({ guid: 'a', pubDate: '2024-01-01T00:00:00Z', title: 'old' });
    const newer = item({ guid: 'a', pubDate: '2024-02-01T00:00:00Z', title: 'new' });
    const result = dedupeBySourceForTest([older, newer]);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('new');
  });

  it('Invalid Date never replaces a valid one', () => {
    const valid = item({ guid: 'b', pubDate: '2024-01-01T00:00:00Z', title: 'valid' });
    const invalid = item({ guid: 'b', pubDate: 'not-a-date', title: 'invalid' });
    // Order matters: invalid first, valid second
    const result = dedupeBySourceForTest([invalid, valid]);
    expect(result[0].title).toBe('valid');

    // Reverse order — valid first, then invalid; invalid must not displace
    const result2 = dedupeBySourceForTest([valid, invalid]);
    expect(result2[0].title).toBe('valid');
  });

  it('different guids are preserved', () => {
    const a = item({ guid: 'a' });
    const b = item({ guid: 'b' });
    const c = item({ guid: 'c' });
    expect(dedupeBySourceForTest([a, b, c])).toHaveLength(3);
  });
});

describe('mergeAndSort', () => {
  it('merges multiple sources sorted by pubDate desc', () => {
    const map = new Map<string, RSSItem[]>();
    map.set('s1', [
      item({ guid: 's1-1', pubDate: '2024-03-01T00:00:00Z', title: 'a' }),
      item({ guid: 's1-2', pubDate: '2024-01-01T00:00:00Z', title: 'b' }),
    ]);
    map.set('s2', [item({ guid: 's2-1', pubDate: '2024-02-01T00:00:00Z', title: 'c' })]);

    const result = mergeAndSortForTest(map);
    expect(result).toHaveLength(3);
    expect(result[0].title).toBe('a');
    expect(result[1].title).toBe('c');
    expect(result[2].title).toBe('b');
  });

  it('respects maxItems cap (default 50)', () => {
    const big = Array.from({ length: 100 }, (_, i) =>
      item({ guid: `g-${i}`, pubDate: new Date(Date.now() - i * 1000).toISOString() }),
    );
    const map = new Map<string, RSSItem[]>();
    map.set('s', big);
    const result = mergeAndSortForTest(map);
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it('empty map returns empty array', () => {
    const result = mergeAndSortForTest(new Map());
    expect(result).toEqual([]);
  });
});

describe('RSSService sync resilience', () => {
  it('all sources fail with cache: keeps cached items and reports retry state', async () => {
    const cached = item({
      guid: 'cached-1',
      title: 'cached',
      pubDate: '2024-01-01T00:00:00Z',
    });
    (globalThis as any).__memoryStorage.__setStore({
      'news-cache': {
        items: [cached],
        timestamp: 1700000000000,
        version: '1.0',
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));

    const service = new RSSService({ syncInterval: 60_000 });
    await service.sync();

    const state = service.getState();
    expect(state.status).toBe('error');
    expect(state.items).toEqual([cached]);
    expect(state.lastSync).toBe(1700000000000);
    expect((globalThis as any).__memoryStorage.__getStore()['news-cache'].items).toEqual([cached]);
  });

  it('all sources fail without cache: exits loading state with empty retry state', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));

    const service = new RSSService({ syncInterval: 60_000 });
    await service.sync();

    const state = service.getState();
    expect(state.status).toBe('error');
    expect(state.items).toEqual([]);
  });
});

describe('parsePubDate behavior (via parseXML pipeline)', () => {
  // Indirectly verified via parseXML + dedupeBySource. parsePubDate is private.
  it('XML with mixed valid/invalid dates does not crash', () => {
    const xml = `<?xml version="1.0"?>
<rss>
  <channel>
    <item><title>Bad</title><link>l</link><guid>bad-1</guid><pubDate>not-a-date</pubDate></item>
    <item><title>Good</title><link>l2</link><guid>good-1</guid><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>
  </channel>
</rss>`;
    const parsed = parseXMLForTest(xml);
    expect(parsed.items).toHaveLength(2);
  });
});
