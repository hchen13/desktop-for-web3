import { afterEach, describe, expect, it, vi } from 'vitest';

describe('chain monitor rpcClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses Esplora tip height/hash endpoints for BTC latest block', async () => {
    const now = Math.floor(Date.now() / 1000);
    const requestedUrls: string[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      requestedUrls.push(url);

      if (url.endsWith('/blocks/tip/height')) {
        return new Response('100', { status: 200 });
      }
      if (url.endsWith('/block-height/100')) {
        return new Response('000000-test-hash', { status: 200 });
      }
      if (url.endsWith('/block/000000-test-hash')) {
        return new Response(JSON.stringify({ height: 100, timestamp: now - 90, tx_count: 10 }), {
          status: 200,
        });
      }

      return new Response('{}', { status: 404 });
    });

    const { getBlockTimeDelayRPC } = await import('./rpcClient');
    const block = await getBlockTimeDelayRPC('btc');

    expect(block.blockNumber).toBe(100);
    expect(block.delaySeconds).toBeGreaterThanOrEqual(0);
    expect(requestedUrls).toContain('https://blockstream.info/api/blocks/tip/height');
    expect(requestedUrls).not.toContain('https://blockstream.info/api/blocks/tip');
  });
});
