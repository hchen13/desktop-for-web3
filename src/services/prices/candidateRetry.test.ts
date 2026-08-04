/**
 * 瞬时失败不得被永久负缓存，同层缺失的 venue 必须能补回来——但重试要严格限频。
 *
 * 这些场景肉眼看只是「一直没价」或「只有一家源」，只能靠确定性的请求序列覆盖。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PriceService, TIER_RECOVERY_PROBE_MS } from './PriceService';
import { exchangeCatalog } from './exchangeCatalog';
import { __setWebSocketFactoryForTest } from './socket';
import type { AssetKey } from './types';

const memoryStorage = () => (globalThis as any).__memoryStorage;

class SilentSocket {
  static instances: SilentSocket[] = [];
  readyState = 1;
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    SilentSocket.instances.push(this);
  }
  send(): void {}
  close(): void {
    this.closed = true;
    this.readyState = 3;
  }
  static openCount(): number {
    return SilentSocket.instances.filter((s) => !s.closed).length;
  }
}

let service: PriceService;
let urls: string[];

/** AAPL 的 Tier 1 是 3 个候选（3 次请求），Tier 2 是 3 个候选（Binance 永续 2 次，共 4 次） */
const TIER1_ROUND = 3;
const TIER2_ROUND = 4;

interface VenueState {
  okxSpot: boolean;
  bitgetSpot: boolean;
  binanceSpot: boolean;
  bitgetPerp: boolean;
}

function okxTicker(instId: string, price: string): Response {
  return new Response(
    JSON.stringify({
      code: '0',
      data: [
        { instId, last: price, open24h: price, ts: String(Date.now()), bidPx: price, askPx: price },
      ],
    }),
  );
}

function bitgetTicker(symbol: string, price: string): Response {
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

/** 只认 AAPL 的 candidate；每一家的可用性由 state 控制 */
function mockVenues(state: VenueState): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('instId=XAAPL-USDT')) {
      return state.okxSpot ? okxTicker('XAAPL-USDT', '300') : new Response('down', { status: 503 });
    }
    if (url.includes('symbol=RAAPLUSDT')) {
      return state.bitgetSpot
        ? bitgetTicker('RAAPLUSDT', '301')
        : new Response('down', { status: 503 });
    }
    if (url.includes('AAPLBUSDT')) {
      if (!state.binanceSpot) return new Response('down', { status: 503 });
      return new Response(
        JSON.stringify([
          {
            symbol: 'AAPLBUSDT',
            lastPrice: '302',
            priceChangePercent: '0',
            quoteVolume: '1000',
            closeTime: Date.now(),
            bidPrice: '302',
            askPrice: '302',
          },
        ]),
      );
    }
    if (url.includes('symbol=AAPLUSDT') && url.includes('USDT-FUTURES')) {
      return state.bitgetPerp
        ? bitgetTicker('AAPLUSDT', '305')
        : new Response('down', { status: 503 });
    }
    return new Response('down', { status: 503 });
  });
}

function since(mark: number): string[] {
  return urls.slice(mark);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  memoryStorage()?.__reset?.();
  exchangeCatalog.__resetForTest();
  SilentSocket.instances = [];
  __setWebSocketFactoryForTest((url) => new SilentSocket(url) as unknown as WebSocket);
  urls = [];
  service = new PriceService();
});

