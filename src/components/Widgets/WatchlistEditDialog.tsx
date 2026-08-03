/**
 * Watchlist 编辑对话框
 * 用于替换 watchlist 中的单个资产槽位
 *
 * 数据源：curated ASSETS + exchange market catalog
 *  - 打开时立即展示 curated / 已缓存条目，同时后台刷新过期的 exchange catalog
 *  - 搜索输入不发任何网络请求，全部是本地查询
 *  - 只有至少存在一个 live instrument 的资产才允许被选中
 */

import { Show, For, createSignal, createMemo, createEffect, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { getLogoUrlChain } from '../../services/prices/assets';
import { exchangeCatalog, type CatalogEntry } from '../../services/prices/exchangeCatalog';
import type { AssetMeta, AssetCategory } from '../../services/prices/types';

export interface WatchlistSlot {
  symbol: string;
  name: string;
  category: AssetCategory;
}

interface WatchlistEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (slotIndex: number, asset: AssetMeta) => void;
  /** 当前编辑的槽位 */
  currentSlot: WatchlistSlot;
  /** 槽位索引 */
  slotIndex: number;
}

const CATEGORY_TABS: Array<{ key: AssetCategory | 'all'; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'crypto', label: 'Crypto' },
  { key: 'stock', label: 'US Stocks' },
  { key: 'etf', label: 'ETF' },
  { key: 'fx', label: 'FX' },
  { key: 'commodity', label: 'Commodity' },
];

function assetLogoChain(asset: AssetMeta): string[] {
  return getLogoUrlChain(asset);
}

/** 单个资产 logo —— 支持多 URL fallback（onError 顺序换下一个，全失败 → 文字首字母） */
const AssetLogo = (props: { asset: AssetMeta }) => {
  const chain = createMemo(() => assetLogoChain(props.asset));
  const [idx, setIdx] = createSignal(0);
  const cur = createMemo(() => {
    const c = chain();
    return c.length > 0 && idx() < c.length ? c[idx()] : null;
  });
  return (
    <Show
      when={cur()}
      fallback={
        <div class="watchlist-edit-dialog__coin-logo-fallback">{props.asset.symbol.charAt(0)}</div>
      }
    >
      <img
        src={cur()!}
        alt={props.asset.symbol}
        class="watchlist-edit-dialog__coin-logo"
        onError={() => setIdx(idx() + 1)}
      />
    </Show>
  );
};

