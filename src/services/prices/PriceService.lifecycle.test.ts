import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PriceService, WS_UNCOVERED_REFRESH_MS } from './PriceService';
import { exchangeCatalog, EXCHANGE_CATALOG_STORAGE_KEY } from './exchangeCatalog';
import {
  BLUR_GRACE_MS,
  HIDDEN_GRACE_MS,
  PASSIVE_HIDDEN_INTERVAL_MS,
  PASSIVE_VISIBLE_INTERVAL_MS,
} from './lifecycle';
import { __setWebSocketFactoryForTest } from './socket';
import type { AssetKey, VenueInstrument } from './types';
import { makeInstrument } from './venues/shared';

const memoryStorage = () => (globalThis as any).__memoryStorage;

let visibility: DocumentVisibilityState = 'visible';
let focused = true;

function setVisibility(next: DocumentVisibilityState): void {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

function setFocus(next: boolean): void {
  focused = next;
  window.dispatchEvent(new Event(next ? 'focus' : 'blur'));
}

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 1;
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
    // 立即 open，方便断言订阅报文
    queueMicrotask(() => this.onopen?.());
  }
  send(): void {}
  close(): void {
    this.closed = true;
    this.readyState = 3;
  }
  static reset(): void {
    FakeSocket.instances = [];
  }
  static openCount(): number {
    return FakeSocket.instances.filter((s) => !s.closed).length;
  }
}

function spot(
  venue: VenueInstrument['venue'],
  instrumentId: string,
  symbol: string,
): VenueInstrument {
  return makeInstrument({
    venue,
    instrumentId,
    symbol,
    base: symbol,
    quote: 'USDT',
    category: 'crypto',
    productKind: 'crypto_spot',
    preferredPriceKind: 'last',
  });
}

function equityPerp(
  venue: VenueInstrument['venue'],
  instrumentId: string,
  symbol: string,
): VenueInstrument {
  return makeInstrument({
    venue,
    instrumentId,
    symbol,
    base: symbol,
    quote: 'USDT',
    category: 'stock',
    productKind: 'equity_perp',
    preferredPriceKind: 'index',
  });
}

function freshVenueTimestamps() {
  const now = Date.now();
  return { okx: now, bitget: now, binance: now, hyperliquid: now };
}

async function seedCatalog(instruments: VenueInstrument[]): Promise<void> {
  await chrome.storage.local.set({
    [EXCHANGE_CATALOG_STORAGE_KEY]: {
      version: 'v2',
      venueTimestamps: freshVenueTimestamps(),
      instruments,
    },
  });
}

let service: PriceService;
let quoteRequests: string[];

function mockFetch(): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    quoteRequests.push(url);
    if (url.includes('okx.com/api/v5/market/ticker')) {
      const instId = new URL(url).searchParams.get('instId')!;
      return new Response(
        JSON.stringify({ code: '0', data: [{ instId, last: '100', open24h: '99' }] }),
      );
    }
    return new Response('not found', { status: 404 });
  });
}

beforeEach(async () => {
  vi.useFakeTimers();
  visibility = 'visible';
  focused = true;
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  memoryStorage()?.__reset?.();
  exchangeCatalog.__resetForTest();
  FakeSocket.reset();
  __setWebSocketFactoryForTest((url) => new FakeSocket(url) as unknown as WebSocket);
  quoteRequests = [];
  service = new PriceService();
  await seedCatalog([spot('okx', 'BTC-USDT', 'BTC'), spot('okx', 'ETH-USDT', 'ETH')]);
  mockFetch();
});

