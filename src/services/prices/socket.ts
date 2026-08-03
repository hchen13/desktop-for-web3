/**
 * 行情 WebSocket 传输层
 *
 * 每个 endpoint 最多一条连接，连接内复用多个 selected instrument：
 *  - desired instrument set 相同（fingerprint 一致）时绝不重连
 *  - 新增/移除资产走增量 subscribe / unsubscribe
 *  - 断线指数退避 + jitter，重连后恢复当前 desired set
 *  - 官方心跳、连接清理、单 endpoint 失败隔离
 */

import type { Venue, VenueInstrument, VenueQuote } from './types';

export interface SocketEndpoint {
  /** 连接标识；同一 venue 只有一个 endpoint 时等于 venue 名 */
  key: string;
  venue: Venue;
  url: string;
  supports(instrument: VenueInstrument): boolean;
  buildSubscribe(instruments: VenueInstrument[]): unknown[];
  buildUnsubscribe(instruments: VenueInstrument[]): unknown[];
  parseMessage(data: string, instruments: VenueInstrument[]): VenueQuote[];
  heartbeat?: { intervalMs: number; payload: () => unknown };
}

type WebSocketFactory = (url: string) => WebSocket;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_JITTER = 0.3;

let webSocketFactory: WebSocketFactory | null = null;

/** 仅供测试注入假 WebSocket */
export function __setWebSocketFactoryForTest(factory: WebSocketFactory | null): void {
  webSocketFactory = factory;
}

function createSocket(url: string): WebSocket | null {
  if (webSocketFactory) return webSocketFactory(url);
  if (typeof WebSocket === 'undefined') return null;
  return new WebSocket(url);
}

function fingerprintOf(instruments: VenueInstrument[]): string {
  return instruments
    .map((i) => i.instrumentId)
    .sort()
    .join(',');
}

class EndpointConnection {
  private socket: WebSocket | null = null;
  private desired: VenueInstrument[] = [];
  private desiredFingerprint = '';
  private subscribed = new Set<string>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private attempt = 0;
  private closedByUs = false;

  constructor(
    private readonly endpoint: SocketEndpoint,
    private readonly onQuotes: (quotes: VenueQuote[]) => void,
  ) {}

  setDesired(instruments: VenueInstrument[]): void {
    const fingerprint = fingerprintOf(instruments);
    if (fingerprint === this.desiredFingerprint && (this.socket || instruments.length === 0)) {
      return;
    }
    const previous = this.desired;
    this.desired = instruments;
    this.desiredFingerprint = fingerprint;

    if (instruments.length === 0) {
      this.close();
      return;
    }
    if (!this.socket) {
      this.open();
      return;
    }
    if (this.socket.readyState !== 1) return;

    const desiredIds = new Set(instruments.map((i) => i.instrumentId));
    const removed = previous.filter((i) => !desiredIds.has(i.instrumentId));
    const added = instruments.filter((i) => !this.subscribed.has(i.instrumentId));
    if (removed.length > 0) {
      this.send(this.endpoint.buildUnsubscribe(removed));
      for (const i of removed) this.subscribed.delete(i.instrumentId);
    }
    if (added.length > 0) {
      this.send(this.endpoint.buildSubscribe(added));
      for (const i of added) this.subscribed.add(i.instrumentId);
    }
  }

  close(): void {
    this.closedByUs = true;
    this.clearTimers();
    this.subscribed.clear();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        /* 已经断开 */
      }
    }
  }

  isOpen(): boolean {
    return this.socket != null;
  }

  coveredInstrumentIds(): string[] {
    return this.desired.map((i) => i.instrumentId);
  }

  private open(): void {
    this.closedByUs = false;
    const socket = createSocket(this.endpoint.url);
    if (!socket) return;
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.subscribed.clear();
      if (this.desired.length > 0) {
        this.send(this.endpoint.buildSubscribe(this.desired));
        for (const i of this.desired) this.subscribed.add(i.instrumentId);
      }
      this.startHeartbeat();
    };

    socket.onmessage = (event: MessageEvent) => {
      try {
        const quotes = this.endpoint.parseMessage(String(event.data), this.desired);
        if (quotes.length > 0) this.onQuotes(quotes);
      } catch (err) {
        console.warn(`[${this.endpoint.key}] parse failed`, err);
      }
    };

    socket.onerror = () => {
      /* onclose 会接着触发重连 */
    };

    socket.onclose = () => {
      this.stopHeartbeat();
      this.socket = null;
      this.subscribed.clear();
      if (this.closedByUs || this.desired.length === 0) return;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const backoff = Math.min(RECONNECT_BASE_MS * 2 ** this.attempt, RECONNECT_MAX_MS);
    const jitter = backoff * RECONNECT_JITTER * (Math.random() * 2 - 1);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(
      () => {
        this.reconnectTimer = null;
        if (this.desired.length > 0) this.open();
      },
      Math.max(RECONNECT_BASE_MS / 2, backoff + jitter),
    );
  }

  private startHeartbeat(): void {
    const heartbeat = this.endpoint.heartbeat;
    if (!heartbeat || this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      this.send([heartbeat.payload()]);
    }, heartbeat.intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private send(messages: unknown[]): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) return;
    for (const message of messages) {
      try {
        socket.send(typeof message === 'string' ? message : JSON.stringify(message));
      } catch (err) {
        console.warn(`[${this.endpoint.key}] send failed`, err);
      }
    }
  }
}

export class QuoteSocketPool {
  private connections = new Map<string, EndpointConnection>();

  constructor(
    private readonly endpoints: SocketEndpoint[],
    private readonly onQuotes: (quotes: VenueQuote[]) => void,
  ) {}

  setDesiredInstruments(instruments: VenueInstrument[]): void {
    for (const endpoint of this.endpoints) {
      const mine = instruments.filter((i) => i.venue === endpoint.venue && endpoint.supports(i));
      const existing = this.connections.get(endpoint.key);
      if (!existing && mine.length === 0) continue;
      const connection = existing ?? this.createConnection(endpoint);
      connection.setDesired(mine);
      if (mine.length === 0) this.connections.delete(endpoint.key);
    }
  }

  /** 哪些 instrument 有 WebSocket 覆盖；其余需要 targeted REST 兜底 */
  coveredInstrumentIds(instruments: VenueInstrument[]): Set<string> {
    const out = new Set<string>();
    for (const endpoint of this.endpoints) {
      for (const instrument of instruments) {
        if (instrument.venue === endpoint.venue && endpoint.supports(instrument)) {
          out.add(instrument.instrumentId);
        }
      }
    }
    return out;
  }

  closeAll(): void {
    for (const connection of this.connections.values()) connection.close();
    this.connections.clear();
  }

  connectionCount(): number {
    let count = 0;
    for (const connection of this.connections.values()) {
      if (connection.isOpen()) count += 1;
    }
    return count;
  }

  private createConnection(endpoint: SocketEndpoint): EndpointConnection {
    const connection = new EndpointConnection(endpoint, this.onQuotes);
    this.connections.set(endpoint.key, connection);
    return connection;
  }
}
