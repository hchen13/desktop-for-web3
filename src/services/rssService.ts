/**
 * RSS 资讯服务
 * 支持多源聚合、缓存、自动刷新
 * 降级策略: CORS代理失败 → RSS2JSON API
 */

const STORAGE_KEY_CACHE = 'news-cache';
const STORAGE_KEY_INTERVAL = 'news-sync-interval';

const isChromeContext = typeof chrome !== 'undefined' && chrome.storage?.local;

const storageGet = async (key: string): Promise<any> => {
  if (isChromeContext) {
    const result = await chrome.storage.local.get(key);
    return result[key];
  }
  const value = localStorage.getItem(key);
  return value ? JSON.parse(value) : null;
};

const storageSet = async (key: string, value: any): Promise<void> => {
  if (isChromeContext) {
    await chrome.storage.local.set({ [key]: value });
  } else {
    localStorage.setItem(key, JSON.stringify(value));
  }
};

const CORS_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?',
];
const RSS2JSON_API = 'https://api.rss2json.com/v1/api.json?rss_url=';

const IGNORED_CATEGORIES = ['Odaily', 'OdailyPlanet', 'Odaily星球日报'];

export interface RSSSourceConfig {
  name: string;
  baseUrl: string;
  channels: Record<string, RSSChannelConfig>;
}

export interface RSSChannelConfig {
  url: string;
  tag: string;
  enabled?: boolean;
}

export interface RSSServiceConfig {
  syncInterval: number;
  maxItems?: number;
}

export interface RSSItem {
  guid: string;
  title: string;
  link: string;
  pubDate: string;
  description: string;
  source: string;
  category: string;
  combinedTag: string;
}

export interface RSSCacheData {
  items: RSSItem[];
  timestamp: number;
  version: string;
}

export interface RSSDataState {
  status: 'syncing' | 'live';
  items: RSSItem[];
  lastSync: number;
}

const CACHE_VERSION = '1.0';
const DEFAULT_CONFIG: RSSServiceConfig = {
  syncInterval: 5 * 60 * 1000,
  maxItems: 50,
};

const RSS_SOURCES: Record<string, RSSSourceConfig> = {
  blockbeats: {
    name: 'BlockBeats',
    baseUrl: 'https://api.theblockbeats.news',
    channels: {
      newsflash: { url: 'https://api.theblockbeats.news/v2/rss/newsflash', tag: 'newsflash', enabled: true },
      article: { url: 'https://api.theblockbeats.news/v2/rss/article', tag: 'article', enabled: true },
    },
  },
  odaily: {
    name: 'Odaily',
    baseUrl: 'https://rss.odaily.news',
    channels: {
      newsflash: { url: 'https://rss.odaily.news/rss/newsflash', tag: 'newsflash', enabled: true },
      post: { url: 'https://rss.odaily.news/rss/post', tag: 'article', enabled: true },
    },
  },
  cointelegraph: {
    name: 'Cointelegraph',
    baseUrl: 'https://cointelegraph.com',
    channels: {
      main: { url: 'https://cointelegraph.com/rss', tag: 'news', enabled: true },
    },
  },
  coindesk: {
    name: 'CoinDesk',
    baseUrl: 'https://www.coindesk.com',
    channels: {
      main: { url: 'https://www.coindesk.com/arc/outboundfeeds/rss', tag: 'news', enabled: true },
    },
  },
};

class RSSService {
  private config: RSSServiceConfig;
  private syncTimer: number | null = null;
  private listeners: Set<(state: RSSDataState) => void> = new Set();
  private currentState: RSSDataState = {
    status: 'syncing',
    items: [],
    lastSync: 0,
  };

  constructor(config: Partial<RSSServiceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private updateState(newState: RSSDataState): void {
    this.currentState = newState;
    this.notifyListeners();
  }

  private notifyListeners(): void {
    this.listeners.forEach(callback => {
      try {
        callback({ ...this.currentState });
      } catch (error) {
        console.error('[RSSService] Callback error:', error);
      }
    });
  }

  private parseXML(xmlString: string): any {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

    const rss = xmlDoc.querySelector('rss');
    if (!rss) return null;

    const channel = rss.querySelector('channel');
    if (!channel) return null;

    const items: any[] = [];
    channel.querySelectorAll('item').forEach(item => {
      const parsedItem: any = {};

      const directChildren = Array.from(item.children);
      for (const child of directChildren) {
        const tagName = child.tagName.includes(':')
          ? child.tagName.split(':')[1]
          : child.tagName;

        if (tagName === 'category') {
          if (!parsedItem.categories) parsedItem.categories = [];
          const domain = child.getAttribute('domain') || '';
          const value = child.textContent?.trim() || '';
          if (value) {
            parsedItem.categories.push({ domain, value });
          }
        } else {
          parsedItem[tagName] = child.textContent;
        }
      }

      const guid = item.querySelector('guid')?.textContent || item.querySelector('link')?.textContent;
      if (guid) {
        parsedItem.guid = guid;
        items.push(parsedItem);
      }
    });

    return { items };
  }

  private extractCategory(item: any, sourceName: string): string | null {
    const categories = item.categories || [];

    if (sourceName === 'CoinDesk') {
      for (const cat of categories) {
        if (cat.domain && cat.domain !== 'tag' && cat.domain.startsWith('https://www.coindesk.com/')) {
          if (IGNORED_CATEGORIES.includes(cat.value)) continue;
          return cat.value;
        }
      }
    }

    for (const cat of categories) {
      const value = typeof cat === 'string' ? cat : cat.value;
      if (!value || IGNORED_CATEGORIES.includes(value)) continue;
      return value;
    }

    return null;
  }

  private parsePubDate(pubDate: string, fromRSS2JSON: boolean = false): string {
    if (!pubDate) return '';

    let dateStr = pubDate;

    if (fromRSS2JSON && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(pubDate)) {
      dateStr = pubDate.replace(' ', 'T') + 'Z';
    }

    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return pubDate;
    return date.toISOString();
  }

  private stripHtml(html: string): string {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '').trim();
  }