export const WatchlistEditDialog = (props: WatchlistEditDialogProps) => {
  const [searchQuery, setSearchQuery] = createSignal('');
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [activeCategory, setActiveCategory] = createSignal<AssetCategory | 'all'>('all');
  let inputRef: HTMLInputElement | undefined;

  // catalog 后台刷新完成后翻一下版本号让 memo 重算
  const [catalogVersion, setCatalogVersion] = createSignal(0);
  const [isRefreshing, setIsRefreshing] = createSignal(false);
  onCleanup(exchangeCatalog.onUpdate(() => setCatalogVersion((v) => v + 1)));

  // 纯本地查询：输入字符不触发任何网络请求
  const visibleAssets = createMemo<CatalogEntry[]>(() => {
    catalogVersion();
    return exchangeCatalog.search(searchQuery(), activeCategory());
  });

  // 打开弹窗是 catalog 网络请求唯一的正常触发时机
  createEffect(() => {
    if (!props.isOpen) return;
    setSearchQuery('');
    setSelectedIndex(0);
    setActiveCategory('all');
    setTimeout(() => inputRef?.focus(), 100);
    setIsRefreshing(!exchangeCatalog.isFresh());
    void exchangeCatalog.ensureFresh().finally(() => {
      setCatalogVersion((v) => v + 1);
      setIsRefreshing(false);
    });
  });

  // 搜索改变时重置 index
  createEffect(() => {
    searchQuery();
    setSelectedIndex(0);
  });

  const handleWheel = (e: WheelEvent) => e.stopPropagation();
  const handleTouchMove = (e: TouchEvent) => e.stopPropagation();

  const handleKeyDown = (e: KeyboardEvent) => {
    const list = visibleAssets();
    if (e.key === 'Escape') {
      e.preventDefault();
      if (searchQuery()) {
        setSearchQuery('');
      } else {
        props.onClose();
      }
      return;
    }
    if (list.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((p) => Math.min(p + 1, list.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((p) => Math.max(p - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const sel = list[selectedIndex()];
      if (sel && sel.selectable) handleSelect(sel.meta);
    }
  };

  const handleSelect = (asset: AssetMeta) => {
    props.onConfirm(props.slotIndex, asset);
    props.onClose();
  };

  const handleOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) props.onClose();
  };

  return (
    <Show when={props.isOpen}>
      <Portal>
        <div
          class="watchlist-edit-dialog__overlay"
          onClick={handleOverlayClick}
          onWheel={handleWheel}
          onTouchMove={handleTouchMove}
        >
          <div
            class="watchlist-edit-dialog"
            onWheel={handleWheel}
            onTouchMove={handleTouchMove}
            onClick={(e) => e.stopPropagation()}
          >
            <div class="watchlist-edit-dialog__header">
              <div class="watchlist-edit-dialog__header-left">
                <div class="watchlist-edit-dialog__header-info">
                  <span class="watchlist-edit-dialog__title">替换 {props.currentSlot.symbol}</span>
                  <span class="watchlist-edit-dialog__subtitle">{props.currentSlot.name}</span>
                </div>
              </div>
              <button class="watchlist-edit-dialog__close" onClick={props.onClose}>
                ✕
              </button>
            </div>

            {/* 搜索框 */}
            <div class="watchlist-edit-dialog__search">
              <input
                ref={inputRef}
                type="text"
                class="watchlist-edit-dialog__input"
                placeholder="输入资产代码或名称..."
                value={searchQuery()}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
              />
            </div>

            {/* 类别 Tab */}
            <div
              class="watchlist-edit-dialog__tabs"
              onWheel={handleWheel}
              onTouchMove={handleTouchMove}
            >
              <For each={CATEGORY_TABS}>
                {(tab) => (
                  <button
                    class={`watchlist-edit-dialog__tab ${activeCategory() === tab.key ? 'active' : ''}`}
                    onClick={() => setActiveCategory(tab.key)}
                  >
                    {tab.label}
                  </button>
                )}
              </For>
            </div>

            {/* 列表 */}
            <div
              class="watchlist-edit-dialog__coin-list"
              onWheel={handleWheel}
              onTouchMove={handleTouchMove}
            >
              <For each={visibleAssets()}>
                {(entry, idx) => (
                  <div
                    classList={{
                      'watchlist-edit-dialog__coin-item': true,
                      selected: selectedIndex() === idx(),
                      'watchlist-edit-dialog__coin-item--disabled': !entry.selectable,
                    }}
                    onClick={() => entry.selectable && handleSelect(entry.meta)}
                    onMouseEnter={() => setSelectedIndex(idx())}
                  >
                    <div class="watchlist-edit-dialog__coin-logo-container">
                      <AssetLogo asset={entry.meta} />
                    </div>
                    <div class="watchlist-edit-dialog__coin-info">
                      <span class="watchlist-edit-dialog__coin-symbol">{entry.meta.symbol}</span>
                      <span class="watchlist-edit-dialog__coin-name">{entry.meta.name}</span>
                    </div>
                    <Show when={!entry.selectable}>
                      <span class="watchlist-edit-dialog__coin-status">暂无公开行情</span>
                    </Show>
                    <span class="watchlist-edit-dialog__coin-tag">{entry.meta.category}</span>
                  </div>
                )}
              </For>
              <Show when={visibleAssets().length === 0}>
                <div class="watchlist-edit-dialog__empty">
                  {isRefreshing() ? '正在加载交易所标的…' : '未找到匹配资产'}
                </div>
              </Show>
            </div>
          </div>
        </div>

        <style>{`
          .watchlist-edit-dialog__overlay {
            position: fixed;
            inset: 0;
            background: var(--bg-scrim);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
          }

          .watchlist-edit-dialog {
            background: var(--bg-panel);
            border: var(--widget-border);
            border-radius: var(--radius-lg);
            width: 520px;
            max-width: 90vw;
            max-height: 80vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }

          .watchlist-edit-dialog__header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: var(--space-md);
            border-bottom: 1px solid var(--widget-divider);
          }
          .watchlist-edit-dialog__header-left { display: flex; align-items: center; gap: var(--space-sm); }
          .watchlist-edit-dialog__header-info { display: flex; flex-direction: column; }
          .watchlist-edit-dialog__title { font-size: 16px; font-weight: 600; color: var(--text-primary); }
          .watchlist-edit-dialog__subtitle { font-size: 12px; color: var(--text-tertiary); }

          .watchlist-edit-dialog__close {
            background: none; border: none; color: var(--text-tertiary);
            font-size: 16px; cursor: pointer; padding: 4px; line-height: 1;
          }
          .watchlist-edit-dialog__close:hover { color: var(--text-primary); }

          .watchlist-edit-dialog__search { padding: var(--space-sm) var(--space-md); }
          .watchlist-edit-dialog__input {
            width: 100%; padding: var(--space-sm) var(--space-md);
            background: var(--bg-control); border: var(--widget-border);
            border-radius: var(--radius-sm); color: var(--text-primary);
            font-size: 14px; outline: none; box-sizing: border-box;
          }
          .watchlist-edit-dialog__input:focus { border-color: var(--text-secondary); }
          .watchlist-edit-dialog__input::placeholder { color: var(--text-tertiary); }

          .watchlist-edit-dialog__tabs {
            display: flex; gap: var(--space-xs); padding: var(--space-sm) var(--space-md);
            border-bottom: 1px solid var(--widget-divider); flex-wrap: wrap;
          }
          .watchlist-edit-dialog__tab {
            padding: var(--space-xs) var(--space-sm);
            background: none; border: 1px solid transparent;
            border-radius: var(--radius-sm); color: var(--text-tertiary);
            font-size: 12px; cursor: pointer; transition: all 0.15s ease;
            white-space: nowrap;
          }
          .watchlist-edit-dialog__tab:hover { color: var(--text-secondary); }
          .watchlist-edit-dialog__tab.active {
            background: var(--bg-control-active);
            border-color: var(--text-secondary); color: var(--text-primary);
          }

          .watchlist-edit-dialog__coin-list {
            flex: 1; overflow-y: auto; padding: var(--space-sm);
            display: flex; flex-direction: column; gap: 2px; min-height: 200px;
          }
          .watchlist-edit-dialog__coin-item {
            display: flex; align-items: center; gap: var(--space-sm);
            padding: var(--space-xs) var(--space-sm);
            border-radius: var(--radius-sm); cursor: pointer;
            transition: background 0.1s ease;
          }
          .watchlist-edit-dialog__coin-item:hover,
          .watchlist-edit-dialog__coin-item.selected { background: var(--bg-control); }

          .watchlist-edit-dialog__coin-logo-container { width: 24px; height: 24px; flex-shrink: 0; }
          .watchlist-edit-dialog__coin-logo { width: 24px; height: 24px; border-radius: 50%; }
          .watchlist-edit-dialog__coin-logo-fallback {
            width: 24px; height: 24px; border-radius: 50%;
            background: linear-gradient(135deg, var(--bg-control-hover), var(--bg-control));
            display: flex; align-items: center; justify-content: center;
            font-size: 12px; font-weight: 600; color: var(--text-secondary);
          }

          .watchlist-edit-dialog__coin-info {
            display: flex; flex-direction: column; min-width: 0; flex: 1;
          }
          .watchlist-edit-dialog__coin-symbol {
            font-size: 13px; font-weight: 600; color: var(--text-primary);
          }
          .watchlist-edit-dialog__coin-name {
            font-size: 11px; color: var(--text-tertiary);
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          }
          .watchlist-edit-dialog__coin-item--disabled {
            opacity: 0.45; cursor: not-allowed;
          }
          .watchlist-edit-dialog__coin-status {
            font-size: 10px; color: var(--text-tertiary); white-space: nowrap;
          }
          .watchlist-edit-dialog__coin-tag {
            font-size: 10px; color: var(--text-tertiary);
            border: var(--widget-border); border-radius: 4px;
            padding: 1px 6px; text-transform: uppercase;
          }
          .watchlist-edit-dialog__empty {
            text-align: center; padding: var(--space-lg); color: var(--text-tertiary);
          }
        `}</style>
      </Portal>
    </Show>
  );
};