afterEach(() => {
  service.__resetForTest();
  exchangeCatalog.__resetForTest();
  __setWebSocketFactoryForTest(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function subscribeBtc(): Promise<void> {
  service.subscribe(new Set<AssetKey>(['crypto:BTC']), () => {});
  await service.__settleForTest();
}

describe('REALTIME', () => {
  it('visible + focused 时开 WebSocket，且没有周期性 REST timer', async () => {
    await subscribeBtc();

    expect(service.__transportModeForTest()).toBe('realtime');
    expect(FakeSocket.openCount()).toBe(1);

    const before = quoteRequests.length;
    vi.advanceTimersByTime(PASSIVE_VISIBLE_INTERVAL_MS * 3);
    expect(quoteRequests).toHaveLength(before);
  });
});

describe('冷启动', () => {
  it('页面未取得焦点时进入 PASSIVE_VISIBLE，但仍立即拿到一次价格', async () => {
    focused = false;
    await subscribeBtc();

    expect(service.__transportModeForTest()).toBe('passive-visible');
    expect(FakeSocket.openCount()).toBe(0);
    // 新加入 union 的资产总是立即 targeted 刷新一次，不需要等 60 秒 timer
    expect(quoteRequests.some((u) => u.includes('instId=BTC-USDT'))).toBe(true);
    expect(service.getSnapshot('crypto:BTC')!.price).toBe(100);
  });

  it('用户点进页面拿到焦点后升级为 REALTIME 并开连接', async () => {
    focused = false;
    await subscribeBtc();
    expect(FakeSocket.openCount()).toBe(0);

    setFocus(true);
    await service.__settleForTest();

    expect(service.__transportModeForTest()).toBe('realtime');
    expect(FakeSocket.openCount()).toBe(1);
  });
});

describe('visible + blurred 宽限', () => {
  it('4 分 59 秒内保持原连接、不重连、不降频', async () => {
    await subscribeBtc();
    const socket = FakeSocket.instances[0];

    setFocus(false);
    vi.advanceTimersByTime(BLUR_GRACE_MS - 1000);

    expect(service.__transportModeForTest()).toBe('realtime');
    expect(socket.closed).toBe(false);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('满 5 分钟才关 WS 并进入 PASSIVE_VISIBLE 的 60 秒 targeted REST', async () => {
    await subscribeBtc();
    setFocus(false);
    vi.advanceTimersByTime(BLUR_GRACE_MS);

    expect(service.__transportModeForTest()).toBe('passive-visible');
    expect(FakeSocket.openCount()).toBe(0);

    const before = quoteRequests.length;
    vi.advanceTimersByTime(PASSIVE_VISIBLE_INTERVAL_MS - 1);
    expect(quoteRequests).toHaveLength(before);
    vi.advanceTimersByTime(1);
    await service.__settleForTest();
    expect(quoteRequests.length).toBeGreaterThan(before);
    expect(quoteRequests.every((u) => u.includes('instId='))).toBe(true);
  });

  it('宽限期内恢复 focus 不重连也不额外 refresh', async () => {
    await subscribeBtc();
    const before = quoteRequests.length;
    const socketCount = FakeSocket.instances.length;

    setFocus(false);
    vi.advanceTimersByTime(60_000);
    setFocus(true);
    await service.__settleForTest();

    expect(FakeSocket.instances).toHaveLength(socketCount);
    expect(FakeSocket.instances[0].closed).toBe(false);
    expect(quoteRequests).toHaveLength(before);
  });
});

describe('hidden 宽限与 PASSIVE_HIDDEN', () => {
  it('REALTIME → hidden 30 秒内保持原连接', async () => {
    await subscribeBtc();
    setVisibility('hidden');
    vi.advanceTimersByTime(HIDDEN_GRACE_MS - 1);

    expect(service.__transportModeForTest()).toBe('realtime');
    expect(FakeSocket.openCount()).toBe(1);
  });

  it('hidden 满 30 秒关闭 WS，并按 5 分钟做 targeted REST', async () => {
    await subscribeBtc();
    setVisibility('hidden');
    vi.advanceTimersByTime(HIDDEN_GRACE_MS);

    expect(service.__transportModeForTest()).toBe('passive-hidden');
    expect(FakeSocket.openCount()).toBe(0);

    const before = quoteRequests.length;
    vi.advanceTimersByTime(PASSIVE_HIDDEN_INTERVAL_MS - 1);
    expect(quoteRequests).toHaveLength(before);
    vi.advanceTimersByTime(1);
    await service.__settleForTest();
    expect(quoteRequests.length).toBeGreaterThan(before);
  });

  it('恢复 visible + focused 时只立即刷新一次并重开连接', async () => {
    await subscribeBtc();
    setVisibility('hidden');
    vi.advanceTimersByTime(HIDDEN_GRACE_MS);
    const before = quoteRequests.length;

    setVisibility('visible');
    await service.__settleForTest();

    expect(service.__transportModeForTest()).toBe('realtime');
    expect(FakeSocket.openCount()).toBe(1);
    // 一次立即刷新命中一个 instrument
    expect(quoteRequests.length - before).toBe(1);
  });

  it('快速切 tab 不会产生连接风暴', async () => {
    await subscribeBtc();
    const created = FakeSocket.instances.length;

    for (let i = 0; i < 10; i += 1) {
      setVisibility('hidden');
      vi.advanceTimersByTime(500);
      setVisibility('visible');
      vi.advanceTimersByTime(500);
    }

    expect(FakeSocket.instances).toHaveLength(created);
    expect(FakeSocket.openCount()).toBe(1);
  });
});

describe('pagehide / pageshow', () => {
  it('pagehide 立即关连接并清 timer，pageshow 后重新 reconcile', async () => {
    await subscribeBtc();
    window.dispatchEvent(new Event('pagehide'));

    expect(service.__transportModeForTest()).toBe('off');
    expect(FakeSocket.openCount()).toBe(0);

    const before = quoteRequests.length;
    window.dispatchEvent(new Event('pageshow'));
    await service.__settleForTest();

    expect(service.__transportModeForTest()).toBe('realtime');
    expect(FakeSocket.openCount()).toBe(1);
    expect(quoteRequests.length - before).toBe(1);
  });
});

describe('WS 未覆盖兜底', () => {
  it('Binance TradFi 永续与 Bitget 同名永续共存时仍按 60 秒兜底刷新', async () => {
    exchangeCatalog.__resetForTest();
    await seedCatalog([
      equityPerp('bitget', 'AAPLUSDT', 'AAPL'),
      equityPerp('binance', 'AAPLUSDT', 'AAPL'),
    ]);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      quoteRequests.push(url);
      if (url.includes('fapi.binance.com/fapi/v1/premiumIndex')) {
        return new Response(
          JSON.stringify({ symbol: 'AAPLUSDT', indexPrice: '190', markPrice: '190' }),
        );
      }
      if (url.includes('fapi.binance.com/fapi/v1/ticker/24hr')) {
        return new Response(JSON.stringify({ priceChangePercent: '1', quoteVolume: '10' }));
      }
      return new Response('not found', { status: 404 });
    });

    service.subscribe(new Set<AssetKey>(['stock:AAPL']), () => {});
    await service.__settleForTest();
    const premiumIndexCount = () => quoteRequests.filter((u) => u.includes('premiumIndex')).length;
    const before = premiumIndexCount();
    expect(before).toBeGreaterThan(0);

    vi.advanceTimersByTime(WS_UNCOVERED_REFRESH_MS);
    await service.__settleForTest();

    expect(premiumIndexCount()).toBeGreaterThan(before);
  });
});

describe('resume 契约', () => {
  it('resume 后进入 PASSIVE_VISIBLE 也要立即刷新一次，不用等 60 秒', async () => {
    focused = false;
    await subscribeBtc();
    vi.advanceTimersByTime(BLUR_GRACE_MS);
    expect(service.__transportModeForTest()).toBe('passive-visible');

    window.dispatchEvent(new Event('pagehide'));
    const before = quoteRequests.length;

    window.dispatchEvent(new Event('pageshow'));
    await service.__settleForTest();

    expect(service.__transportModeForTest()).toBe('passive-visible');
    expect(quoteRequests.length - before).toBe(1);
  });

  it('resume 后进入 PASSIVE_HIDDEN 也要立即刷新一次，不用等 5 分钟', async () => {
    await subscribeBtc();
    setVisibility('hidden');
    vi.advanceTimersByTime(HIDDEN_GRACE_MS);
    expect(service.__transportModeForTest()).toBe('passive-hidden');

    window.dispatchEvent(new Event('pagehide'));
    const before = quoteRequests.length;

    window.dispatchEvent(new Event('pageshow'));
    await service.__settleForTest();

    expect(service.__transportModeForTest()).toBe('passive-hidden');
    expect(quoteRequests.length - before).toBe(1);
  });

  it('resume 回到 REALTIME 时只刷一轮，不会因为两个回调各刷一次', async () => {
    await subscribeBtc();
    window.dispatchEvent(new Event('pagehide'));
    const before = quoteRequests.length;

    window.dispatchEvent(new Event('pageshow'));
    await service.__settleForTest();

    expect(service.__transportModeForTest()).toBe('realtime');
    expect(quoteRequests.length - before).toBe(1);
  });

  it('没有选中标的时，生命周期事件不产生任何价格请求', async () => {
    const sub = service.subscribe(new Set<AssetKey>(['crypto:BTC']), () => {});
    await service.__settleForTest();
    sub.setActive(false);
    await service.__settleForTest();
    const before = quoteRequests.length;

    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pageshow'));
    setVisibility('hidden');
    vi.advanceTimersByTime(HIDDEN_GRACE_MS * 2);
    setVisibility('visible');
    setFocus(false);
    vi.advanceTimersByTime(BLUR_GRACE_MS * 2);
    setFocus(true);
    await service.__settleForTest();

    expect(service.__transportModeForTest()).toBe('off');
    expect(FakeSocket.openCount()).toBe(0);
    expect(quoteRequests).toHaveLength(before);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('多 Watchlist / 多 layout', () => {
  it('active layout 的多个 Watchlist union 合并去重', async () => {
    service.subscribe(new Set<AssetKey>(['crypto:BTC']), () => {});
    service.subscribe(new Set<AssetKey>(['crypto:BTC', 'crypto:ETH']), () => {});
    await service.__settleForTest();

    const ids = service
      .__desiredInstrumentsForTest()
      .map((i) => i.instrumentId)
      .sort();
    expect(ids).toEqual(['BTC-USDT', 'ETH-USDT']);
    expect(FakeSocket.openCount()).toBe(1);
  });

  it('inactive keep-alive layout 不贡献订阅', async () => {
    const hidden = service.subscribe(new Set<AssetKey>(['crypto:ETH']), () => {});
    service.subscribe(new Set<AssetKey>(['crypto:BTC']), () => {});
    await service.__settleForTest();
    hidden.setActive(false);
    await service.__settleForTest();

    const ids = service.__desiredInstrumentsForTest().map((i) => i.instrumentId);
    expect(ids).toEqual(['BTC-USDT']);
  });

  it('active layout 没有 Watchlist 时价格网络活动为零', async () => {
    const only = service.subscribe(new Set<AssetKey>(['crypto:BTC']), () => {});
    await service.__settleForTest();

    only.setActive(false);
    await service.__settleForTest();
    const before = quoteRequests.length;
    vi.advanceTimersByTime(PASSIVE_HIDDEN_INTERVAL_MS * 2);
    await service.__settleForTest();

    expect(service.__transportModeForTest()).toBe('off');
    expect(FakeSocket.openCount()).toBe(0);
    expect(quoteRequests).toHaveLength(before);
    expect(service.__desiredInstrumentsForTest()).toHaveLength(0);
  });

  it('快速切 layout 不产生瞬时 close/open', async () => {
    const oldLayout = service.subscribe(new Set<AssetKey>(['crypto:BTC']), () => {});
    await service.__settleForTest();
    const created = FakeSocket.instances.length;

    // 同一次同步更新里：旧 layout 失活、新 layout 激活
    oldLayout.setActive(false);
    service.subscribe(new Set<AssetKey>(['crypto:BTC']), () => {});
    await service.__settleForTest();

    expect(FakeSocket.instances).toHaveLength(created);
    expect(FakeSocket.openCount()).toBe(1);
  });
});
