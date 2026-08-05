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

/**
 * 连接在这段时间内一条入站帧都没有就判定为哑连接。
 *
 * socket 停在 OPEN 但不再推送是最难发现的一种断线：readyState 正常、onclose 不触发，
 * 行情却已经停了。窗口取 REALTIME 的新鲜度窗口——超过它报价本来就不能再算 live。
 */
export const WS_LIVENESS_TIMEOUT_MS = 3 * 60_000;

let webSocketFactory: WebSocketFactory | null = null;
let reconnectJitter = RECONNECT_JITTER;

/** 仅供测试注入假 WebSocket */
export function __setWebSocketFactoryForTest(factory: WebSocketFactory | null): void {
  webSocketFactory = factory;
}

/** 仅供测试固定退避抖动，让重连时刻可断言 */
export function __setReconnectJitterForTest(value: number | null): void {
  reconnectJitter = value ?? RECONNECT_JITTER;
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
  private livenessTimer: ReturnType<typeof setTimeout> | null = null;
  /** 最近一次收到任意入站帧的时间；pong 也算，它证明的是连接活性而不是行情新鲜度 */
  private lastFrameAt = 0;
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
    // 退避窗口内手动 open 时必须撤销排队中的重连，否则退避到期会再开一条无人引用的孤儿连接
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = createSocket(this.endpoint.url);
    if (!socket) return;
    this.socket = socket;
    this.lastFrameAt = Date.now();

    socket.onopen = () => {
      this.attempt = 0;
      this.subscribed.clear();
      if (this.desired.length > 0) {
        this.send(this.endpoint.buildSubscribe(this.desired));
        for (const i of this.desired) this.subscribed.add(i.instrumentId);
      }
      this.startHeartbeat();
      this.armLiveness(WS_LIVENESS_TIMEOUT_MS);
    };

    socket.onmessage = (event: MessageEvent) => {
      // 收到字节就说明连接还活着，哪怕是 pong 或解析不了的帧
      this.lastFrameAt = Date.now();
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
      this.stopLiveness();
      this.socket = null;
      this.subscribed.clear();
      if (this.closedByUs || this.desired.length === 0) return;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const backoff = Math.min(RECONNECT_BASE_MS * 2 ** this.attempt, RECONNECT_MAX_MS);
    const jitter = backoff * reconnectJitter * (Math.random() * 2 - 1);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(
      () => {
        this.reconnectTimer = null;
        if (this.desired.length > 0) this.open();
      },
      Math.max(RECONNECT_BASE_MS / 2, backoff + jitter),
    );
  }

  /**
   * 静默连接看门狗。socket 停在 OPEN 却不再推任何帧时 onclose 永远不会触发，
   * 只能靠「多久没收到帧」自己判定，然后主动断开走既有退避重连。
   */
  private armLiveness(delay: number): void {
    if (this.livenessTimer) {
      clearTimeout(this.livenessTimer);
      this.livenessTimer = null;
    }
    this.livenessTimer = setTimeout(
      () => {
        this.livenessTimer = null;
        if (!this.socket) return;
        const idle = Date.now() - this.lastFrameAt;
        if (idle < WS_LIVENESS_TIMEOUT_MS) {
          this.armLiveness(WS_LIVENESS_TIMEOUT_MS - idle);
          return;
        }
        this.dropSilentConnection();
      },
      Math.max(1, delay),
    );
  }

  private stopLiveness(): void {
    if (this.livenessTimer) {
      clearTimeout(this.livenessTimer);
      this.livenessTimer = null;
    }
  }

  private dropSilentConnection(): void {
    const socket = this.socket;
    this.stopLiveness();
    this.stopHeartbeat();
    this.socket = null;
    this.subscribed.clear();
    if (socket) {
      // 先摘掉 handler 再关，避免 onclose 又排一次重连
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
    if (this.desired.length > 0) this.scheduleReconnect();
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
    this.stopLiveness();
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
          out.add(`${instrument.venue}|${instrument.instrumentId}`);
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
