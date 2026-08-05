/**
 * 每资产 / 每 candidate 的独立恢复调度（R1–R4）
 *
 * 「全局 timer 到期就把所有资产都重试一遍」会让后加入的资产被别人的 timer 拖着走，
 * 也会让同一个 candidate 在 5 分钟内被打两次。这里按真实时间线逐次核对请求明细。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CANDIDATE_RETRY_MS, PriceService } from './PriceService';
import { exchangeCatalog } from './exchangeCatalog';
import { __setReconnectJitterForTest, __setWebSocketFactoryForTest } from './socket';
import type { AssetKey } from './types';

const memoryStorage = () => (globalThis as any).__memoryStorage;

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 1;
  closed = false;
  sent: string[] = [];
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
    // OKX/Bitget 的官方心跳是纯文本 ping/pong
    if (payload === 'ping') queueMicrotask(() => this.onmessage?.({ data: 'pong' }));
  }
  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }
  push(data: unknown): void {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }
  static openCount(): number {
    return FakeSocket.instances.filter((s) => !s.closed).length;
  }
  static live(): FakeSocket[] {
    return FakeSocket.instances.filter((s) => !s.closed);
  }
}

interface Recorded {
  at: number;
  method: string;
  url: string;
  body: string;
  assetKey: string;
  venue: string;
  tier: number;
}

let service: PriceService;
let records: Recorded[];
let t0: number;
let visibility: DocumentVisibilityState;
let focused: boolean;
/** 当前哪些 instrument 片段会返回可用报价 */
let live: Set<string>;

const SECOND = 1000;

function classify(url: string, body: string): Omit<Recorded, 'at' | 'method' | 'url' | 'body'> {
  const symbolOf = (raw: string) => raw.replace(/^[XR]/, '').replace(/B?USDT.*$/, '');
  if (url.includes('okx.com')) {
    const instId = new URL(url).searchParams.get('instId') ?? '';
    return {
      assetKey: `stock:${symbolOf(instId.split('-')[0])}`,
      venue: 'okx',
      tier: url.includes('index-tickers') ? 2 : 1,
    };
  }
  if (url.includes('bitget.com')) {
    const params = new URL(url).searchParams;
    return {
      assetKey: `stock:${symbolOf(params.get('symbol') ?? '')}`,
      venue: 'bitget',
      tier: params.get('category') === 'SPOT' ? 1 : 2,
    };
  }
  if (url.includes('binance')) {
    const params = new URL(url).searchParams;
    const single = params.get('symbol');
    const batch = params.get('symbols');
    const raw = single ?? (batch ? (JSON.parse(batch) as string[])[0] : '');
    return { assetKey: `stock:${symbolOf(raw)}`, venue: 'binance', tier: single ? 2 : 1 };
  }
  const coin = /"coin"\s*:\s*"([^"]+)"/.exec(body)?.[1] ?? '';
  return { assetKey: `stock:${coin.split(':').pop() ?? ''}`, venue: 'hyperliquid', tier: 3 };
}

function mockVenues(): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const body = String((init as RequestInit)?.body ?? '');
    records.push({
      at: Date.now(),
      method: (init as RequestInit)?.method ?? 'GET',
      url,
      body,
      ...classify(url, body),
    });

    const hit = [...live].some((id) => url.includes(id));
    if (!hit) return new Response('down', { status: 503 });
    const price = '300';
    if (url.includes('okx.com')) {
      const instId = new URL(url).searchParams.get('instId')!;
      return new Response(
        JSON.stringify({
          code: '0',
          data: [
            {
              instId,
              last: price,
              idxPx: price,
              open24h: price,
              ts: String(Date.now()),
              bidPx: price,
              askPx: price,
            },
          ],
        }),
      );
    }
    if (url.includes('bitget.com')) {
      const symbol = new URL(url).searchParams.get('symbol')!;
      return new Response(
        JSON.stringify({
          code: '00000',
          data: [
            {
              symbol,
              lastPrice: price,
              indexPrice: price,
              price24hPcnt: '0',
              ts: String(Date.now()),
              bid1Price: price,
              ask1Price: price,
            },
          ],
        }),
      );
    }
    const batch = new URL(url).searchParams.get('symbols');
    const symbols = batch
      ? (JSON.parse(batch) as string[])
      : [new URL(url).searchParams.get('symbol')!];
    return new Response(
      JSON.stringify(
        symbols.map((symbol) => ({
          symbol,
          lastPrice: price,
          priceChangePercent: '0',
          quoteVolume: '1000',
          closeTime: Date.now(),
          bidPrice: price,
          askPrice: price,
        })),
      ),
    );
  });
}

