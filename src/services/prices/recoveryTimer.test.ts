/**
 * recovery probe 在执行期间遇到模式切换 / 冻结 / 资产清空时，不得在完成后把 timer 复活。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PriceService, TIER_RECOVERY_PROBE_MS } from './PriceService';
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

class SilentSocket {
  static instances: SilentSocket[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    SilentSocket.instances.push(this);
  }
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
}

let visibility: DocumentVisibilityState;
let focused: boolean;
let service: PriceService;
let releaseProbe: Array<() => void>;
let probeGateOpen: boolean;
let tier1Requests: number;
/** 全部定向请求数 */
let totalRequests: number;
/** probe 卡住期间 Tier 1 是否已经恢复；恢复后放行的那次会返回真实可用报价 */
let tier1Recovered: boolean;

function instrument(
  venue: VenueInstrument['venue'],
  instrumentId: string,
  productKind: VenueInstrument['productKind'],
): VenueInstrument {
  return makeInstrument({
    venue,
    instrumentId,
    symbol: 'AAPL',
    base: 'AAPL',
    quote: 'USDT',
    category: 'stock',
    productKind,
    preferredPriceKind: productKind === 'equity_perp' ? 'index' : 'last',
  });
}

async function seedCatalog(): Promise<void> {
  const now = Date.now();
  await chrome.storage.local.set({
    [EXCHANGE_CATALOG_STORAGE_KEY]: {
      version: 'v2',
      venueTimestamps: { okx: now, bitget: now, binance: now, hyperliquid: now },
      instruments: [
        instrument('okx', 'XAAPL-USDT', 'tokenized_stock_spot'),
        instrument('bitget', 'AAPLUSDT', 'equity_perp'),
      ],
    },
  });
}

/**
 * Tier 1 起初失败，恢复探测的请求会卡在 gate 上。
 * gate 放行时如果 tier1Recovered 已置位，就返回一个真实可用的 Tier 1 报价——
 * 只有这样才能证明失效后的 probe 「有东西可写却没写」。
 */
function mockVenues(): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    totalRequests += 1;
    const ts = String(Date.now());
    if (url.includes('XAAPL-USDT')) {
      tier1Requests += 1;
      if (!probeGateOpen) await new Promise<void>((resolve) => releaseProbe.push(resolve));
      if (!tier1Recovered) return new Response('down', { status: 503 });
      return new Response(
        JSON.stringify({
          code: '0',
          data: [
            {
              instId: 'XAAPL-USDT',
              last: '300',
              open24h: '300',
              ts: String(Date.now()),
              bidPx: '300',
              askPx: '300',
            },
          ],
        }),
      );
    }
    if (url.includes('symbol=AAPLUSDT')) {
      return new Response(
        JSON.stringify({
          code: '00000',
          data: [
            {
              symbol: 'AAPLUSDT',
              lastPrice: '305',
              indexPrice: '305',
              price24hPcnt: '0',
              ts,
              bid1Price: '304.9',
              ask1Price: '305.1',
            },
          ],
        }),
      );
    }
    return new Response('not found', { status: 404 });
  });
}

/** 让服务进入「effective tier = 2，recovery timer 已挂起」的状态 */
async function enterFallbackWithRecoveryPending(): Promise<() => void> {
  await seedCatalog();
  mockVenues();
  const sub = service.subscribe(new Set<AssetKey>(['stock:AAPL']), () => {});
  await service.__settleForTest();
  expect(service.__desiredInstrumentsForTest().map((i) => i.instrumentId)).toEqual(['AAPLUSDT']);

  // 让恢复探测发出去并卡住
  probeGateOpen = false;
  const before = tier1Requests;
  await vi.advanceTimersByTimeAsync(TIER_RECOVERY_PROBE_MS + 10);
  expect(tier1Requests).toBeGreaterThan(before);

  return () => sub.unsubscribe();
}

function drainProbe(): Promise<void> {
  probeGateOpen = true;
  for (const release of releaseProbe) release();
  releaseProbe = [];
  return service.__settleForTest();
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  focused = true;
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  memoryStorage()?.__reset?.();
  exchangeCatalog.__resetForTest();
  __setWebSocketFactoryForTest((url) => new SilentSocket(url) as unknown as WebSocket);
  releaseProbe = [];
  probeGateOpen = true;
  tier1Requests = 0;
  totalRequests = 0;
  tier1Recovered = false;
  SilentSocket.instances = [];
  service = new PriceService();
});

