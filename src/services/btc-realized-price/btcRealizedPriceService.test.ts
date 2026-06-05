import { describe, expect, it } from 'vitest';
import { parseBtcRealizedPricePayload } from './btcRealizedPriceService';

describe('parseBtcRealizedPricePayload', () => {
  it('selects latest point and calculates 24h change', () => {
    const snapshot = parseBtcRealizedPricePayload(
      [
        { d: '2026-06-03', unixTs: 1780444800, realizedPrice: 53200 },
        { d: '2026-06-04', unixTs: 1780531200, realizedPrice: 53271.76 },
      ],
      1780640000000,
    );

    expect(snapshot.realizedPrice).toBe(53271.76);
    expect(snapshot.latestDate).toBe('2026-06-04');
    expect(snapshot.previousDate).toBe('2026-06-03');
    expect(snapshot.change24hPct).toBeCloseTo(0.134887, 6);
    expect(snapshot.stale).toBe(false);
  });

  it('supports payloads wrapped in data', () => {
    const snapshot = parseBtcRealizedPricePayload({
      data: [['ignored'], { date: '2026-06-04', timestamp: 1780531200, value: '53271.76' }],
    });

    expect(snapshot.realizedPrice).toBe(53271.76);
    expect(snapshot.change24hPct).toBeNull();
  });

  it('throws when no valid realized price point exists', () => {
    expect(() => parseBtcRealizedPricePayload([{ d: '2026-06-04' }])).toThrow(
      'No realized price data',
    );
  });
});
