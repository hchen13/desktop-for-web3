/**
 * WebSocket 静默连接自愈与本地新鲜度（W1–W3）
 *
 * socket 停在 OPEN 却不再推送是最难发现的一种断线：readyState 正常、onclose 不触发，
 * 行情却已经停了。必须区分三件事——连接活性（任何入站帧，含 pong）、报价新鲜度
 * （只有真实报价才算）、快照新鲜度（没有新报价也要到点自己变 stale，且不发 HTTP）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PriceService } from './PriceService';
import { exchangeCatalog, EXCHANGE_CATALOG_STORAGE_KEY } from './exchangeCatalog';
import {
  WS_LIVENESS_TIMEOUT_MS,
  __setReconnectJitterForTest,
  __setWebSocketFactoryForTest,
} from './socket';
import type { AssetKey, VenueInstrument } from './types';
import { makeInstrument } from './venues/shared';

const memoryStorage = () => (globalThis as any).__memoryStorage;

const RECONNECT_FIRST_BACKOFF_MS = 1000;

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 1;
  closed = false;
  sent: string[] = [];
  /** 是否自动回 pong；W1 要模拟完全没有入站帧 */
  static autoPong = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  send(payload: string): void {
    this.sent.push(payload);
    if (FakeSocket.autoPong && payload === 'ping') {
      queueMicrotask(() => this.onmessage?.({ data: 'pong' }));
    }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }
  push(data: unknown): void {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }
  subscribeMessages(): string[] {
    return this.sent.filter((m) => m.includes('subscribe'));
  }
  static openCount(): number {
    return FakeSocket.instances.filter((s) => !s.closed).length;
  }
  static newest(): FakeSocket {
    return FakeSocket.instances[FakeSocket.instances.length - 1];
  }
}

let service: PriceService;
let httpCount: number;

function spot(venue: VenueInstrument['venue'], instrumentId: string): VenueInstrument {
  return makeInstrument({
    venue,
    instrumentId,
    symbol: 'BTC',
    base: 'BTC',
    quote: 'USDT',
    category: 'crypto',
    productKind: 'crypto_spot',
    preferredPriceKind: 'last',
  });
}

async function seedCatalog(): Promise<void> {
  const now = Date.now();
  await chrome.storage.local.set({
    [EXCHANGE_CATALOG_STORAGE_KEY]: {
      version: 'v2',
      venueTimestamps: { okx: now, bitget: now, binance: now, hyperliquid: now },
      instruments: [spot('okx', 'BTC-USDT')],
    },
  });
}

function mockOkx(price = '100'): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    httpCount += 1;
    const url = String(input);
    if (!url.includes('okx.com/api/v5/market/ticker')) {
      return new Response('down', { status: 503 });
    }
    return new Response(
      JSON.stringify({
        code: '0',
        data: [
          {
            instId: 'BTC-USDT',
            last: price,
            open24h: price,
            ts: String(Date.now()),
            bidPx: price,
            askPx: price,
          },
        ],
      }),
    );
  });
}

function tickerFrame(price: string) {
  return {
    arg: { channel: 'tickers', instId: 'BTC-USDT' },
    data: [{ instId: 'BTC-USDT', last: price, open24h: price, ts: String(Date.now()) }],
  };
}

async function subscribeBtc() {
  await seedCatalog();
  mockOkx();
  const sub = service.subscribe(new Set<AssetKey>(['crypto:BTC']), () => {});
  await service.__settleForTest();
  await vi.advanceTimersByTimeAsync(0);
  return sub;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  memoryStorage()?.__reset?.();
  exchangeCatalog.__resetForTest();
  FakeSocket.instances = [];
  FakeSocket.autoPong = false;
  __setWebSocketFactoryForTest((url) => new FakeSocket(url) as unknown as WebSocket);
  __setReconnectJitterForTest(0);
  httpCount = 0;
  service = new PriceService();
});