afterEach(() => {
  service.__resetForTest();
  exchangeCatalog.__resetForTest();
  __setWebSocketFactoryForTest(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('recovery probe 不得在失效后复活 timer', () => {
  /** 失效前记下完整状态；四个分支的 probe 都会带着一条真实可用的 Tier 1 报价回来 */
  function frozenState() {
    return {
      price: service.getSnapshot('stock:AAPL')?.price,
      coverageTier: service.getSnapshot('stock:AAPL')?.coverageTier,
      desired: service.__desiredInstrumentsForTest().map((i) => i.instrumentId),
      catalog: exchangeCatalog.instrumentsFor('stock:AAPL').map((i) => i.instrumentId),
      sockets: SilentSocket.instances.length,
    };
  }

  it('probe 进行中转 passive-visible：拿到可用报价也不得升回 Tier 1 或复活 timer', async () => {
    await enterFallbackWithRecoveryPending();

    focused = false;
    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(BLUR_GRACE_MS);
    expect(service.__transportModeForTest()).toBe('passive-visible');
    await service.__settleForTest();
    // 基准取在失效之后：模式切换本身会用新的新鲜度窗口重算，那不是 probe 写的
    const before = frozenState();

    tier1Recovered = true;
    await drainProbe();

    expect(frozenState()).toEqual(before);
    expect(service.__recoveryTimerActiveForTest()).toBe(false);
    expect(service.__connectionCountForTest()).toBe(0);

    // 只剩 passive 自己那一份 timer：一个完整 interval 恰好一轮 targeted REST
    const requestsBefore = totalRequests;
    await vi.advanceTimersByTimeAsync(PASSIVE_VISIBLE_INTERVAL_MS - 1);
    expect(totalRequests).toBe(requestsBefore);
    await vi.advanceTimersByTimeAsync(1);
    await service.__settleForTest();
    expect(totalRequests - requestsBefore).toBe(1);
    expect(service.__transportModeForTest()).toBe('passive-visible');
    expect(service.__recoveryTimerActiveForTest()).toBe(false);
  });

  it('probe 进行中转 passive-hidden：拿到可用报价也不得升回 Tier 1 或复活 timer', async () => {
    await enterFallbackWithRecoveryPending();

    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(HIDDEN_GRACE_MS);
    expect(service.__transportModeForTest()).toBe('passive-hidden');
    await service.__settleForTest();
    const before = frozenState();

    tier1Recovered = true;
    await drainProbe();

    expect(frozenState()).toEqual(before);
    expect(service.__recoveryTimerActiveForTest()).toBe(false);
    expect(service.__connectionCountForTest()).toBe(0);

    const requestsBefore = totalRequests;
    await vi.advanceTimersByTimeAsync(PASSIVE_HIDDEN_INTERVAL_MS - 1);
    expect(totalRequests).toBe(requestsBefore);
    await vi.advanceTimersByTimeAsync(1);
    await service.__settleForTest();
    expect(totalRequests - requestsBefore).toBe(1);
    expect(service.__transportModeForTest()).toBe('passive-hidden');
    expect(service.__recoveryTimerActiveForTest()).toBe(false);
  });

  it('probe 进行中 pagehide / freeze：拿到可用报价也不写状态、不留 WS、不留 timer', async () => {
    await enterFallbackWithRecoveryPending();

    window.dispatchEvent(new Event('pagehide'));
    document.dispatchEvent(new Event('freeze'));
    expect(service.__transportModeForTest()).toBe('off');
    await service.__settleForTest();
    const before = frozenState();

    tier1Recovered = true;
    await drainProbe();

    expect(frozenState()).toEqual(before);
    const probesBefore = tier1Requests;
    await vi.advanceTimersByTimeAsync(TIER_RECOVERY_PROBE_MS * 2);
    await service.__settleForTest();
    expect(service.__transportModeForTest()).toBe('off');
    expect(service.__connectionCountForTest()).toBe(0);
    expect(service.__recoveryTimerActiveForTest()).toBe(false);
    expect(tier1Requests).toBe(probesBefore);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('probe 进行中资产被清空：拿到可用的 Tier 1 报价也不写状态、不复活 timer', async () => {
    const unsubscribe = await enterFallbackWithRecoveryPending();

    unsubscribe();
    await service.__settleForTest();
    expect(service.__transportModeForTest()).toBe('off');
    const before = frozenState();

    // 卡住的那次探测这时才恢复成功：有东西可写，才能证明它确实什么都没写
    tier1Recovered = true;
    await drainProbe();

    const probesBefore = tier1Requests;
    await vi.advanceTimersByTimeAsync(TIER_RECOVERY_PROBE_MS * 2);
    await service.__settleForTest();

    expect(tier1Requests).toBe(probesBefore);
    expect(service.__recoveryTimerActiveForTest()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(service.__connectionCountForTest()).toBe(0);
    // 资产已经不在 union 里：快照、effective tier、desired set、catalog 缓存都不得被改写
    expect(frozenState()).toEqual({ ...before, desired: [] });
  });
});