/** 推进到 t0 之后的绝对秒数，并让所有异步落定 */
async function advanceTo(seconds: number): Promise<void> {
  const target = t0 + seconds * SECOND;
  const delta = target - Date.now();
  if (delta < 0) throw new Error(`时间不能回退：已在 ${(Date.now() - t0) / SECOND}s`);
  if (delta > 0) await vi.advanceTimersByTimeAsync(delta);
  await service.__settleForTest();
}

function since(mark: number): Recorded[] {
  return records.slice(mark);
}

function countFor(list: Recorded[], assetKey: string): number {
  return list.filter((r) => r.assetKey === assetKey).length;
}

/** 同一个 candidate 的相邻请求间隔不得小于 5 分钟 */
function minSpacingByCandidate(): number {
  const byCandidate = new Map<string, number[]>();
  for (const r of records) {
    const id = `${r.assetKey}|${r.venue}|${r.url}`;
    const list = byCandidate.get(id);
    if (list) list.push(r.at);
    else byCandidate.set(id, [r.at]);
  }
  let min = Infinity;
  for (const times of byCandidate.values()) {
    for (let i = 1; i < times.length; i += 1) min = Math.min(min, times[i] - times[i - 1]);
  }
  return min;
}

beforeEach(() => {
  vi.useFakeTimers();
  t0 = Date.now();
  visibility = 'visible';
  focused = true;
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  memoryStorage()?.__reset?.();
  exchangeCatalog.__resetForTest();
  FakeSocket.instances = [];
  __setWebSocketFactoryForTest((url) => new FakeSocket(url) as unknown as WebSocket);
  __setReconnectJitterForTest(0);
  records = [];
  live = new Set();
  service = new PriceService();
  mockVenues();
});

