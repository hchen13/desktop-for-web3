/**
 * StableYield Widget — 生息稳定币 APY 对比
 *
 * 数据源：DefiLlama Yields API（共享 service）
 * 尺寸：默认 2×2，列表可滚动查看更多
 *
 * 功能：
 * - chain filter（all / ethereum / arbitrum / base / solana）
 * - 用户可置顶（pin）任意 pool 到列表顶部，星标点击切换
 * - APY ≥ 5% 高亮绿色
 * - 行点击：在新 tab 打开 https://defillama.com/yields/pool/{pool_id}
 * - 列表 overflow-y: auto；wheel 事件已加白名单避免触发桌面切换
 */
import { Show, onMount, onCleanup, createSignal, createMemo, For } from 'solid-js';
import { yieldsService, selectYields } from '../../services/defillama/yieldsService';
import type { YieldPool, YieldsState } from '../../services/defillama/types';
import { formatLargeNumber, formatNumber } from '../../utils/formatters';
import type { WidgetState } from '../../config/widgetDefaults';
import './StableYieldWidget.css';

interface StableYieldWidgetProps {
  elementId?: string;
  state?: WidgetState;
  onStateChange?: (newState: WidgetState) => void;
}

interface StableYieldSettings {
  chain?: string;
  pinned?: string[];
}

/** APY 高亮阈值 */
const APY_HIGHLIGHT_THRESHOLD = 5;
/** 列表硬上限，避免渲染过多行 */
const MAX_ROWS = 50;

/** 可选链 filter */
const CHAIN_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'ethereum', label: 'ETH' },
  { id: 'arbitrum', label: 'ARB' },
  { id: 'base', label: 'BASE' },
  { id: 'solana', label: 'SOL' },
];

function formatAPY(apy: number | null): string {
  if (apy == null || !Number.isFinite(apy)) return '—';
  return `${formatNumber(apy, 2)}%`;
}

function formatTVL(tvl: number): string {
  const f = formatLargeNumber(tvl);
  return `$${f.value}${f.unit}`;
}

