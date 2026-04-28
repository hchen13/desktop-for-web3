/**
 * Watchlist 编辑对话框
 * 用于替换 watchlist 中的单个资产槽位
 *
 * 数据源：static ASSETS（src/services/prices/assets.ts）
 *  - All / Crypto / US Stocks / ETF / FX / Commodity 类别 tab
 *  - 模糊搜索：symbol / name 包含 query
 *  - 默认按 rank 升序展示
 */

import { Show, For, createSignal, createMemo, createEffect } from 'solid-js';
import { Portal } from 'solid-js/web';
import { ASSETS, getLogoUrlChain } from '../../services/prices/assets';
import { dynamicCatalog } from '../../services/prices/dynamicCatalog';
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

  // 用一个 signal 触发 dynamicCatalog 加载完成后重渲染
  const [dynamicReady, setDynamicReady] = createSignal(dynamicCatalog.isLoaded());

  const visibleAssets = createMemo<AssetMeta[]>(() => {
    dynamicReady(); // 强依赖触发 memo 重算
    const cat = activeCategory();
    const q = searchQuery().trim().toLowerCase();

    // 第一层：curated ASSETS（按 rank 排序，作为默认推荐）
    let curated: AssetMeta[] = ASSETS;
    if (cat !== 'all') curated = curated.filter((a) => a.category === cat);
    if (q) {
      curated = curated.filter(
        (a) => a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q),
      );
    }
    curated = curated.slice().sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));

    // 第二层：动态 Pyth catalog（仅在搜索时合并；空 query 保持默认列表干净）
    if (!q) return curated;
    const dynResults = dynamicCatalog.search(q, cat);
    if (dynResults.length === 0) return curated;
    const seen = new Set(curated.map((a) => a.symbol));
    const extras = dynResults.filter((a) => !seen.has(a.symbol));
    return [...curated, ...extras];
  });

  // 对话框打开时复位 + 触发动态 catalog 加载
  createEffect(() => {
    if (props.isOpen) {
      setSearchQuery('');
      setSelectedIndex(0);
      setActiveCategory('all');
      setTimeout(() => inputRef?.focus(), 100);
      // 异步加载动态目录；加载完后翻一下 dynamicReady 让 memo 重算
      void dynamicCatalog.ensureLoaded().then(() => {
        if (dynamicCatalog.isLoaded()) setDynamicReady(true);
      });
    }
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
      if (sel) handleSelect(sel);
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
                {(asset, idx) => (
                  <div
                    class={`watchlist-edit-dialog__coin-item ${selectedIndex() === idx() ? 'selected' : ''}`}
                    onClick={() => handleSelect(asset)}
                    onMouseEnter={() => setSelectedIndex(idx())}
                  >
                    <div class="watchlist-edit-dialog__coin-logo-container">
                      <AssetLogo asset={asset} />
                    </div>
                    <div class="watchlist-edit-dialog__coin-info">
                      <span class="watchlist-edit-dialog__coin-symbol">{asset.symbol}</span>
                      <span class="watchlist-edit-dialog__coin-name">{asset.name}</span>
                    </div>
                    <span class="watchlist-edit-dialog__coin-tag">{asset.category}</span>
                  </div>
                )}
              </For>
              <Show when={visibleAssets().length === 0}>
                <div class="watchlist-edit-dialog__empty">未找到匹配资产</div>
              </Show>
            </div>
          </div>
        </div>

        <style>{`
          .watchlist-edit-dialog__overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.6);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
          }

          .watchlist-edit-dialog {
            background: #0a0b0d;
            border: 1px solid #1c1f24;
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
            border-bottom: 1px solid #1c1f24;
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
            background: rgba(255, 255, 255, 0.04); border: 1px solid #1c1f24;
            border-radius: var(--radius-sm); color: var(--text-primary);
            font-size: 14px; outline: none; box-sizing: border-box;
          }
          .watchlist-edit-dialog__input:focus { border-color: var(--text-secondary); }
          .watchlist-edit-dialog__input::placeholder { color: var(--text-tertiary); }

          .watchlist-edit-dialog__tabs {
            display: flex; gap: var(--space-xs); padding: var(--space-sm) var(--space-md);
            border-bottom: 1px solid #1c1f24; flex-wrap: wrap;
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
            background: rgba(255, 255, 255, 0.08);
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
          .watchlist-edit-dialog__coin-item.selected { background: rgba(255, 255, 255, 0.06); }

          .watchlist-edit-dialog__coin-logo-container { width: 24px; height: 24px; flex-shrink: 0; }
          .watchlist-edit-dialog__coin-logo { width: 24px; height: 24px; border-radius: 50%; }
          .watchlist-edit-dialog__coin-logo-fallback {
            width: 24px; height: 24px; border-radius: 50%;
            background: linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05));
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
          .watchlist-edit-dialog__coin-tag {
            font-size: 10px; color: var(--text-tertiary);
            border: 1px solid #1c1f24; border-radius: 4px;
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