afterEach(() => {
  service.__resetForTest();
  exchangeCatalog.__resetForTest();
  __setWebSocketFactoryForTest(null);
  __setReconnectJitterForTest(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('R1 多资产 staggered 重试', () => {
  it('各资产按自己的 eligibility 重试，不被别人的 timer 带着走', async () => {
    const sub = service.subscribe(new Set<AssetKey>(['stock:AAPL']), () => {});
    await service.__settleForTest();

    // t=0：AAPL 完整一轮 Tier 1 + Tier 2
    expect(countFor(records, 'stock:AAPL')).toBe(7);
    expect(records).toHaveLength(7);

    // t=299：NVDA 加入，只有它自己发请求
    let mark = records.length;
    await advanceTo(299);
    sub.updateAssets(new Set<AssetKey>(['stock:AAPL', 'stock:NVDA']));
    await service.__settleForTest();
    expect(countFor(since(mark), 'stock:NVDA')).toBe(7);
    expect(countFor(since(mark), 'stock:AAPL')).toBe(0);
    expect(records).toHaveLength(14);

    // t=300：只有 AAPL 到期
    mark = records.length;
    await advanceTo(300);
    expect(countFor(since(mark), 'stock:AAPL')).toBe(7);
    expect(countFor(since(mark), 'stock:NVDA')).toBe(0);
    expect(records).toHaveLength(21);

    // NVDA 的第一轮 recovery 必须等到它自己的 t=599
    mark = records.length;
    await advanceTo(598);
    expect(countFor(since(mark), 'stock:NVDA')).toBe(0);

    mark = records.length;
    await advanceTo(599);
    expect(countFor(since(mark), 'stock:NVDA')).toBe(7);
    expect(countFor(since(mark), 'stock:AAPL')).toBe(0);
    expect(records).toHaveLength(28);

    expect(minSpacingByCandidate()).toBeGreaterThanOrEqual(CANDIDATE_RETRY_MS);
    expect(FakeSocket.openCount()).toBe(0);
    expect(records.filter((r) => r.tier === 3)).toEqual([]);
  });
});

describe('R2 USDT → AAPL：transport mode 没有变化也要能起 recovery', () => {
  it('desired 仍为空时也必须排上 recovery，并按 5 分钟 eligibility 重试', async () => {
    const sub = service.subscribe(new Set<AssetKey>(['crypto:USDT']), () => {});
    await service.__settleForTest();

    expect(records).toHaveLength(0);
    expect(FakeSocket.openCount()).toBe(0);
    expect(service.__recoveryTimerActiveForTest()).toBe(false);
    expect(service.getSnapshot('crypto:USDT')!.quality).toBe('unavailable');
    expect(records.some((r) => r.url.includes('BTC'))).toBe(false);

    await advanceTo(10);
    const mark = records.length;
    sub.updateAssets(new Set<AssetKey>(['stock:AAPL']));
    await service.__settleForTest();

    expect(since(mark)).toHaveLength(7);
    expect(service.__desiredInstrumentsForTest()).toEqual([]);
    // transport mode 全程都是 realtime，recovery 不能靠模式变化来触发
    expect(service.__transportModeForTest()).toBe('realtime');
    expect(service.__recoveryTimerActiveForTest()).toBe(true);

    const beforeDue = records.length;
    await advanceTo(309);
    expect(since(beforeDue)).toHaveLength(0);

    await advanceTo(310);
    expect(since(beforeDue)).toHaveLength(7);

    // 下一轮只有 OKX 恢复
    live.add('XAAPL-USDT');
    const beforeRecover = records.length;
    await advanceTo(610);
    const recovered = since(beforeRecover);
    const urls = recovered.map((r) => r.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(service.getSnapshot('stock:AAPL')!.price).toBe(300);
    expect(service.__desiredInstrumentsForTest().map((i) => i.instrumentId)).toEqual([
      'XAAPL-USDT',
    ]);
    expect(FakeSocket.openCount()).toBe(1);

    // 成功之后不得立刻再发一轮 candidate
    const afterRecover = records.length;
    await advanceTo(611);
    expect(since(afterRecover)).toHaveLength(0);
  });
});

describe('R3 结构性无 candidate 的资产', () => {
  for (const assetKey of ['crypto:USDT', 'fx:EURUSD'] as AssetKey[]) {
    it(`${assetKey} 全程零请求、零 WS、零 recovery timer`, async () => {
      service.subscribe(new Set<AssetKey>([assetKey]), () => {});
      await service.__settleForTest();
      await service.refreshAssets(new Set<AssetKey>([assetKey]));

      const expectClean = () => {
        expect(records).toEqual([]);
        expect(FakeSocket.openCount()).toBe(0);
        expect(service.__recoveryTimerActiveForTest()).toBe(false);
        expect(service.getSnapshot(assetKey)!.quality).toBe('unavailable');
      };
      expectClean();

      // REALTIME 跑 20 分钟
      await advanceTo(20 * 60);
      expectClean();

      // PASSIVE_VISIBLE 多个 tick
      focused = false;
      window.dispatchEvent(new Event('blur'));
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 4 * 60_000);
      await service.__settleForTest();
      expect(service.__transportModeForTest()).toBe('passive-visible');
      expectClean();

      // PASSIVE_HIDDEN 多个 tick
      visibility = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(3 * 5 * 60_000);
      await service.__settleForTest();
      expect(service.__transportModeForTest()).toBe('passive-hidden');
      expectClean();

      // freeze / resume
      visibility = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      focused = true;
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('pagehide'));
      document.dispatchEvent(new Event('freeze'));
      document.dispatchEvent(new Event('resume'));
      window.dispatchEvent(new Event('pageshow'));
      await service.__settleForTest();
      expectClean();

      expect(records.some((r) => r.url.includes('BTC'))).toBe(false);
      expect(records.some((r) => r.venue === 'hyperliquid')).toBe(false);
    });
  }
});

describe('R4 同 Tier 缺失 venue 的恢复', () => {
  /** OKX 成功、Bitget/Binance 失败的统一初态 */
  async function subscribeWithOnlyOkx(): Promise<void> {
    live.add('XAAPL-USDT');
    service.subscribe(new Set<AssetKey>(['stock:AAPL']), () => {});
    await service.__settleForTest();

    expect(records).toHaveLength(3);
    expect(records.every((r) => r.tier === 1)).toBe(true);
    expect(service.__desiredInstrumentsForTest().map((i) => i.instrumentId)).toEqual([
      'XAAPL-USDT',
    ]);
    expect(service.getSnapshot('stock:AAPL')!.sources).toEqual(['okx']);
  }

  it('REALTIME：只在 t=300 补验缺失的两家，不重复已 resolved 的 OKX', async () => {
    await subscribeWithOnlyOkx();
    expect(FakeSocket.openCount()).toBe(1);

    // 用 pong + 真实 ticker 保持连接与报价新鲜
    const socket = FakeSocket.live()[0];
    let mark = records.length;
    for (let t = 30; t < 300; t += 30) {
      await advanceTo(t);
      socket.push({
        arg: { channel: 'tickers', instId: 'XAAPL-USDT' },
        data: [{ instId: 'XAAPL-USDT', last: '300', open24h: '300', ts: String(Date.now()) }],
      });
    }
    expect(since(mark)).toHaveLength(0);

    live.add('RAAPLUSDT');
    mark = records.length;
    await advanceTo(300);

    const probed = since(mark);
    expect(probed).toHaveLength(2);
    expect(probed.map((r) => r.venue).sort()).toEqual(['binance', 'bitget']);
    expect(probed.every((r) => r.tier === 1)).toBe(true);

    expect(
      service
        .__desiredInstrumentsForTest()
        .map((i) => i.instrumentId)
        .sort(),
    ).toEqual(['RAAPLUSDT', 'XAAPL-USDT']);
    expect(service.getSnapshot('stock:AAPL')!.sources.slice().sort()).toEqual(['bitget', 'okx']);
    expect(FakeSocket.openCount()).toBe(2);
  });

  it('PASSIVE_VISIBLE：60 秒 tick 只刷 resolved，t=300 才补验缺失 candidate', async () => {
    focused = false;
    await subscribeWithOnlyOkx();
    expect(service.__transportModeForTest()).toBe('passive-visible');
    expect(FakeSocket.openCount()).toBe(0);

    for (const t of [60, 120, 180, 240]) {
      const mark = records.length;
      await advanceTo(t);
      const tick = since(mark);
      expect(tick, `t=${t}s`).toHaveLength(1);
      expect(tick[0].venue).toBe('okx');
    }

    live.add('RAAPLUSDT');
    const mark = records.length;
    await advanceTo(300);

    const round = since(mark);
    expect(round).toHaveLength(3);
    expect(round.filter((r) => r.venue === 'okx')).toHaveLength(1);
    expect(round.filter((r) => r.venue === 'bitget')).toHaveLength(1);
    expect(round.filter((r) => r.venue === 'binance')).toHaveLength(1);
    expect(round.every((r) => r.tier === 1)).toBe(true);

    expect(
      service
        .__desiredInstrumentsForTest()
        .map((i) => i.instrumentId)
        .sort(),
    ).toEqual(['RAAPLUSDT', 'XAAPL-USDT']);
    expect(service.getSnapshot('stock:AAPL')!.sources.slice().sort()).toEqual(['bitget', 'okx']);
    expect(FakeSocket.openCount()).toBe(0);

    focused = true;
    window.dispatchEvent(new Event('focus'));
    await service.__settleForTest();
    expect(FakeSocket.openCount()).toBe(2);
  });

  it('PASSIVE_HIDDEN：5 分钟 tick 上同时刷 resolved 与补验缺失 candidate', async () => {
    visibility = 'hidden';
    await subscribeWithOnlyOkx();
    expect(service.__transportModeForTest()).toBe('passive-hidden');
    expect(FakeSocket.openCount()).toBe(0);

    let mark = records.length;
    await advanceTo(299);
    expect(since(mark)).toHaveLength(0);

    live.add('RAAPLUSDT');
    mark = records.length;
    await advanceTo(300);

    const round = since(mark);
    expect(round).toHaveLength(3);
    expect(round.map((r) => r.venue).sort()).toEqual(['binance', 'bitget', 'okx']);
    expect(round.every((r) => r.tier === 1)).toBe(true);

    expect(
      service
        .__desiredInstrumentsForTest()
        .map((i) => i.instrumentId)
        .sort(),
    ).toEqual(['RAAPLUSDT', 'XAAPL-USDT']);
    expect(service.getSnapshot('stock:AAPL')!.sources.slice().sort()).toEqual(['bitget', 'okx']);
    expect(FakeSocket.openCount()).toBe(0);

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await service.__settleForTest();
    expect(FakeSocket.openCount()).toBe(2);
  });
});