export const StableYieldWidget = (props: StableYieldWidgetProps) => {
  const settings = (): StableYieldSettings => {
    const s = props.state?.settings as StableYieldSettings | undefined;
    return {
      chain: s?.chain || 'all',
      pinned: Array.isArray(s?.pinned) ? s!.pinned : [],
    };
  };

  const [serviceState, setServiceState] = createSignal<YieldsState>(yieldsService.getData());
  const [chain, setChain] = createSignal<string>(settings().chain || 'all');
  const [pinned, setPinned] = createSignal<string[]>(settings().pinned || []);

  let containerRef: HTMLDivElement | undefined;

  const saveSettings = (next: Partial<StableYieldSettings>) => {
    if (!props.onStateChange) return;
    const merged: StableYieldSettings = { ...settings(), ...next };
    props.onStateChange({
      ...props.state,
      settings: merged as Record<string, unknown>,
    });
  };

  const handleChainSelect = (id: string) => {
    setChain(id);
    saveSettings({ chain: id });
  };

  const togglePin = (poolId: string, e: MouseEvent) => {
    e.stopPropagation();
    const current = pinned();
    const next = current.includes(poolId)
      ? current.filter((id) => id !== poolId)
      : [...current, poolId];
    setPinned(next);
    saveSettings({ pinned: next });
  };

  const openPool = (pool: YieldPool) => {
    if (!pool.pool) return;
    const url = `https://defillama.com/yields/pool/${pool.pool}`;
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.error('[StableYield] open pool failed', err);
    }
  };

  /** mousedown→mouseup 距离判定：超 5px 视为拖拽，不跳转 */
  const handleRowMouseDown = (pool: YieldPool, e: MouseEvent) => {
    const startX = e.clientX;
    const startY = e.clientY;
    const onUp = (upEvent: MouseEvent) => {
      document.removeEventListener('mouseup', onUp, true);
      const dist = Math.hypot(upEvent.clientX - startX, upEvent.clientY - startY);
      if (dist > 5) return;
      // 检查事件目标是否是 pin 按钮（pin 已经 stopPropagation，不会到这里，但兜底）
      const target = upEvent.target as HTMLElement | null;
      if (target && target.closest('.stable-yield-row__pin')) return;
      openPool(pool);
    };
    document.addEventListener('mouseup', onUp, true);
  };

  onMount(() => {
    const unsub = yieldsService.subscribe((s) => setServiceState(s));
    void yieldsService.refresh();
    onCleanup(() => unsub());
  });

  /**
   * 排序：pinned 先（按用户 pin 的顺序），其余按 APY 倒序
   */
  const visiblePools = createMemo<YieldPool[]>(() => {
    const all = selectYields(serviceState().pools, { chain: chain(), topN: MAX_ROWS });
    const pinSet = new Set(pinned());
    const pinnedPools: YieldPool[] = [];
    const otherPools: YieldPool[] = [];
    for (const p of all) {
      if (pinSet.has(p.pool)) {
        pinnedPools.push(p);
      } else {
        otherPools.push(p);
      }
    }
    // 按用户 pin 顺序排列 pinned
    pinnedPools.sort((a, b) => pinned().indexOf(a.pool) - pinned().indexOf(b.pool));
    return [...pinnedPools, ...otherPools];
  });

  const isInitialLoading = createMemo(() => {
    const s = serviceState();
    return s.status === 'loading' && s.pools.length === 0;
  });
  const isError = createMemo(
    () => serviceState().status === 'error' && serviceState().pools.length === 0,
  );

  return (
    <div
      class="stable-yield-widget"
      ref={containerRef}
      title="生息稳定币 / 稳定币 LP 池 APY 排行（DefiLlama Yields，TVL≥$10M、APY≤100%、stable-only 池）。点击行进入详情，点击 ☆ 置顶。"
    >
      <header class="stable-yield-widget__header">
        <span class="stable-yield-widget__title">Stable Yield</span>
        <div class="stable-yield-widget__filter">
          <For each={CHAIN_OPTIONS}>
            {(opt) => (
              <button
                type="button"
                class="stable-yield-widget__chip"
                classList={{ 'stable-yield-widget__chip--active': chain() === opt.id }}
                onClick={() => handleChainSelect(opt.id)}
              >
                {opt.label}
              </button>
            )}
          </For>
        </div>
      </header>

      <Show when={isInitialLoading()}>
        <div class="stable-yield-widget__loading">Loading…</div>
      </Show>

      <Show when={!isInitialLoading() && isError()}>
        <div class="stable-yield-widget__error">数据加载失败 · 重试中</div>
      </Show>

      <Show when={!isInitialLoading() && !isError() && visiblePools().length === 0}>
        <div class="stable-yield-widget__loading">No pools match filter</div>
      </Show>

      <Show when={visiblePools().length > 0}>
        <div class="stable-yield-widget__body">
          <For each={visiblePools()}>
            {(pool) => {
              const isPinned = () => pinned().includes(pool.pool);
              return (
                <div
                  class="stable-yield-row"
                  classList={{ 'stable-yield-row--pinned': isPinned() }}
                  onMouseDown={(e) => handleRowMouseDown(pool, e)}
                  title={`${pool.project} · ${pool.symbol} · ${pool.chain} · APY ${formatAPY(pool.apy)} · TVL ${formatTVL(pool.tvlUsd)}`}
                >
                  <button
                    type="button"
                    class="stable-yield-row__pin"
                    classList={{ 'stable-yield-row__pin--active': isPinned() }}
                    onClick={(e) => togglePin(pool.pool, e)}
                    title={isPinned() ? '取消置顶' : '置顶'}
                  >
                    {isPinned() ? '★' : '☆'}
                  </button>
                  <span class="stable-yield-row__project">{pool.project}</span>
                  <span class="stable-yield-row__symbol">{pool.symbol}</span>
                  <div class="stable-yield-row__metrics">
                    <span
                      class="stable-yield-row__apy"
                      classList={{
                        'stable-yield-row__apy--high': (pool.apy ?? 0) >= APY_HIGHLIGHT_THRESHOLD,
                      }}
                    >
                      {formatAPY(pool.apy)}
                    </span>
                    <span class="stable-yield-row__tvl">{formatTVL(pool.tvlUsd)}</span>
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

export default StableYieldWidget;
