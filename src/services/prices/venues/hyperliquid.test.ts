import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildHyperliquidInstruments,
  fetchHyperliquidRawCatalog,
  isTrustedPerpDex,
  normalizeHyperliquidCtx,
  normalizeHyperliquidL2Book,
  stripDexPrefix,
  TRUSTED_PERP_DEXS,
  type HyperliquidRawCatalog,
} from './hyperliquid';
import { makeInstrument, type CatalogContext } from './shared';

const TRUSTED_DEPLOYER = TRUSTED_PERP_DEXS[0].expectedDeployer;

const ctx = (symbols: string[] = []): CatalogContext => ({
  confirmedEquitySymbols: new Set(symbols),
});

function raw(universe: Array<{ name?: string; isDelisted?: boolean }>): HyperliquidRawCatalog {
  return { dexes: [{ name: 'xyz', universe }] };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('trusted perp DEX allowlist', () => {
  it('name 与 deployer 都匹配才算 trusted', () => {
    expect(isTrustedPerpDex({ name: 'xyz', deployer: TRUSTED_DEPLOYER })).toBe(true);
    expect(isTrustedPerpDex({ name: 'XYZ', deployer: TRUSTED_DEPLOYER.toUpperCase() })).toBe(true);
  });

  it('deployer 不符的同名 DEX 被拒绝', () => {
    expect(isTrustedPerpDex({ name: 'xyz', deployer: '0xdeadbeef' })).toBe(false);
  });

  it('不在 allowlist 的 DEX 被拒绝', () => {
    expect(isTrustedPerpDex({ name: 'flx', deployer: TRUSTED_DEPLOYER })).toBe(false);
    expect(isTrustedPerpDex(null)).toBe(false);
    expect(isTrustedPerpDex({ name: 'xyz' })).toBe(false);
  });
});

describe('HIP-3 instrument 解析', () => {
  it('保留完整 instrument name 作为 instrumentId', () => {
    const out = buildHyperliquidInstruments(raw([{ name: 'xyz:AAPL' }]), ctx(['AAPL']));
    expect(out[0]).toMatchObject({
      instrumentId: 'xyz:AAPL',
      assetKey: 'stock:AAPL',
      productKind: 'hip3_perp',
      preferredPriceKind: 'oracle',
      quote: 'USDC',
    });
  });

  it('指数 / 宏观合约不会被当成股票或 ETF', () => {
    const out = buildHyperliquidInstruments(
      raw([
        { name: 'xyz:SP500' },
        { name: 'xyz:USTECH' },
        { name: 'xyz:GOLD' },
        { name: 'xyz:SILVER' },
        { name: 'xyz:EUR' },
        { name: 'xyz:XYZ100' },
        { name: 'xyz:SMALL2000' },
      ]),
      ctx(['AAPL', 'NVDA']),
    );
    expect(out).toHaveLength(0);
  });

  it('isDelisted 的 instrument 被排除', () => {
    const out = buildHyperliquidInstruments(
      raw([{ name: 'xyz:AAPL', isDelisted: true }]),
      ctx(['AAPL']),
    );
    expect(out).toHaveLength(0);
  });

  it('前缀不匹配的名字不参与', () => {
    expect(stripDexPrefix('xyz', 'flx:AAPL')).toBeNull();
    expect(stripDexPrefix('xyz', 'AAPL')).toBeNull();
    expect(stripDexPrefix('xyz', 'xyz:AAPL')).toBe('AAPL');
  });

  it('catalog 只请求 perpDexs 与 meta，从不碰 permissionless spot token', async () => {
    const urls: string[] = [];
    const bodies: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      urls.push(String(input));
      bodies.push(String((init as RequestInit)?.body ?? ''));
      const body = JSON.parse(String((init as RequestInit)?.body ?? '{}'));
      if (body.type === 'perpDexs') {
        return new Response(
          JSON.stringify([
            null,
            { name: 'xyz', deployer: TRUSTED_DEPLOYER },
            { name: 'flx', deployer: '0xabc' },
          ]),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ universe: [{ name: 'xyz:AAPL' }] }), { status: 200 });
    });

    const catalog = await fetchHyperliquidRawCatalog();
    expect(catalog.dexes).toHaveLength(1);
    expect(catalog.dexes[0].universe[0].name).toBe('xyz:AAPL');
    expect(bodies.some((b) => b.includes('spotMeta'))).toBe(false);
    expect(bodies.filter((b) => b.includes('"type":"meta"'))).toHaveLength(1);
  });
});

describe('HIP-3 报价', () => {
  const instrument = makeInstrument({
    venue: 'hyperliquid',
    instrumentId: 'xyz:AAPL',
    symbol: 'AAPL',
    base: 'AAPL',
    quote: 'USDC',
    category: 'stock',
    productKind: 'hip3_perp',
    preferredPriceKind: 'oracle',
  });

  it('默认使用 oraclePx，24h 变化由 prevDayPx 推出', () => {
    const quote = normalizeHyperliquidCtx(
      instrument,
      {
        oraclePx: '308.87',
        markPx: '308.95',
        midPx: '308.975',
        prevDayPx: '309.69',
        dayNtlVlm: '13125421.78',
      },
      1785739288000,
    );
    expect(quote).toMatchObject({
      priceKind: 'oracle',
      price: 308.87,
      quoteCurrency: 'USDC',
      productKind: 'hip3_perp',
    });
    expect(quote!.change24h).toBeCloseTo((308.87 / 309.69 - 1) * 100, 6);
  });

  it('缺 oraclePx 时依次退到 markPx / midPx', () => {
    expect(normalizeHyperliquidCtx(instrument, { markPx: '10', midPx: '11' })).toMatchObject({
      priceKind: 'mark',
      price: 10,
    });
    expect(normalizeHyperliquidCtx(instrument, { midPx: '11' })).toMatchObject({
      priceKind: 'mid',
      price: 11,
    });
    expect(normalizeHyperliquidCtx(instrument, {})).toBeNull();
  });

  it('l2Book 只给 mid 报价', () => {
    const quote = normalizeHyperliquidL2Book(instrument, {
      coin: 'xyz:AAPL',
      time: 1785738697071,
      levels: [[{ px: '308.89' }], [{ px: '308.91' }]],
    });
    expect(quote).toMatchObject({ priceKind: 'mid' });
    expect(quote!.price).toBeCloseTo(308.9, 6);
  });

  it('盘口缺失时返回 null', () => {
    expect(normalizeHyperliquidL2Book(instrument, { levels: [[], []] })).toBeNull();
  });

  it('REST 与 WS 两条路径用同一个时钟域，避免单调性把其中一路丢掉', () => {
    // activeAssetCtx 不带服务端时间戳，所以 l2Book 也不能用 book.time，
    // 否则本地时钟与 HL 服务端时钟之间的偏差会让 QuoteStore 静默拒收其中一路
    const before = Date.now();
    const rest = normalizeHyperliquidL2Book(instrument, {
      coin: 'xyz:AAPL',
      time: 1,
      levels: [[{ px: '100' }], [{ px: '102' }]],
    })!;
    const after = Date.now();

    expect(rest.sourceTimestamp).toBeGreaterThanOrEqual(before);
    expect(rest.sourceTimestamp).toBeLessThanOrEqual(after);
    expect(rest.sourceTimestamp).toBe(rest.receivedAt);

    const ws = normalizeHyperliquidCtx(instrument, { oraclePx: '101' })!;
    expect(ws.sourceTimestamp).toBeGreaterThanOrEqual(rest.sourceTimestamp);
  });
});
