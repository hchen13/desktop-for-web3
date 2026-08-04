import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QuoteSocketPool, __setWebSocketFactoryForTest, type SocketEndpoint } from './socket';
import { QuoteStore } from './quoteStore';
import type { VenueInstrument, VenueQuote } from './types';
import { makeInstrument } from './venues/shared';

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  emit(data: string): void {
    this.onmessage?.({ data });
  }

  /** 模拟远端断开 */
  drop(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }

  static reset(): void {
    FakeSocket.instances = [];
  }

  static openAll(): void {
    for (const socket of FakeSocket.instances) {
      if (socket.readyState === 0) socket.open();
    }
  }
}

function instrument(venue: VenueInstrument['venue'], id: string, symbol: string): VenueInstrument {
  return makeInstrument({
    venue,
    instrumentId: id,
    symbol,
    base: symbol,
    quote: 'USDT',
    category: 'crypto',
    productKind: 'crypto_spot',
    preferredPriceKind: 'last',
  });
}

function endpoint(key: string, venue: VenueInstrument['venue']): SocketEndpoint {
  return {
    key,
    venue,
    url: `wss://example.test/${key}`,
    supports: () => true,
    buildSubscribe: (list) => [{ op: 'subscribe', ids: list.map((i) => i.instrumentId) }],
    buildUnsubscribe: (list) => [{ op: 'unsubscribe', ids: list.map((i) => i.instrumentId) }],
    parseMessage: (data, list) => {
      const json = JSON.parse(data) as { id?: string; price?: number; ts?: number };
      const found = list.find((i) => i.instrumentId === json.id);
      if (!found || json.price == null) return [];
      const quote: VenueQuote = {
        assetKey: found.assetKey,
        venue: found.venue,
        instrumentId: found.instrumentId,
        productKind: found.productKind,
        priceKind: 'last',
        quoteCurrency: found.quote,
        price: json.price,
        change24h: null,
        volume24h: null,
        sourceTimestamp: json.ts ?? 1000,
        receivedAt: 1000,
      };
      return [quote];
    },
    heartbeat: { intervalMs: 25_000, payload: () => 'ping' },
  };
}

const okxEndpoint = endpoint('okx', 'okx');
const bitgetEndpoint = endpoint('bitget', 'bitget');

beforeEach(() => {
  FakeSocket.reset();
  __setWebSocketFactoryForTest((url) => new FakeSocket(url) as unknown as WebSocket);
});

afterEach(() => {
  __setWebSocketFactoryForTest(null);
  vi.useRealTimers();
});

