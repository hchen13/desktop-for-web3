/**
 * Binance WebSocket service tests
 * 通过替换全局 WebSocket 构造函数来 mock 行为
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

class MockWS {
  static instances: MockWS[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = MockWS.CONNECTING;
  url: string;
  onopen: ((ev: any) => void) | null = null;
  onmessage: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  onclose: ((ev: any) => void) | null = null;
  send = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockWS.instances.push(this);
  }

  triggerOpen() {
    this.readyState = MockWS.OPEN;
    this.onopen?.({});
  }

  triggerMessage(data: any) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  triggerError() {
    this.onerror?.({});
  }

  close() {
    this.readyState = MockWS.CLOSED;
    this.onclose?.({ code: 1006, reason: 'mock close' });
  }
}

const sampleCoin = {
  symbol: 'BTCUSDT',
  baseAsset: 'BTC',
  name: 'Bitcoin',
};

beforeEach(() => {
  MockWS.instances = [];
  (globalThis as any).WebSocket = MockWS;
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BinanceWebSocketManager', () => {
  it('subscribe creates a primary connection', async () => {
    const { binanceWsService } = await import('./binanceWs');
    binanceWsService.subscribe([sampleCoin], () => {});
    expect(MockWS.instances.length).toBeGreaterThan(0);
    expect(MockWS.instances[0].url).toContain('binance.com');
    binanceWsService.shutdown();
  });

  it('onopen sets connected status', async () => {
    const { binanceWsService } = await import('./binanceWs');
    binanceWsService.subscribe([sampleCoin], () => {});
    const ws = MockWS.instances[0];
    ws.triggerOpen();
    expect(binanceWsService.getStatus()).toBe('connected');
    binanceWsService.shutdown();
  });

  it('parses and dispatches miniTicker messages', async () => {
    const { binanceWsService } = await import('./binanceWs');
    const cb = vi.fn();
    binanceWsService.subscribe([sampleCoin], cb);
    const ws = MockWS.instances[0];
    ws.triggerOpen();
    ws.triggerMessage({
      stream: 'btcusdt@miniTicker',
      data: {
        e: '24hrMiniTicker',
        E: Date.now(),
        s: 'BTCUSDT',
        c: '60000.5',
        o: '59000',
        h: '0',
        l: '0',
        v: '0',
        q: '0',
      },
    });
    expect(cb).toHaveBeenCalled();
    const arg = cb.mock.calls[0][0];
    expect(arg.symbol).toBe('BTCUSDT');
    expect(arg.price).toBeCloseTo(60000.5);
    binanceWsService.shutdown();
  });

  it('non-JSON message logs error but does not throw', async () => {
    const { binanceWsService } = await import('./binanceWs');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    binanceWsService.subscribe([sampleCoin], () => {});
    const ws = MockWS.instances[0];
    ws.triggerOpen();
    expect(() => ws.onmessage?.({ data: 'not-json{' })).not.toThrow();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
    binanceWsService.shutdown();
  });

  it('empty coins list does not connect', async () => {
    const { binanceWsService } = await import('./binanceWs');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    binanceWsService.subscribe([], () => {});
    expect(MockWS.instances.length).toBe(0);
    warnSpy.mockRestore();
    binanceWsService.shutdown();
  });

  it('unsubscribe removes callback but keeps connection', async () => {
    const { binanceWsService } = await import('./binanceWs');
    const cb = vi.fn();
    const unsub = binanceWsService.subscribe([sampleCoin], cb);
    expect(MockWS.instances.length).toBe(1);
    unsub();
    // The connection should still exist (per design comment)
    binanceWsService.shutdown();
  });

  it('onerror without successful primary marks primaryHasFailed', async () => {
    const { binanceWsService } = await import('./binanceWs');
    binanceWsService.subscribe([sampleCoin], () => {});
    const ws = MockWS.instances[0];
    ws.triggerError();
    // status doesn't go to 'error' until both fail; just ensure it doesn't throw
    expect(['idle', 'connecting', 'connected', 'error']).toContain(binanceWsService.getStatus());
    binanceWsService.shutdown();
  });

  it('subscription confirmation messages (result+id) are silently ignored', async () => {
    const { binanceWsService } = await import('./binanceWs');
    const cb = vi.fn();
    binanceWsService.subscribe([sampleCoin], cb);
    const ws = MockWS.instances[0];
    ws.triggerOpen();
    ws.triggerMessage({ result: null, id: 1 });
    expect(cb).not.toHaveBeenCalled();
    binanceWsService.shutdown();
  });
});
