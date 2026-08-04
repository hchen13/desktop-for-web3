/**
 * Tier fallback / 恢复 / 陈旧 instrument 拒绝 的行为测试
 *
 * 这些都是「看起来有价、其实是错价或死价」的场景，必须由真实的多轮请求序列覆盖。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PriceService, TIER_RECOVERY_PROBE_MS } from './PriceService';
import { exchangeCatalog, EXCHANGE_CATALOG_STORAGE_KEY } from './exchangeCatalog';
import { __setWebSocketFactoryForTest } from './socket';
import { candidateInstruments } from './instrumentResolver';
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

function tokenizedSpot(venue: VenueInstrument['venue'], id: string, symbol: string) {
  return makeInstrument({
    venue,
    instrumentId: id,
    symbol,
    base: symbol,
    quote: 'USDT',
    category: 'stock',
    productKind: 'tokenized_stock_spot',
    preferredPriceKind: 'last',
  });
}

function equityPerp(venue: VenueInstrument['venue'], id: string, symbol: string) {
  return makeInstrument({
    venue,
    instrumentId: id,
    symbol,
    base: symbol,
    quote: 'USDT',
    category: 'stock',
    productKind: 'equity_perp',
    preferredPriceKind: 'index',
  });
}

async function seedCatalog(instruments: VenueInstrument[]): Promise<void> {
  const now = Date.now();
  await chrome.storage.local.set({
    [EXCHANGE_CATALOG_STORAGE_KEY]: {
      version: 'v2',
      venueTimestamps: { okx: now, bitget: now, binance: now, hyperliquid: now },
      instruments,
    },
  });
}

let service: PriceService;

beforeEach(() => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  memoryStorage()?.__reset?.();
  exchangeCatalog.__resetForTest();
  __setWebSocketFactoryForTest((url) => new SilentSocket(url) as unknown as WebSocket);
  service = new PriceService();
});

afterEach(() => {
  service.__resetForTest();
  exchangeCatalog.__resetForTest();
  __setWebSocketFactoryForTest(null);
  vi.restoreAllMocks();
});

describe('USDT 不能解析成 BTC', () => {
  it('crypto:USDT 不产生任何 candidate', () => {
    expect(candidateInstruments('crypto:USDT', 1)).toEqual([]);
    expect(candidateInstruments('crypto:USDT', 2)).toEqual([]);
  });

  it('curated 表里的 USDT 没有 cexPair，不会借用别的交易对', async () => {
    const { getCuratedAsset } = await import('./assets');
    expect(getCuratedAsset('crypto:USDT')?.cexPair).toBeUndefined();
  });

  it('订阅 USDT 时既不请求 BTC 交易对，快照也不会变成 BTC 价格', async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      urls.push(String(input));
      return new Response('not found', { status: 404 });
    });

    service.subscribe(new Set<AssetKey>(['crypto:USDT']), () => {});
    await service.__settleForTest();

    expect(urls.some((u) => u.includes('BTC'))).toBe(false);
    const snap = service.getSnapshot('crypto:USDT')!;
    expect(snap.quality).toBe('unavailable');
    expect(snap.sourceCount).toBe(0);
  });

  it('USDC 仍然使用真实存在的 USDC-USDT 对', () => {
    const ids = candidateInstruments('crypto:USDC', 1).map((i) => `${i.venue}:${i.instrumentId}`);
    expect(ids).toEqual(['okx:USDC-USDT', 'bitget:USDCUSDT', 'binance:USDCUSDT']);
  });
});

describe('陈旧 / 不可交易 instrument 必须被拒绝', () => {
  const staleClose = () => Date.now() - 30 * 24 * 3600 * 1000;

  it('HTTP 200 + lastPrice>0 但盘口为 0 时不接受，继续 fallback 到下一层', async () => {
    await seedCatalog([
      tokenizedSpot('binance', 'DEADBUSDT', 'DEAD'),
      equityPerp('bitget', 'DEADUSDT', 'DEAD'),
    ]);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('binance.vision')) {
        // 已退市的 symbol：仍然返回 200 和旧的 lastPrice，但盘口归零
        return new Response(
          JSON.stringify([
            {
              symbol: 'DEADBUSDT',
              lastPrice: '999',
              priceChangePercent: '0',
              quoteVolume: '0',
              closeTime: staleClose(),
              bidPrice: '0',
              askPrice: '0',
            },
          ]),
        );
      }
      if (url.includes('bitget.com')) {
        return new Response(
          JSON.stringify({
            code: '00000',
            data: [
              {
                symbol: 'DEADUSDT',
                lastPrice: '50',
                indexPrice: '50',
                price24hPcnt: '0',
                ts: String(Date.now()),
                bid1Price: '49.9',
                ask1Price: '50.1',
              },
            ],
          }),
        );
      }
      return new Response('not found', { status: 404 });
    });

    service.subscribe(new Set<AssetKey>(['stock:DEAD']), () => {});
    await service.__settleForTest();

    const snap = service.getSnapshot('stock:DEAD')!;
    expect(snap.price).toBe(50);
    expect(snap.sources).toEqual(['bitget']);
    expect(snap.coverageTier).toBe('derivative-reference');
  });

  it('行情时间戳过旧的 instrument 不算 live', async () => {
    await seedCatalog([tokenizedSpot('binance', 'OLDBUSDT', 'OLD')]);
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify([
            {
              symbol: 'OLDBUSDT',
              lastPrice: '123',
              priceChangePercent: '0',
              quoteVolume: '1',
              closeTime: staleClose(),
              bidPrice: '122',
              askPrice: '124',
            },
          ]),
        ),
    );

    service.subscribe(new Set<AssetKey>(['stock:OLD']), () => {});
    await service.__settleForTest();

    const snap = service.getSnapshot('stock:OLD');
    expect(snap?.quality).not.toBe('live');
  });
});

describe('Tier 1 → Tier 2 → Tier 1 恢复的完整序列', () => {
  it('Tier 1 失效当轮下沉 Tier 2，恢复探测让它自动升回 Tier 1', async () => {
    vi.useFakeTimers();
    await seedCatalog([
      tokenizedSpot('okx', 'XAAPL-USDT', 'AAPL'),
      equityPerp('bitget', 'AAPLUSDT', 'AAPL'),
    ]);

    let tier1Up = true;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('okx.com')) {
        if (!tier1Up) return new Response('service unavailable', { status: 503 });
        return new Response(
          JSON.stringify({
            code: '0',
            data: [
              {
                instId: 'XAAPL-USDT',
                last: '300',
                open24h: '299',
                ts: String(Date.now()),
                bidPx: '299.9',
                askPx: '300.1',
              },
            ],
          }),
        );
      }
      if (url.includes('bitget.com')) {
        return new Response(
          JSON.stringify({
            code: '00000',
            data: [
              {
                symbol: 'AAPLUSDT',
                lastPrice: '305',
                indexPrice: '305',
                price24hPcnt: '0',
                ts: String(Date.now()),
                bid1Price: '304.9',
                ask1Price: '305.1',
              },
            ],
          }),
        );
      }
      return new Response('not found', { status: 404 });
    });

    service.subscribe(new Set<AssetKey>(['stock:AAPL']), () => {});
    await service.__settleForTest();

    // ① Tier 1 正常
    expect(service.getSnapshot('stock:AAPL')!.price).toBe(300);
    expect(service.getSnapshot('stock:AAPL')!.coverageTier).toBe('single-source');
    expect(service.__desiredInstrumentsForTest().map((i) => i.instrumentId)).toEqual([
      'XAAPL-USDT',
    ]);

    // ② Tier 1 挂掉 → 同一轮就要下沉到 Tier 2
    tier1Up = false;
    await service.refreshAssets(new Set<AssetKey>(['stock:AAPL']));
    expect(service.getSnapshot('stock:AAPL')!.price).toBe(305);
    expect(service.getSnapshot('stock:AAPL')!.coverageTier).toBe('derivative-reference');
    expect(service.__desiredInstrumentsForTest().map((i) => i.instrumentId)).toEqual(['AAPLUSDT']);

    // ③ Tier 1 恢复：不需要用户删掉再加回来，恢复探测会自己升回去
    tier1Up = true;
    await vi.advanceTimersByTimeAsync(TIER_RECOVERY_PROBE_MS + 10);
    await service.__settleForTest();

    expect(service.getSnapshot('stock:AAPL')!.price).toBe(300);
    expect(service.getSnapshot('stock:AAPL')!.coverageTier).toBe('single-source');
    expect(service.__desiredInstrumentsForTest().map((i) => i.instrumentId)).toEqual([
      'XAAPL-USDT',
    ]);
    vi.useRealTimers();
  });
});