describe('每 venue 一条连接与增量订阅', () => {
  it('同一 venue 的多个 instrument 复用一条连接', () => {
    const pool = new QuoteSocketPool([okxEndpoint, bitgetEndpoint], () => {});
    pool.setDesiredInstruments([
      instrument('okx', 'BTC-USDT', 'BTC'),
      instrument('okx', 'ETH-USDT', 'ETH'),
      instrument('okx', 'SOL-USDT', 'SOL'),
    ]);
    FakeSocket.openAll();

    expect(FakeSocket.instances).toHaveLength(1);
    expect(pool.connectionCount()).toBe(1);
    expect(JSON.parse(FakeSocket.instances[0].sent[0]).ids).toEqual([
      'BTC-USDT',
      'ETH-USDT',
      'SOL-USDT',
    ]);
    pool.closeAll();
  });

  it('相同 instrument set 不会重连也不会重复订阅', () => {
    const pool = new QuoteSocketPool([okxEndpoint], () => {});
    const set = [instrument('okx', 'BTC-USDT', 'BTC')];
    pool.setDesiredInstruments(set);
    FakeSocket.openAll();
    const sentAfterOpen = FakeSocket.instances[0].sent.length;

    pool.setDesiredInstruments([instrument('okx', 'BTC-USDT', 'BTC')]);

    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0].sent).toHaveLength(sentAfterOpen);
    pool.closeAll();
  });

  it('新增资产走增量 subscribe，移除资产走增量 unsubscribe', () => {
    const pool = new QuoteSocketPool([okxEndpoint], () => {});
    pool.setDesiredInstruments([instrument('okx', 'BTC-USDT', 'BTC')]);
    FakeSocket.openAll();
    const socket = FakeSocket.instances[0];

    pool.setDesiredInstruments([
      instrument('okx', 'BTC-USDT', 'BTC'),
      instrument('okx', 'ETH-USDT', 'ETH'),
    ]);
    expect(JSON.parse(socket.sent[socket.sent.length - 1])).toEqual({
      op: 'subscribe',
      ids: ['ETH-USDT'],
    });

    pool.setDesiredInstruments([instrument('okx', 'ETH-USDT', 'ETH')]);
    expect(JSON.parse(socket.sent[socket.sent.length - 1])).toEqual({
      op: 'unsubscribe',
      ids: ['BTC-USDT'],
    });

    expect(FakeSocket.instances).toHaveLength(1);
    pool.closeAll();
  });

  it('desired set 清空时关闭连接', () => {
    const pool = new QuoteSocketPool([okxEndpoint], () => {});
    pool.setDesiredInstruments([instrument('okx', 'BTC-USDT', 'BTC')]);
    FakeSocket.openAll();

    pool.setDesiredInstruments([]);

    expect(FakeSocket.instances[0].closed).toBe(true);
    expect(pool.connectionCount()).toBe(0);
  });

  it('venue 之间互相隔离：一个 venue 断开不影响另一个', () => {
    const pool = new QuoteSocketPool([okxEndpoint, bitgetEndpoint], () => {});
    pool.setDesiredInstruments([
      instrument('okx', 'BTC-USDT', 'BTC'),
      instrument('bitget', 'BTCUSDT', 'BTC'),
    ]);
    FakeSocket.openAll();
    expect(FakeSocket.instances).toHaveLength(2);

    const [okxSocket, bitgetSocket] = FakeSocket.instances;
    okxSocket.drop();

    expect(bitgetSocket.closed).toBe(false);
    expect(bitgetSocket.readyState).toBe(1);
    pool.closeAll();
  });
});