afterEach(() => {
  service.__resetForTest();
  exchangeCatalog.__resetForTest();
  __setWebSocketFactoryForTest(null);
  __setReconnectJitterForTest(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('W1 socket 保持 OPEN 但完全没有入站帧', () => {
  it('180 秒内不动，到点关闭并按现有退避重连一次', async () => {
    await subscribeBtc();
    expect(httpCount).toBe(1);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(service.getSnapshot('crypto:BTC')!.quality).toBe('live');

    await vi.advanceTimersByTimeAsync(WS_LIVENESS_TIMEOUT_MS - 1);
    await service.__settleForTest();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0].closed).toBe(false);
    expect(httpCount).toBe(1);

    await vi.advanceTimersByTimeAsync(2);
    await service.__settleForTest();
    expect(FakeSocket.instances[0].closed).toBe(true);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(service.getSnapshot('crypto:BTC')!.quality).toBe('stale');
    expect(httpCount).toBe(1);

    await vi.advanceTimersByTimeAsync(RECONNECT_FIRST_BACKOFF_MS);
    await service.__settleForTest();
    expect(FakeSocket.instances).toHaveLength(2);
    expect(FakeSocket.openCount()).toBe(1);
    expect(FakeSocket.newest().subscribeMessages()).toHaveLength(1);

    FakeSocket.newest().push(tickerFrame('123'));
    await vi.advanceTimersByTimeAsync(500);
    const snapshot = service.getSnapshot('crypto:BTC')!;
    expect(snapshot.quality).toBe('live');
    expect(snapshot.price).toBe(123);
    expect(httpCount).toBe(1);
    expect(FakeSocket.instances).toHaveLength(2);
  });
});

describe('W2 只有 pong，没有有效报价', () => {
  it('pong 维持连接但不伪造行情新鲜度，快照到点本地变 stale', async () => {
    FakeSocket.autoPong = true;
    await subscribeBtc();
    expect(FakeSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(WS_LIVENESS_TIMEOUT_MS - 1);
    await service.__settleForTest();
    // pong 一直在刷新连接活性，不能误判断线
    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0].closed).toBe(false);
    expect(FakeSocket.instances[0].sent.filter((m) => m === 'ping').length).toBeGreaterThan(5);
    expect(service.getSnapshot('crypto:BTC')!.quality).toBe('live');

    await vi.advanceTimersByTimeAsync(2);
    await service.__settleForTest();
    // 连接还活着，但报价已经过期——pong 不是行情
    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0].closed).toBe(false);
    expect(service.getSnapshot('crypto:BTC')!.quality).toBe('stale');
    expect(httpCount).toBe(1);

    FakeSocket.instances[0].push(tickerFrame('456'));
    await vi.advanceTimersByTimeAsync(500);
    const snapshot = service.getSnapshot('crypto:BTC')!;
    expect(snapshot.quality).toBe('live');
    expect(snapshot.price).toBe(456);
    expect(httpCount).toBe(1);
  });
});

describe('W3 OFF 清理', () => {
  it('watchdog 到点前进入 OFF：不重连、不发请求、不留 timer', async () => {
    const sub = await subscribeBtc();

    await vi.advanceTimersByTimeAsync(WS_LIVENESS_TIMEOUT_MS - 1);
    await service.__settleForTest();
    const socketsBefore = FakeSocket.instances.length;
    const httpBefore = httpCount;

    sub.setActive(false);
    await service.__settleForTest();
    expect(service.__transportModeForTest()).toBe('off');
    expect(service.__connectionCountForTest()).toBe(0);

    const snapshotBefore = JSON.stringify(service.getSnapshot('crypto:BTC'));
    await vi.advanceTimersByTimeAsync(WS_LIVENESS_TIMEOUT_MS * 2);
    await service.__settleForTest();

    expect(FakeSocket.instances).toHaveLength(socketsBefore);
    expect(httpCount).toBe(httpBefore);
    expect(vi.getTimerCount()).toBe(0);
    expect(JSON.stringify(service.getSnapshot('crypto:BTC'))).toBe(snapshotBefore);
    expect(service.__desiredInstrumentsForTest()).toEqual([]);
  });
});
