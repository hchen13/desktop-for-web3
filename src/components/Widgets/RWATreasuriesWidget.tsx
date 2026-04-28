/**
 * RWATreasuries Widget — 代币化美债面板
 *
 * 数据源：复用 stablecoinsService 的 DefiLlama Stablecoins 数据
 *   - 通过 ISSUER_SYMBOLS 列表筛选 RWA 代币化美债 stablecoin
 *
 * UI（2×2）：
 *   - 顶部：总 AUM + 24h 增量箭头
 *   - 中部：水平条形图（每条 = 一个 issuer，长度按 mcap 比例）
 *   - 每条目右侧标注金额 + 24h 变化百分比
 */
import { Show, onMount, onCleanup, createSignal, createMemo, For } from 'solid-js';
import { stablecoinsService } from '../../services/defillama/stablecoinsService';
import type { StablecoinAsset, StablecoinsState } from '../../services/defillama/types';
import { formatLargeNumber, formatNumber } from '../../utils/formatters';
import type { WidgetState } from '../../config/widgetDefaults';
import './RWATreasuriesWidget.css';

interface RWATreasuriesWidgetProps {
  elementId?: string;
  state?: WidgetState;
  onStateChange?: (newState: WidgetState) => void;
}

/**
 * 视为 tokenized treasuries 的 stablecoin symbol 列表（大写匹配）
 * - USYC: Hashnote/Circle
 * - BUIDL: BlackRock/Securitize
 * - USDY: Ondo
 * - OUSG: Ondo
 * - BENJI: Franklin Templeton
 * - USDtb: Ethena (treasuries-backed)
 *
 * 注意：DefiLlama 的 symbol 大小写不固定（如 USDtb），但服务层已 toUpperCase()
 */
const ISSUER_SYMBOLS = ['USYC', 'BUIDL', 'USDY', 'OUSG', 'BENJI', 'USDTB'];

/** 统一展示名称映射 */
const SYMBOL_LABELS: Record<string, string> = {
  USYC: 'USYC',
  BUIDL: 'BUIDL',
  USDY: 'USDY',
  OUSG: 'OUSG',
  BENJI: 'BENJI',
  USDTB: 'USDtb',
};

/** 每个 issuer 的简介（hover 显示） */
const ISSUER_DESCRIPTIONS: Record<string, string> = {
  USYC: 'USYC · Circle (前 Hashnote) — 短期美债代币化货币市场基金，2026 年市占率第一',
  BUIDL: 'BUIDL · BlackRock × Securitize — 机构旗舰代币化国库基金，已上 9 条链',
  USDY: 'USDY · Ondo Finance — 面向非美用户的生息美债稳定币',
  OUSG: 'OUSG · Ondo Finance — 机构短期美债代币（对接 BUIDL）',
  BENJI: 'BENJI · Franklin Templeton — OnChain U.S. Government Money Fund (FOBXX)',
  USDTB: 'USDtb · Ethena — 国库券抵押的稳定币（与 USDe 区分）',
};

/** 每个 issuer 的官方信息页 URL（点击行跳转） */
const ISSUER_URLS: Record<string, string> = {
  USYC: 'https://www.circle.com/usyc',
  BUIDL:
    'https://securitize.io/learn/press/blackrock-launches-first-tokenized-fund-on-a-public-blockchain',
  USDY: 'https://ondo.finance/usdy',
  OUSG: 'https://ondo.finance/ousg',
  BENJI:
    'https://www.franklintempleton.com/investments/options/money-market-funds/products/29386/SINGLCLASS/franklin-on-chain-u-s-government-money-fund/FOBXX',
  USDTB: 'https://www.ethena.fi/usdtb',
};

const WIDGET_TOOLTIP =
  '代币化美国国库券（Tokenized U.S. Treasury Bills）— 合规机构发行的链上美债资产，按链上流通量排序。' +
  '\n数据源：DefiLlama Stablecoins API（peggedUSD-RWA 类）。';

function formatUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '$0';
  const f = formatLargeNumber(amount);
  return `$${f.value}${f.unit}`;
}

function formatPct(p: number | null): string {
  if (p == null || !Number.isFinite(p)) return '—';
  const sign = p > 0 ? '+' : '';
  return `${sign}${formatNumber(p, 2)}%`;
}