describe('断线重连', () => {
  it('断线后按退避重建且只重建一条连接，并恢复 desired set', () => {
    vi.useFakeTimers();
    const pool = new QuoteSocketPool([okxEndpoint], () => {});
    pool.setDesiredInstruments([
      instrument('okx', 'BTC-USDT', 'BTC'),
      instrument('okx', 'ETH-USDT', 'ETH'),
    ]);
    FakeSocket.openAll();
    FakeSocket.instances[0].drop();

    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(2000);
    expect(FakeSocket.instances).toHaveLength(2);

    FakeSocket.instances[1].open();
    expect(JSON.parse(FakeSocket.instances[1].sent[0]).ids).toEqual(['BTC-USDT', 'ETH-USDT']);
    pool.closeAll();
  });

  it('退避窗口内再次 setDesired 不会额外开出孤儿连接', () => {
    vi.useFakeTimers();
    const pool = new QuoteSocketPool([okxEndpoint], () => {});
    pool.setDesiredInstruments([instrument('okx', 'BTC-USDT', 'BTC')]);
    FakeSocket.openAll();
    FakeSocket.instances[0].drop();

    // 退避还没到期时又来一轮 reconcile
    pool.setDesiredInstruments([instrument('okx', 'BTC-USDT', 'BTC')]);
    expect(FakeSocket.instances).toHaveLength(2);

    vi.advanceTimersByTime(60_000);

    expect(FakeSocket.instances).toHaveLength(2);
    pool.closeAll();
  });

  it('主动 close 之后不再有重连 timer', () => {
    vi.useFakeTimers();
    const pool = new QuoteSocketPool([okxEndpoint], () => {});
    pool.setDesiredInstruments([instrument('okx', 'BTC-USDT', 'BTC')]);
    FakeSocket.openAll();

    pool.closeAll();
    vi.advanceTimersByTime(120_000);

    expect(FakeSocket.instances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('心跳按官方间隔发送', () => {
    vi.useFakeTimers();
    const pool = new QuoteSocketPool([okxEndpoint], () => {});
    pool.setDesiredInstruments([instrument('okx', 'BTC-USDT', 'BTC')]);
    FakeSocket.openAll();
    const socket = FakeSocket.instances[0];
    const before = socket.sent.length;

    vi.advanceTimersByTime(25_000);

    expect(socket.sent.slice(before)).toEqual(['ping']);
    pool.closeAll();
  });
});

describe('报价接收与时间戳单调', () => {
  it('推送的报价被解析并交给回调', () => {
    const received: VenueQuote[] = [];
    const pool = new QuoteSocketPool([okxEndpoint], (quotes) => received.push(...quotes));
    pool.setDesiredInstruments([instrument('okx', 'BTC-USDT', 'BTC')]);
    FakeSocket.openAll();

    FakeSocket.instances[0].emit(JSON.stringify({ id: 'BTC-USDT', price: 70000, ts: 5000 }));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ assetKey: 'crypto:BTC', price: 70000 });
    pool.closeAll();
  });

  it('时间戳倒退的数据被 QuoteStore 拒绝', () => {
    const store = new QuoteStore();
    const pool = new QuoteSocketPool([okxEndpoint], (quotes) => {
      for (const quote of quotes) store.ingest(quote);
    });
    pool.setDesiredInstruments([instrument('okx', 'BTC-USDT', 'BTC')]);
    FakeSocket.openAll();
    const socket = FakeSocket.instances[0];

    socket.emit(JSON.stringify({ id: 'BTC-USDT', price: 70000, ts: 5000 }));
    socket.emit(JSON.stringify({ id: 'BTC-USDT', price: 1, ts: 4000 }));

    expect(store.quotesFor('crypto:BTC')[0].price).toBe(70000);

    socket.emit(JSON.stringify({ id: 'BTC-USDT', price: 71000, ts: 6000 }));
    expect(store.quotesFor('crypto:BTC')[0].price).toBe(71000);
    pool.closeAll();
  });

  it('解析异常不会打断连接', () => {
    const received: VenueQuote[] = [];
    const pool = new QuoteSocketPool([okxEndpoint], (quotes) => received.push(...quotes));
    pool.setDesiredInstruments([instrument('okx', 'BTC-USDT', 'BTC')]);
    FakeSocket.openAll();
    const socket = FakeSocket.instances[0];

    socket.emit('not json');
    socket.emit(JSON.stringify({ id: 'BTC-USDT', price: 70000, ts: 5000 }));

    expect(received).toHaveLength(1);
    expect(socket.closed).toBe(false);
    pool.closeAll();
  });
});

describe('QuoteStore', () => {
  it('按资产聚合并可整体丢弃', () => {
    const store = new QuoteStore();
    const base: VenueQuote = {
      assetKey: 'crypto:BTC',
      venue: 'okx',
      instrumentId: 'BTC-USDT',
      productKind: 'crypto_spot',
      priceKind: 'last',
      quoteCurrency: 'USDT',
      price: 1,
      change24h: null,
      volume24h: null,
      sourceTimestamp: 1,
      receivedAt: 1,
    };
    store.ingest(base);
    store.ingest({ ...base, venue: 'bitget', instrumentId: 'BTCUSDT' });
    expect(store.quotesFor('crypto:BTC')).toHaveLength(2);

    store.dropAsset('crypto:BTC');
    expect(store.quotesFor('crypto:BTC')).toHaveLength(0);
    expect(store.size()).toBe(0);
  });

  it('时间戳相同时允许覆盖（幂等更新）', () => {
    const store = new QuoteStore();
    const base: VenueQuote = {
      assetKey: 'crypto:BTC',
      venue: 'okx',
      instrumentId: 'BTC-USDT',
      productKind: 'crypto_spot',
      priceKind: 'last',
      quoteCurrency: 'USDT',
      price: 1,
      change24h: null,
      volume24h: null,
      sourceTimestamp: 100,
      receivedAt: 1,
    };
    expect(store.ingest(base)).toBe(true);
    expect(store.ingest({ ...base, price: 2 })).toBe(true);
    expect(store.quotesFor('crypto:BTC')[0].price).toBe(2);
    expect(store.ingest({ ...base, price: 3, sourceTimestamp: 99 })).toBe(false);
  });
});
