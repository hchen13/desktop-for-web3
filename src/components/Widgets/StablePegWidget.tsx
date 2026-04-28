/**
 * StablePeg Widget — 稳定币脱锚监控
 *
 * 数据源：DefiLlama Stablecoins API（共享 service）
 * 尺寸：默认 2×2，兼容 2×1 紧凑视图
 *
 * 2×2：Top 8 fiat-backed 稳定币（按 mcap 排序），symbol-price-delta 横排
 * 2×1：仅 USDT/USDC/USDe/DAI 4 个核心
 *
 * 偏移颜色：
 *   ≤ 0.2% 中性灰 / 0.2–0.5% 黄 / 0.5–1% 橙 / >1% 红
 *
 * **不**包含 yield-bearing stables（USYC/BUIDL/sUSDe/sUSDS/USDY/OUSG 等）—
 * 它们的价格按设计随收益累积漂移到 $1 以上，并非脱锚事件。
 */
import { Show, onMount, onCleanup, createSignal, createMemo, For } from 'solid-js';
import {
  stablecoinsService,
  classifyPegDelta,
  computePegDelta,
} from '../../services/defillama/stablecoinsService';
import type { StablecoinAsset, StablecoinsState } from '../../services/defillama/types';
import type { WidgetState } from '../../config/widgetDefaults';
import './StablePegWidget.css';

interface StablePegWidgetProps {
  elementId?: string;
  state?: WidgetState;
  onStateChange?: (newState: WidgetState) => void;
  size?: { width: number; height: number };
}

/** 紧凑模式聚焦的核心稳定币 */
const COMPACT_SYMBOLS = ['USDT', 'USDC', 'USDE', 'DAI'];
/** 标准模式 Top N（3 行 × 2 列） */
const STANDARD_TOP_N = 6;

/**
 * 生息稳定币 — 排除在 peg 监控之外
 * 这些代币的价格按设计随时间漂移（yield 累积），不是脱锚
 */
const YIELD_BEARING_SYMBOLS = new Set([
  'USYC',
  'BUIDL',
  'USDY',
  'OUSG',
  'BENJI',
  'USDTB',
  'SUSDE',
  'SUSDS',
  'SDAI',
  'STUSD',
  'USDM',
]);

/** Hard-coded 最近脱锚事件兜底文案 */
const FALLBACK_DEPEG_NOTICE = 'Resolv USR -70% (2026-03)';

function formatPrice(price: number | null): string {
  if (price == null || !Number.isFinite(price)) return '—';
  return price.toFixed(4);
}

function formatDelta(delta: number | null): string {
  if (delta == null || !Number.isFinite(delta)) return '—';
  if (delta < 0.01) return `${delta.toFixed(3)}%`;
  return `${delta.toFixed(2)}%`;
}

function formatTime(ts: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export const StablePegWidget = (_props: StablePegWidgetProps) => {
  const [serviceState, setServiceState] = createSignal<StablecoinsState>(
    stablecoinsService.getData(),
  );
  let containerRef: HTMLDivElement | undefined;
  const [isCompact, setIsCompact] = createSignal(false);

  onMount(() => {
    const unsub = stablecoinsService.subscribe((s) => setServiceState(s));
    void stablecoinsService.refresh();

    let resizeObserver: ResizeObserver | undefined;
    if (containerRef && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setIsCompact(entry.contentRect.height < 160);
        }
      });
      resizeObserver.observe(containerRef);
    }

    onCleanup(() => {
      unsub();
      resizeObserver?.disconnect();
    });
  });

  /** 仅 fiat-backed 类（peggedUSD），且非生息 */
  const filteredAssets = createMemo<StablecoinAsset[]>(() => {
    const list = serviceState().assets;
    return list.filter(
      (a) => a.pegType === 'peggedUSD' && !YIELD_BEARING_SYMBOLS.has(a.symbol) && a.price != null,
    );
  });

  const topAssets = createMemo<StablecoinAsset[]>(() => filteredAssets().slice(0, STANDARD_TOP_N));

  const compactAssets = createMemo<StablecoinAsset[]>(() => {
    const list = filteredAssets();
    if (list.length === 0) return [];
    const out: StablecoinAsset[] = [];
    for (const sym of COMPACT_SYMBOLS) {
      const found = list.find((a) => a.symbol === sym);
      if (found) out.push(found);
    }
    return out;
  });

  const displayAssets = createMemo<StablecoinAsset[]>(() => {
    return isCompact() ? compactAssets() : topAssets();
  });

  const hasData = createMemo(() => displayAssets().length > 0);
  const isInitialLoading = createMemo(() => {
    const s = serviceState();
    return s.status === 'loading' && s.assets.length === 0;
  });
  const isError = createMemo(() => serviceState().status === 'error');

  return (
    <div
      class="stable-peg-widget"
      ref={containerRef}
      title="USD 锚定稳定币的脱锚监控（已排除生息类如 sUSDe/sUSDS/USDY 等——它们的价格随 yield 累积漂移，并非真正脱锚）"
    >
      <header class="stable-peg-widget__header">
        <span class="stable-peg-widget__title">Stablecoin Peg</span>
        <span class="stable-peg-widget__meta">
          <span
            class="stable-peg-widget__status-dot"
            classList={{ 'stable-peg-widget__status-dot--err': isError() }}
          />
          {formatTime(serviceState().lastUpdated)}
        </span>
      </header>

      <Show when={isInitialLoading()}>
        <div class="stable-peg-widget__loading">Loading…</div>
      </Show>

      <Show when={!isInitialLoading() && !hasData() && isError()}>
        <div class="stable-peg-widget__error">数据加载失败 · 重试中</div>
      </Show>

      <Show when={hasData()}>
        <div
          class="stable-peg-widget__body"
          classList={{ 'stable-peg-widget__body--compact': isCompact() }}
        >
          <For each={displayAssets()}>
            {(asset) => {
              const delta = computePegDelta(asset);
              const level = classifyPegDelta(delta);
              return (
                <div
                  class="stable-peg-cell"
                  title={`${asset.name} · mcap $${(asset.mcap / 1e9).toFixed(2)}B`}
                >
                  <div class="stable-peg-cell__symbol">{asset.symbol}</div>
                  <div class="stable-peg-cell__row">
                    <span class="stable-peg-cell__price">{formatPrice(asset.price)}</span>
                    <span
                      class="stable-peg-cell__delta"
                      classList={{
                        'stable-peg-cell__delta--lvl0': level === 0,
                        'stable-peg-cell__delta--lvl1': level === 1,
                        'stable-peg-cell__delta--lvl2': level === 2,
                        'stable-peg-cell__delta--lvl3': level === 3,
                      }}
                    >
                      {formatDelta(delta)}
                    </span>
                  </div>
                </div>
              );
            }}
          </For>
        </div>

        <Show when={!isCompact()}>
          <div class="stable-peg-widget__footer">last depeg · {FALLBACK_DEPEG_NOTICE}</div>
        </Show>
      </Show>
    </div>
  );
};

export default StablePegWidget;