afterEach(() => {
  service.__resetForTest();
  exchangeCatalog.__resetForTest();
  __setWebSocketFactoryForTest(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('全部 candidate 首轮失败：retryable 而不是永久负缓存', () => {
  it('首轮之后不立即重试，5 分钟到达才重来一轮，网络恢复后能出价并建 WS', async () => {
    const state: VenueState = {
      okxSpot: false,
      bitgetSpot: false,
      binanceSpot: false,
      bitgetPerp: false,
    };
    mockVenues(state);

    service.subscribe(new Set<AssetKey>(['stock:AAPL']), () => {});
    await service.__settleForTest();

    // 首轮把两层的 candidate 都试过一遍，然后必须停下来
    expect(urls).toHaveLength(TIER1_ROUND + TIER2_ROUND);
    expect(service.getSnapshot('stock:AAPL')!.quality).toBe('unavailable');
    expect(SilentSocket.openCount()).toBe(0);

    // 5 分钟之前不得有任何重试
    let mark = urls.length;
    await vi.advanceTimersByTimeAsync(TIER_RECOVERY_PROBE_MS - 1000);
    await service.__settleForTest();
    expect(since(mark)).toHaveLength(0);

    // 到点只重来一轮
    await vi.advanceTimersByTimeAsync(1000);
    await service.__settleForTest();
    expect(since(mark)).toHaveLength(TIER1_ROUND + TIER2_ROUND);
    expect(service.getSnapshot('stock:AAPL')!.quality).toBe('unavailable');

    // 网络恢复：下一轮探测就能出价，并为验证通过的 instrument 建立 WS
    state.okxSpot = true;
    mark = urls.length;
    await vi.advanceTimersByTimeAsync(TIER_RECOVERY_PROBE_MS);
    await service.__settleForTest();

    expect(since(mark)).toHaveLength(TIER1_ROUND + TIER2_ROUND);
    expect(service.getSnapshot('stock:AAPL')!.price).toBe(300);
    expect(service.__desiredInstrumentsForTest().map((i) => i.instrumentId)).toEqual([
      'XAAPL-USDT',
    ]);
    expect(SilentSocket.openCount()).toBe(1);
  });

  it('OFF 之后既没有 retry timer 也没有请求', async () => {
    const state: VenueState = {
      okxSpot: false,
      bitgetSpot: false,
      binanceSpot: false,
      bitgetPerp: false,
    };
    mockVenues(state);

    const sub = service.subscribe(new Set<AssetKey>(['stock:AAPL']), () => {});
    await service.__settleForTest();
    expect(service.__recoveryTimerActiveForTest()).toBe(true);

    sub.setActive(false);
    await service.__settleForTest();
    const mark = urls.length;

    expect(service.__transportModeForTest()).toBe('off');
    expect(service.__recoveryTimerActiveForTest()).toBe(false);
    await vi.advanceTimersByTimeAsync(TIER_RECOVERY_PROBE_MS * 3);
    await service.__settleForTest();

    expect(since(mark)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('同层缺失的 venue 必须能补回来', () => {
  it('Tier 1 只有 OKX 首轮成功：缺失的两家不算已验证，恢复后才追加进 resolved / WS / 聚合', async () => {
    const state: VenueState = {
      okxSpot: true,
      bitgetSpot: false,
      binanceSpot: false,
      bitgetPerp: true,
    };
    mockVenues(state);

    service.subscribe(new Set<AssetKey>(['stock:AAPL']), () => {});
    await service.__settleForTest();

    // Tier 1 拿到了报价就不再往下探；未验证的两家绝不能进 resolved / WS
    expect(urls).toHaveLength(TIER1_ROUND);
    expect(service.__desiredInstrumentsForTest().map((i) => i.instrumentId)).toEqual([
      'XAAPL-USDT',
    ]);
    expect(service.getSnapshot('stock:AAPL')!.sources).toEqual(['okx']);

    // 5 分钟恢复探测只验证缺失的 candidate：不重复请求已 resolved 的 OKX，也不碰 Tier 2
    let mark = urls.length;
    await vi.advanceTimersByTimeAsync(TIER_RECOVERY_PROBE_MS);
    await service.__settleForTest();

    const probed = since(mark);
    expect(probed.some((u) => u.includes('RAAPLUSDT'))).toBe(true);
    expect(probed.some((u) => u.includes('AAPLBUSDT'))).toBe(true);
    expect(probed.some((u) => u.includes('XAAPL-USDT'))).toBe(false);
    expect(probed.some((u) => u.includes('USDT-FUTURES'))).toBe(false);
    expect(probed.some((u) => u.includes('AAPL-USDT-SWAP'))).toBe(false);

    // Bitget 恢复：下一轮探测把它追加进 resolved 与 WS desired set
    state.bitgetSpot = true;
    mark = urls.length;
    await vi.advanceTimersByTimeAsync(TIER_RECOVERY_PROBE_MS);
    await service.__settleForTest();

    expect(
      service
        .__desiredInstrumentsForTest()
        .map((i) => i.instrumentId)
        .sort(),
    ).toEqual(['RAAPLUSDT', 'XAAPL-USDT']);

    // 补回来的 venue 要真的参与同层聚合
    await service.refreshAssets(new Set<AssetKey>(['stock:AAPL']));
    const snapshot = service.getSnapshot('stock:AAPL')!;
    expect(snapshot.sources.slice().sort()).toEqual(['bitget', 'okx']);
    expect(snapshot.sourceCount).toBe(2);
  });

  it('恢复探测在飞时资产被移除：成功报价也不得写状态或复活 timer', async () => {
    const state: VenueState = {
      okxSpot: true,
      bitgetSpot: false,
      binanceSpot: false,
      bitgetPerp: true,
    };
    mockVenues(state);

    const sub = service.subscribe(new Set<AssetKey>(['stock:AAPL']), () => {});
    await service.__settleForTest();
    const snapshotBefore = service.getSnapshot('stock:AAPL')!.price;

    // 让恢复探测发出去并卡住，而且这次它会成功
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    state.bitgetSpot = true;
    const inner = globalThis.fetch as unknown as typeof fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('RAAPLUSDT')) await gate;
      return inner(input, init);
    });

    await vi.advanceTimersByTimeAsync(TIER_RECOVERY_PROBE_MS);
    expect(urls.some((u) => u.includes('RAAPLUSDT'))).toBe(true);

    sub.unsubscribe();
    await service.__settleForTest();
    expect(service.__transportModeForTest()).toBe('off');

    release();
    await service.__settleForTest();
    const mark = urls.length;
    await vi.advanceTimersByTimeAsync(TIER_RECOVERY_PROBE_MS * 2);
    await service.__settleForTest();

    expect(service.__recoveryTimerActiveForTest()).toBe(false);
    expect(since(mark)).toHaveLength(0);
    expect(service.__desiredInstrumentsForTest()).toEqual([]);
    expect(service.__connectionCountForTest()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    // 验证成功的 candidate 也不得被写进 catalog 缓存或改写快照
    expect(exchangeCatalog.instrumentsFor('stock:AAPL').map((i) => i.instrumentId)).not.toContain(
      'RAAPLUSDT',
    );
    expect(service.getSnapshot('stock:AAPL')!.price).toBe(snapshotBefore);
  });
});

describe('结构性无候选的资产稳定 unavailable', () => {
  it('crypto:USDT 不产生 candidate、不产生 retry timer、不请求任何 BTC 交易对', async () => {
    mockVenues({ okxSpot: true, bitgetSpot: true, binanceSpot: true, bitgetPerp: true });

    service.subscribe(new Set<AssetKey>(['crypto:USDT']), () => {});
    await service.__settleForTest();

    expect(urls).toHaveLength(0);
    expect(service.__recoveryTimerActiveForTest()).toBe(false);
    expect(service.getSnapshot('crypto:USDT')!.quality).toBe('unavailable');

    await vi.advanceTimersByTimeAsync(TIER_RECOVERY_PROBE_MS * 4);
    await service.__settleForTest();

    expect(urls).toHaveLength(0);
    expect(urls.some((u) => u.includes('BTC'))).toBe(false);
    expect(service.__connectionCountForTest()).toBe(0);
    expect(service.getSnapshot('crypto:USDT')!.quality).toBe('unavailable');
  });
});