  private async fetchDirect(url: string): Promise<{ items: any[], fromRSS2JSON: boolean }> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    return { items: this.parseXML(xml)?.items || [], fromRSS2JSON: false };
  }

  private async fetchViaProxy(url: string): Promise<{ items: any[], fromRSS2JSON: boolean }> {
    for (const proxy of CORS_PROXIES) {
      try {
        const proxiedUrl = proxy + encodeURIComponent(url);
        const response = await fetch(proxiedUrl);
        if (!response.ok) continue;
        const xml = await response.text();
        const result = this.parseXML(xml);
        if (result?.items?.length > 0) {
          return { items: result.items, fromRSS2JSON: false };
        }
      } catch {
        continue;
      }
    }
    throw new Error('All proxies failed');
  }

  private async fetchViaRSS2JSON(url: string): Promise<{ items: any[], fromRSS2JSON: boolean }> {
    const apiUrl = RSS2JSON_API + encodeURIComponent(url);
    const response = await fetch(apiUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    if (data.status !== 'ok') throw new Error('RSS2JSON error');

    return {
      items: data.items.map((item: any) => ({
        title: item.title,
        link: item.link,
        pubDate: item.pubDate,
        description: item.description,
        guid: item.guid || item.link,
        categories: (item.categories || []).map((c: string) => ({ domain: '', value: c })),
      })),
      fromRSS2JSON: true,
    };
  }

  private getDevProxyUrl(url: string): string | null {
    const proxyMap: Record<string, { prefix: string; base: string }> = {
      'api.theblockbeats.news': { prefix: '/rss-proxy/blockbeats', base: 'https://api.theblockbeats.news' },
      'rss.odaily.news': { prefix: '/rss-proxy/odaily', base: 'https://rss.odaily.news' },
      'cointelegraph.com': { prefix: '/rss-proxy/cointelegraph', base: 'https://cointelegraph.com' },
      'www.coindesk.com': { prefix: '/rss-proxy/coindesk', base: 'https://www.coindesk.com' },
    };

    for (const [host, config] of Object.entries(proxyMap)) {
      if (url.includes(host)) {
        return url.replace(config.base, config.prefix);
      }
    }
    return null;
  }

  private async fetchViaDevProxy(url: string): Promise<{ items: any[], fromRSS2JSON: boolean }> {
    const proxyUrl = this.getDevProxyUrl(url);
    if (!proxyUrl) throw new Error('No dev proxy for this URL');

    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    return { items: this.parseXML(xml)?.items || [], fromRSS2JSON: false };
  }

  private async fetchRSS(url: string, sourceName: string, channelTag: string): Promise<RSSItem[]> {
    let rawItems: any[] = [];
    let fromRSS2JSON = false;

    const isDevEnv = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const methods = isChromeContext
      ? [() => this.fetchDirect(url), () => this.fetchViaProxy(url), () => this.fetchViaRSS2JSON(url)]
      : isDevEnv
        ? [() => this.fetchViaDevProxy(url), () => this.fetchViaRSS2JSON(url)]
        : [() => this.fetchViaProxy(url), () => this.fetchViaRSS2JSON(url)];

    for (const method of methods) {
      try {
        const result = await method();
        if (result.items.length > 0) {
          rawItems = result.items;
          fromRSS2JSON = result.fromRSS2JSON;
          break;
        }
      } catch {
        continue;
      }
    }

    if (rawItems.length === 0) {
      console.error(`[RSSService] All methods failed for ${sourceName}/${channelTag}`);
      return [];
    }

    const items: RSSItem[] = [];

    for (const item of rawItems) {
      const guid = item.guid || item.link;
      if (!guid) continue;

      const primaryCategory = this.extractCategory(item, sourceName);
      const combinedTag = primaryCategory || channelTag;

      items.push({
        guid,
        title: this.stripHtml(item.title || ''),
        link: item.link || '',
        pubDate: this.parsePubDate(item.pubDate || '', fromRSS2JSON),
        description: this.stripHtml(item.description || ''),
        source: sourceName,
        category: primaryCategory || '',
        combinedTag,
      });
    }

    console.log(`[RSSService] ${sourceName}/${channelTag}: ${items.length} items${fromRSS2JSON ? ' (rss2json)' : ''}`);
    return items;
  }

  private async fetchAllSources(): Promise<Map<string, RSSItem[]>> {
    const results = new Map<string, RSSItem[]>();
    const fetchPromises: Promise<void>[] = [];

    for (const [sourceId, source] of Object.entries(RSS_SOURCES)) {
      for (const [channelId, channel] of Object.entries(source.channels)) {
        if (!channel.enabled) continue;

        const promise = this.fetchRSS(channel.url, source.name, channel.tag).then(items => {
          if (items.length > 0) {
            const key = `${sourceId}:${channelId}`;
            results.set(key, items);
          }
        });

        fetchPromises.push(promise);
      }
    }

    await Promise.all(fetchPromises);
    return results;
  }

  private dedupeBySource(items: RSSItem[]): RSSItem[] {
    const guidMap = new Map<string, RSSItem>();

    for (const item of items) {
      const existing = guidMap.get(item.guid);

      if (!existing) {
        guidMap.set(item.guid, item);
      } else {
        const pubDate = new Date(item.pubDate).getTime();
        const existingPubDate = new Date(existing.pubDate).getTime();

        if (pubDate > existingPubDate) {
          guidMap.set(item.guid, item);
        }
      }
    }

    return Array.from(guidMap.values());
  }

  private mergeAndSort(sourceItems: Map<string, RSSItem[]>): RSSItem[] {
    const allItems: RSSItem[] = [];

    sourceItems.forEach((items) => {
      allItems.push(...items);
    });

    const deduped = this.dedupeBySource(allItems);

    deduped.sort((a, b) => {
      return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
    });

    const maxItems = this.config.maxItems || DEFAULT_CONFIG.maxItems;
    return deduped.slice(0, maxItems);
  }

  async getFromCache(): Promise<RSSItem[] | null> {
    try {
      const cached = await storageGet(STORAGE_KEY_CACHE) as RSSCacheData;

      if (!cached || !cached.items || cached.version !== CACHE_VERSION) {
        return null;
      }

      return cached.items;
    } catch (error) {
      console.error('[RSSService] Cache read error:', error);
      return null;
    }
  }

  private async saveToCache(items: RSSItem[]): Promise<void> {
    try {
      const data: RSSCacheData = {
        items,
        timestamp: Date.now(),
        version: CACHE_VERSION,
      };
      await storageSet(STORAGE_KEY_CACHE, data);
    } catch (error) {
      console.error('[RSSService] Cache write error:', error);
    }
  }

  async sync(): Promise<void> {
    this.updateState({
      ...this.currentState,
      status: 'syncing'
    });

    const sourceItems = await this.fetchAllSources();
    const newItems = this.mergeAndSort(sourceItems);

    const cached = await this.getFromCache();
    let finalItems: RSSItem[];

    if (cached && cached.length > 0) {
      const merged = [...newItems, ...cached];
      finalItems = this.dedupeBySource(merged);
      finalItems.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
      const maxItems = this.config.maxItems || 50;
      finalItems = finalItems.slice(0, maxItems);
    } else {
      finalItems = newItems;
    }

    await this.saveToCache(finalItems);

    this.updateState({
      status: 'live',
      items: finalItems,
      lastSync: Date.now(),
    });
  }

  subscribe(callback: (state: RSSDataState) => void): () => void {
    this.listeners.add(callback);

    this.initialize();

    if (this.syncTimer === null) {
      this.syncTimer = window.setInterval(() => {
        this.sync();
      }, this.config.syncInterval);
    }

    return () => {
      this.listeners.delete(callback);

      if (this.listeners.size === 0 && this.syncTimer !== null) {
        clearInterval(this.syncTimer);
        this.syncTimer = null;
      }
    };
  }

  private async initialize(): Promise<void> {
    const cached = await this.getFromCache();

    if (cached && cached.length > 0) {
      this.updateState({
        status: 'syncing',
        items: cached,
        lastSync: Date.now(),
      });
    } else {
      this.updateState({
        status: 'syncing',
        items: [],
        lastSync: 0,
      });
    }

    this.sync();
  }

  getState(): RSSDataState {
    return { ...this.currentState };
  }

  async forceSync(): Promise<void> {
    await this.sync();
  }

  updateConfig(config: Partial<RSSServiceConfig>): void {
    this.config = { ...this.config, ...config };

    if (this.syncTimer !== null) {
      clearInterval(this.syncTimer);
      this.syncTimer = window.setInterval(() => {
        this.sync();
      }, this.config.syncInterval);
    }
  }

  addSource(id: string, config: RSSSourceConfig): void {
    RSS_SOURCES[id] = config;
  }

  getSourceIds(): string[] {
    return Object.keys(RSS_SOURCES);
  }
}

const rssService = new RSSService();

export { rssService };
export default rssService;
