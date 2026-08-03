import { describe, it, expect } from 'vitest';
import {
  assetKeyFromSetting,
  assetKeyOf,
  assetKeySymbol,
  makeAssetKey,
  migrateAssetKey,
  parseAssetKey,
  venueSymbol,
} from './assetKey';
import { getCuratedAsset } from './assets';

describe('AssetKey 身份', () => {
  it('同 ticker 不同类别是两个独立资产', () => {
    const crypto = makeAssetKey('crypto', 'COIN');
    const stock = makeAssetKey('stock', 'COIN');
    expect(crypto).not.toBe(stock);
    const map = new Map([
      [crypto, 1],
      [stock, 2],
    ]);
    expect(map.size).toBe(2);
    expect(map.get(crypto)).toBe(1);
    expect(map.get(stock)).toBe(2);
  });

  it('stock 与 etf 同 ticker 不会被合并', () => {
    expect(makeAssetKey('stock', 'SPY')).not.toBe(makeAssetKey('etf', 'SPY'));
  });

  it('symbol 统一大写并可回解析', () => {
    const key = makeAssetKey('crypto', 'btc');
    expect(key).toBe('crypto:BTC');
    expect(parseAssetKey(key)).toEqual({ category: 'crypto', symbol: 'BTC' });
    expect(assetKeySymbol(key)).toBe('BTC');
  });

  it('非法 key 解析返回 null', () => {
    expect(parseAssetKey('BTC')).toBeNull();
    expect(parseAssetKey('unknown:BTC')).toBeNull();
    expect(parseAssetKey(':BTC')).toBeNull();
    expect(parseAssetKey('crypto:')).toBeNull();
  });
});

describe('canonical 迁移 —— Block SQ → XYZ', () => {
  it('stock:SQ 迁移成 stock:XYZ', () => {
    expect(migrateAssetKey('stock:SQ')).toBe('stock:XYZ');
  });

  it('迁移是幂等的', () => {
    expect(migrateAssetKey(migrateAssetKey('stock:SQ'))).toBe('stock:XYZ');
  });

  it('只迁移 Block 这一个资产，不做任意 SQ 字符串替换', () => {
    expect(migrateAssetKey('crypto:SQ')).toBe('crypto:SQ');
    expect(migrateAssetKey('crypto:SQD')).toBe('crypto:SQD');
    expect(migrateAssetKey('stock:SQSP')).toBe('stock:SQSP');
    expect(migrateAssetKey('stock:ESQ')).toBe('stock:ESQ');
  });

  it('curated 表里 SQ 已经换成 XYZ 且名称保留 Block', () => {
    expect(getCuratedAsset('stock:SQ')?.symbol).toBe('XYZ');
    expect(getCuratedAsset('stock:XYZ')?.name).toMatch(/^Block/);
    expect(getCuratedAsset('stock:XYZ')).toBe(getCuratedAsset('stock:SQ'));
  });
});

describe('venue symbol alias', () => {
  it('BRK.B 用显式 BRKB 别名', () => {
    expect(venueSymbol('stock:BRK.B')).toBe('BRKB');
  });

  it('不是通用地删除标点', () => {
    expect(venueSymbol('stock:BRK.A')).toBe('BRK.A');
    expect(venueSymbol('stock:XYZ')).toBe('XYZ');
    expect(venueSymbol('crypto:BTC')).toBe('BTC');
  });

  it('商品用逐条列举的期货 root symbol', () => {
    expect(venueSymbol('commodity:BRENT')).toBe('BZ');
    expect(venueSymbol('commodity:WTI')).toBe('CL');
    expect(venueSymbol('commodity:XAU')).toBe('XAU');
  });
});

describe('历史 Watchlist 设置迁移', () => {
  it('category + symbol 形式', () => {
    expect(assetKeyFromSetting({ category: 'stock', symbol: 'NVDA' })).toBe('stock:NVDA');
    expect(assetKeyFromSetting({ category: 'etf', symbol: 'SPY' })).toBe('etf:SPY');
  });

  it('更老的 baseAsset 形式默认按 crypto 处理', () => {
    expect(assetKeyFromSetting({ symbol: 'BTCUSDT', baseAsset: 'BTC' })).toBe('crypto:BTC');
  });

  it('旧的 stock:SQ 配置自动迁移到 stock:XYZ', () => {
    expect(assetKeyFromSetting({ category: 'stock', symbol: 'SQ' })).toBe('stock:XYZ');
    expect(assetKeyFromSetting({ assetKey: 'stock:SQ' })).toBe('stock:XYZ');
  });

  it('显式 assetKey 优先于 category + symbol', () => {
    expect(assetKeyFromSetting({ assetKey: 'etf:SPY', category: 'stock', symbol: 'NVDA' })).toBe(
      'etf:SPY',
    );
  });

  it('缺少 symbol 时返回 null', () => {
    expect(assetKeyFromSetting({ category: 'stock' })).toBeNull();
  });

  it('assetKeyOf 与 makeAssetKey 一致', () => {
    expect(assetKeyOf({ category: 'commodity', symbol: 'XAU' })).toBe('commodity:XAU');
  });
});
