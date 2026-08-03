import { describe, it, expect, afterEach } from 'vitest';
import { candidateInstruments, instrumentTier } from './instrumentResolver';
import { exchangeCatalog } from './exchangeCatalog';
import { makeInstrument } from './venues/shared';

afterEach(() => {
  exchangeCatalog.__resetForTest();
});

function idsFor(assetKey: string, tier: 1 | 2 | 3) {
  return candidateInstruments(assetKey, tier).map((i) => `${i.venue}:${i.instrumentId}`);
}

describe('冷启动 candidate 生成', () => {
  it('crypto 用 curated cexPair', () => {
    expect(idsFor('crypto:BTC', 1)).toEqual(['okx:BTC-USDT', 'bitget:BTCUSDT', 'binance:BTCUSDT']);
  });

  it('股票 / ETF 的 Tier 1 是三家 tokenized spot', () => {
    expect(idsFor('stock:NVDA', 1)).toEqual([
      'okx:XNVDA-USDT',
      'bitget:RNVDAUSDT',
      'binance:NVDABUSDT',
    ]);
    expect(idsFor('etf:SPY', 1)).toEqual(['okx:XSPY-USDT', 'bitget:RSPYUSDT', 'binance:SPYBUSDT']);
  });

  it('Block 迁移后按 XYZ 生成，Bitget 命中 RXYZUSDT', () => {
    expect(idsFor('stock:XYZ', 1)).toContain('bitget:RXYZUSDT');
    // 旧的 stock:SQ 也会先迁移再生成
    expect(idsFor('stock:SQ', 1)).toContain('bitget:RXYZUSDT');
    expect(candidateInstruments('stock:SQ', 1)[0].assetKey).toBe('stock:XYZ');
  });

  it('BRK.B 用显式 BRKB alias，且只出现在衍生品层', () => {
    expect(idsFor('stock:BRK.B', 1)).toEqual([
      'okx:XBRKB-USDT',
      'bitget:RBRKBUSDT',
      'binance:BRKBBUSDT',
    ]);
    expect(idsFor('stock:BRK.B', 2)).toEqual([
      'okx:BRKB-USDT-SWAP',
      'bitget:BRKBUSDT',
      'binance:BRKBUSDT',
    ]);
    expect(candidateInstruments('stock:BRK.B', 2)[0]).toMatchObject({
      assetKey: 'stock:BRK.B',
      symbol: 'BRK.B',
      productKind: 'equity_perp',
    });
  });

  it('商品只在衍生品层生成，且用逐条列举的 root symbol', () => {
    expect(idsFor('commodity:XAU', 2)).toEqual(['bitget:XAUUSDT', 'binance:XAUUSDT']);
    expect(idsFor('commodity:BRENT', 2)).toEqual(['bitget:BZUSDT', 'binance:BZUSDT']);
    expect(idsFor('commodity:XAU', 1)).toEqual([]);
  });

  it('FX 没有经过 metadata 验证的公开产品，不生成任何 candidate', () => {
    expect(candidateInstruments('fx:EURUSD', 1)).toEqual([]);
    expect(candidateInstruments('fx:EURUSD', 2)).toEqual([]);
    expect(candidateInstruments('fx:USDJPY', 3)).toEqual([]);
  });

  it('非 curated 资产不生成 candidate（必须靠 catalog）', () => {
    expect(candidateInstruments('stock:LLY', 1)).toEqual([]);
    expect(candidateInstruments('crypto:NOTACOIN', 1)).toEqual([]);
  });

  it('FBTC / XLF 的 candidate 完全由 canonical 推导，不会退化成代理标的', () => {
    expect(idsFor('etf:FBTC', 1)).toEqual([
      'okx:XFBTC-USDT',
      'bitget:RFBTCUSDT',
      'binance:FBTCBUSDT',
    ]);
    expect(idsFor('etf:XLF', 1)).toEqual(['okx:XXLF-USDT', 'bitget:RXLFUSDT', 'binance:XLFBUSDT']);
    for (const key of ['etf:FBTC', 'etf:XLF']) {
      for (const tier of [1, 2] as const) {
        for (const c of candidateInstruments(key, tier)) {
          expect(c.assetKey).toBe(key);
        }
      }
    }
  });
});

describe('来源分层', () => {
  const inst = (productKind: Parameters<typeof makeInstrument>[0]['productKind']) =>
    makeInstrument({
      venue: 'okx',
      instrumentId: 'X',
      symbol: 'X',
      base: 'X',
      quote: 'USDT',
      category: 'stock',
      productKind,
      preferredPriceKind: 'last',
    });

  it('现货是 Tier 1，CEX 衍生品是 Tier 2，HIP-3 是 Tier 3', () => {
    expect(instrumentTier(inst('crypto_spot'))).toBe(1);
    expect(instrumentTier(inst('tokenized_stock_spot'))).toBe(1);
    expect(instrumentTier(inst('equity_perp'))).toBe(2);
    expect(instrumentTier(inst('commodity_perp'))).toBe(2);
    expect(instrumentTier(inst('fx_perp'))).toBe(2);
    expect(instrumentTier(inst('hip3_perp'))).toBe(3);
  });
});