export const RWATreasuriesWidget = (_props: RWATreasuriesWidgetProps) => {
  const [serviceState, setServiceState] = createSignal<StablecoinsState>(
    stablecoinsService.getData(),
  );

  onMount(() => {
    const unsub = stablecoinsService.subscribe((s) => setServiceState(s));
    void stablecoinsService.refresh();

    onCleanup(() => {
      unsub();
    });
  });

  // 提取 RWA assets 子集（按 ISSUER_SYMBOLS 顺序匹配）
  const rwaAssets = createMemo<StablecoinAsset[]>(() => {
    const list = serviceState().assets;
    if (list.length === 0) return [];
    const out: StablecoinAsset[] = [];
    for (const sym of ISSUER_SYMBOLS) {
      const found = list.find((a) => a.symbol === sym);
      if (found) out.push(found);
    }
    // 按 mcap 倒序展示，更清晰
    return out.sort((a, b) => b.mcap - a.mcap);
  });

  const totalAum = createMemo(() => rwaAssets().reduce((acc, a) => acc + (a.mcap || 0), 0));
  const totalAumPrev = createMemo(() => {
    return rwaAssets().reduce((acc, a) => acc + (a.mcapPrev ?? 0), 0);
  });

  const aumChangePct = createMemo<number | null>(() => {
    const prev = totalAumPrev();
    const cur = totalAum();
    if (!prev || prev <= 0 || !Number.isFinite(cur)) return null;
    return ((cur - prev) / prev) * 100;
  });

  // 单条 bar 宽度比例（最大值为 100%）
  const maxMcap = createMemo(() => {
    const list = rwaAssets();
    if (list.length === 0) return 0;
    return Math.max(...list.map((a) => a.mcap));
  });

  const isInitialLoading = createMemo(() => {
    const s = serviceState();
    return s.status === 'loading' && s.assets.length === 0;
  });
  const hasData = createMemo(() => rwaAssets().length > 0);
  const isError = createMemo(() => serviceState().status === 'error' && !hasData());

  return (
    <div class="rwa-treasuries-widget" title={WIDGET_TOOLTIP}>
      <header class="rwa-treasuries-widget__header">
        <div class="rwa-treasuries-widget__title-block">
          <span class="rwa-treasuries-widget__title">Tokenized T-Bills</span>
          <span class="rwa-treasuries-widget__aum">{formatUsd(totalAum())}</span>
        </div>
        <div class="rwa-treasuries-widget__aum-meta">
          <Show when={aumChangePct() != null} fallback={<span>24h —</span>}>
            <span
              classList={{
                'rwa-treasuries-widget__aum-arrow--up': (aumChangePct() ?? 0) >= 0,
                'rwa-treasuries-widget__aum-arrow--down': (aumChangePct() ?? 0) < 0,
              }}
            >
              {(aumChangePct() ?? 0) >= 0 ? '▲' : '▼'} {formatPct(aumChangePct())}
            </span>
          </Show>
        </div>
      </header>

      <Show when={isInitialLoading()}>
        <div class="rwa-treasuries-widget__loading">Loading…</div>
      </Show>

      <Show when={!isInitialLoading() && isError()}>
        <div class="rwa-treasuries-widget__error">数据加载失败 · 重试中</div>
      </Show>

      <Show when={!isInitialLoading() && !isError() && !hasData()}>
        <div class="rwa-treasuries-widget__loading">No issuers tracked</div>
      </Show>

      <Show when={hasData()}>
        <div class="rwa-treasuries-widget__body">
          <For each={rwaAssets()}>
            {(asset) => {
              const max = maxMcap();
              const widthPct = max > 0 ? (asset.mcap / max) * 100 : 0;
              const label = SYMBOL_LABELS[asset.symbol] || asset.symbol;
              const change = asset.change24h;
              const tooltip = ISSUER_DESCRIPTIONS[asset.symbol] || asset.name;
              const url = ISSUER_URLS[asset.symbol];
              // mousedown→mouseup 距离判定：超 5px 视为拖拽，不跳转
              const handleMouseDown = (e: MouseEvent) => {
                if (!url) return;
                const startX = e.clientX;
                const startY = e.clientY;
                const onUp = (upEvent: MouseEvent) => {
                  document.removeEventListener('mouseup', onUp, true);
                  const dist = Math.hypot(upEvent.clientX - startX, upEvent.clientY - startY);
                  if (dist > 5) return; // 视为拖拽
                  try {
                    window.open(url, '_blank', 'noopener,noreferrer');
                  } catch (err) {
                    console.error('[RWATreasuries] open issuer failed', err);
                  }
                };
                document.addEventListener('mouseup', onUp, true);
              };
              return (
                <div
                  class="rwa-bar-row"
                  classList={{ 'rwa-bar-row--clickable': !!url }}
                  title={tooltip}
                  onMouseDown={handleMouseDown}
                >
                  <span class="rwa-bar-row__symbol">{label}</span>
                  <div class="rwa-bar-row__bar">
                    <div class="rwa-bar-row__bar-fill" style={{ width: `${widthPct}%` }} />
                  </div>
                  <div class="rwa-bar-row__values">
                    <span class="rwa-bar-row__amount">{formatUsd(asset.mcap)}</span>
                    <span
                      class="rwa-bar-row__delta"
                      classList={{
                        'rwa-bar-row__delta--up': (change ?? 0) > 0,
                        'rwa-bar-row__delta--down': (change ?? 0) < 0,
                      }}
                    >
                      {formatPct(change)}
                    </span>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default RWATreasuriesWidget;
