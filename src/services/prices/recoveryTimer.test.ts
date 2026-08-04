/**
 * recovery probe 在执行期间遇到模式切换 / 冻结 / 资产清空时，不得在完成后把 timer 复活。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PriceService, TIER_RECOVERY_PROBE_MS } from './PriceService';
import { exchangeCatalog, EXCHANGE_CATALOG_STORAGE_KEY } from './exchangeCatalog';
import { BLUR_GRACE_MS, HIDDEN_GRACE_MS } from './lifecycle';
import { __setWebSocketFactoryForTest } from './socket';
import type { AssetKey, VenueInstrument } from './types';
import { makeInstrument } from './venues/shared';

const memoryStorage = () => (globalThis as any).__memoryStorage;

class SilentSocket {
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {}
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

/** Tier 1 始终失败；Tier 1 的恢复探测请求会卡在 gate 上 */
function mockVenues(): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const ts = String(Date.now());
    if (url.includes('XAAPL-USDT')) {
      tier1Requests += 1;
      if (!probeGateOpen) await new Promise<void>((resolve) => releaseProbe.push(resolve));
      return new Response('down', { status: 503 });
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
  it('probe 进行中转 passive-visible：完成后不重新挂 recovery timer', async () => {
    await enterFallbackWithRecoveryPending();

    focused = false;
    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(BLUR_GRACE_MS);
    expect(service.__transportModeForTest()).toBe('passive-visible');

    await drainProbe();

    // passive-visible 只保留 60 秒 targeted REST；recovery timer 不得被 probe 复活
    expect(service.__recoveryTimerActiveForTest()).toBe(false);
    await vi.advanceTimersByTimeAsync(TIER_RECOVERY_PROBE_MS * 2);
    await service.__settleForTest();
    expect(service.__transportModeForTest()).toBe('passive-visible');
    expect(service.__recoveryTimerActiveForTest()).toBe(false);
  });

  it('probe 进行中转 passive-hidden：完成后不重新挂 recovery timer', async () => {
    await enterFallbackWithRecoveryPending();

    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(HIDDEN_GRACE_MS);
    expect(service.__transportModeForTest()).toBe('passive-hidden');

    await drainProbe();

    expect(service.__recoveryTimerActiveForTest()).toBe(false);
    await vi.advanceTimersByTimeAsync(TIER_RECOVERY_PROBE_MS * 2);
    await service.__settleForTest();
    expect(service.__transportModeForTest()).toBe('passive-hidden');
    expect(service.__recoveryTimerActiveForTest()).toBe(false);
  });

  it('probe 进行中 pagehide / freeze：完成后不重新挂 recovery timer，也不留 WS', async () => {
    await enterFallbackWithRecoveryPending();

    window.dispatchEvent(new Event('pagehide'));
    document.dispatchEvent(new Event('freeze'));
    expect(service.__transportModeForTest()).toBe('off');

    await drainProbe();

    const before = tier1Requests;
    await vi.advanceTimersByTimeAsync(TIER_RECOVERY_PROBE_MS * 2);
    await service.__settleForTest();
    expect(service.__transportModeForTest()).toBe('off');
    expect(service.__connectionCountForTest()).toBe(0);
    expect(service.__recoveryTimerActiveForTest()).toBe(false);
    expect(tier1Requests).toBe(before);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('probe 进行中资产被清空：完成后不写状态也不复活 timer', async () => {
    const unsubscribe = await enterFallbackWithRecoveryPending();
    const snapshotBefore = service.getSnapshot('stock:AAPL')!.price;

    unsubscribe();
    await service.__settleForTest();
    expect(service.__transportModeForTest()).toBe('off');

    await drainProbe();

    const before = tier1Requests;
    await vi.advanceTimersByTimeAsync(TIER_RECOVERY_PROBE_MS * 2);
    await service.__settleForTest();

    expect(tier1Requests).toBe(before);
    expect(service.__recoveryTimerActiveForTest()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    // 资产已经不在 union 里，probe 的结果不得改写它的快照
    expect(service.getSnapshot('stock:AAPL')?.price).toBe(snapshotBefore);
  });
});
