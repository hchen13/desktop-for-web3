/**
 * Watchlist 编辑对话框
 * 用于编辑 watchlist 中的单个币种槽位
 */

import { Show, For, createSignal, createMemo, createEffect } from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  searchCoins,
  getCachedCoinList,
  hasCategories,
  fetchCoinList,
  type CoinInfo,
} from '../../services/binance/coinListService';
import { getCurrentSource } from '../../services/binance/connectivityService';

/**
 * CoinCap Logo URL 生成器
 */
const getCoinCapLogoUrl = (symbol: string): string => {
  const originalUrl = `https://assets.coincap.io/assets/icons/${symbol.toLowerCase()}@2x.png`;
  return `https://images.weserv.nl/?url=${encodeURIComponent(originalUrl)}`;
};

export interface WatchlistSlot {
  symbol: string;
  baseAsset: string;
  name: string;
}

interface WatchlistEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (slotIndex: number, coin: CoinInfo) => void;
  /** 当前编辑的槽位 */
  currentSlot: WatchlistSlot;
  /** 槽位索引 */
  slotIndex: number;
}

export const WatchlistEditDialog = (props: WatchlistEditDialogProps) => {
  // 搜索输入
  const [searchQuery, setSearchQuery] = createSignal('');
  // 搜索结果
  const [searchResults, setSearchResults] = createSignal<CoinInfo[]>([]);
  // 键盘选中的索引
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  // 当前分类 tab
  const [activeCategory, setActiveCategory] = createSignal<string | null>(null);
  // "更多"下拉菜单是否展开
  const [showMoreDropdown, setShowMoreDropdown] = createSignal(false);
  // 数据加载状态
  const [isLoading, setIsLoading] = createSignal(false);
  // 缓存版本号（用于触发响应式更新）
  const [cacheVersion, setCacheVersion] = createSignal(0);
  // 输入框引用
  let inputRef: HTMLInputElement | undefined;

  // 数据源
  const dataSource = createMemo(() => getCurrentSource());
  // 是否有分类
  const showCategories = createMemo(() => {
    cacheVersion(); // 触发响应式依赖
    return dataSource() === 'binance.com' && hasCategories();
  });
  // 获取分类列表
  const categories = createMemo(() => {
    cacheVersion(); // 触发响应式依赖
    const cache = getCachedCoinList();
    return cache?.categories ?? [];
  });
  // 获取全部币种
  const allCoins = createMemo(() => {
    const version = cacheVersion(); // 触发响应式依赖
    const cache = getCachedCoinList();
    const coins = cache?.coins ?? [];
    console.log(`[WatchlistEditDialog] allCoins recalculated, version=${version}, count=${coins.length}`);
    return coins;
  });

  // 根据分类获取币种列表
  const displayCoins = createMemo(() => {
    const category = activeCategory();
    const coins = allCoins();
    console.log(`[WatchlistEditDialog] displayCoins recalculated, category=${category}, coins=${coins.length}`);
    if (!category) {
      return coins;
    }
    const cat = categories().find(c => c.name === category);
    return cat?.coins ?? [];
  });

  // 对话框打开时加载数据并聚焦输入框
  createEffect(() => {
    if (props.isOpen) {
      setSearchQuery('');
      setSearchResults([]);
      setSelectedIndex(0);
      setActiveCategory(null);

      // 检查缓存是否存在，不存在则加载
      const cache = getCachedCoinList();
      console.log('[WatchlistEditDialog] Dialog opened, cache status:', cache ? `${cache.coins.length} coins` : 'empty');
      if (!cache || cache.coins.length === 0) {
        setIsLoading(true);
        fetchCoinList()
          .then((result) => {
            console.log('[WatchlistEditDialog] Coin list loaded, coins:', result.coins.length);
            // 增加版本号以触发响应式更新
            setCacheVersion(v => v + 1);
          })
          .catch(err => {
            console.error('[WatchlistEditDialog] Failed to load coin list:', err);
          })
          .finally(() => {
            setIsLoading(false);
          });
      } else {
        // 缓存已存在，也需要触发响应式更新
        console.log(`[WatchlistEditDialog] Using cached coin list (${cache.coins.length} coins)`);
        setCacheVersion(v => v + 1);
      }

      setTimeout(() => inputRef?.focus(), 100);
    }
  });

  // 搜索时更新结果
  createEffect(() => {
    const query = searchQuery();
    if (query.trim()) {
      const results = searchCoins(query, 20);
      setSearchResults(results);
      setSelectedIndex(0);
    } else {
      setSearchResults([]);
    }
  });

  // 阻止滚动冒泡
  const handleWheel = (e: WheelEvent) => {
    e.stopPropagation();
  };

  const handleTouchMove = (e: TouchEvent) => {
    e.stopPropagation();
  };

  // 键盘导航
  const handleKeyDown = (e: KeyboardEvent) => {
    const results = searchResults();

    if (e.key === 'Escape') {
      e.preventDefault();
      if (searchQuery()) {
        setSearchQuery('');
        setSearchResults([]);
      } else {
        props.onClose();
      }
      return;
    }

    if (results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = results[selectedIndex()];
      if (selected) {
        handleSelectCoin(selected);
      }
    }
  };

  // 选择币种
  const handleSelectCoin = (coin: CoinInfo) => {
    props.onConfirm(props.slotIndex, coin);
    props.onClose();
  };

  // 点击 overlay 关闭
  const handleOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      props.onClose();
    }
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
            {/* 标题 - 显示当前编辑的币种 */}
            <div class="watchlist-edit-dialog__header">
              <div class="watchlist-edit-dialog__header-left">
                <img
                  src={getCoinCapLogoUrl(props.currentSlot.baseAsset)}
                  alt={props.currentSlot.baseAsset}
                  class="watchlist-edit-dialog__header-logo"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
                <div class="watchlist-edit-dialog__header-info">
                  <span class="watchlist-edit-dialog__title">
                    替换 {props.currentSlot.baseAsset}
                  </span>
                  <span class="watchlist-edit-dialog__subtitle">
                    {props.currentSlot.name}
                  </span>
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
                placeholder="输入币种名称或代码..."
                value={searchQuery()}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
              />

              {/* 搜索结果下拉 */}
              <Show when={searchQuery().trim() && searchResults().length > 0}>
                <div
                  class="watchlist-edit-dialog__dropdown"
                  onWheel={handleWheel}
                  onTouchMove={handleTouchMove}
                >
                  <For each={searchResults()}>
                    {(coin, index) => (
                      <div
                        class={`watchlist-edit-dialog__dropdown-item ${selectedIndex() === index() ? 'selected' : ''}`}
                        onClick={() => handleSelectCoin(coin)}
                        onMouseEnter={() => setSelectedIndex(index())}
                      >
                        <div class="watchlist-edit-dialog__dropdown-logo-container">
                          <img
                            src={getCoinCapLogoUrl(coin.baseAsset)}
                            alt={coin.baseAsset}
                            class="watchlist-edit-dialog__dropdown-logo"
                            onError={(e) => {
                              const img = e.currentTarget as HTMLImageElement;
                              img.style.display = 'none';
                              const fallback = img.nextElementSibling as HTMLElement;
                              if (fallback) fallback.style.display = 'flex';
                            }}
                          />
                          <div class="watchlist-edit-dialog__dropdown-logo-fallback" style="display: none;">
                            {coin.baseAsset.charAt(0)}
                          </div>
                        </div>
                        <span class="watchlist-edit-dialog__dropdown-name">
                          {coin.name}
                        </span>
                        <span class="watchlist-edit-dialog__dropdown-symbol">
                          {coin.baseAsset}
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              {/* 无结果提示 */}
              <Show when={searchQuery().trim() && searchResults().length === 0 && !isLoading()}>
                <div class="watchlist-edit-dialog__no-results">
                  未找到匹配币种
                </div>
              </Show>
            </div>

            {/* 分类 Tab（仅 Binance.com） */}
            <Show when={showCategories()}>
              {(() => {
                const MAX_VISIBLE_TABS = 4;
                const allCategories = categories();
                const visibleCategories = allCategories.slice(0, MAX_VISIBLE_TABS);
                const moreCategories = allCategories.slice(MAX_VISIBLE_TABS);
                const isMoreActive = moreCategories.some(cat => activeCategory() === cat.name);
                
                return (
                  <div
                    class="watchlist-edit-dialog__tabs"
                    onWheel={handleWheel}
                    onTouchMove={handleTouchMove}
                  >
                    <button
                      class={`watchlist-edit-dialog__tab ${activeCategory() === null ? 'active' : ''}`}
                      onClick={() => {
                        setActiveCategory(null);
                        setShowMoreDropdown(false);
                      }}
                    >
                      全部
                    </button>
                    <For each={visibleCategories}>
                      {(cat) => (
                        <button
                          class={`watchlist-edit-dialog__tab ${activeCategory() === cat.name ? 'active' : ''}`}
                          onClick={() => {
                            setActiveCategory(cat.name);
                            setShowMoreDropdown(false);
                          }}
                        >
                          {cat.name}
                        </button>
                      )}
                    </For>
                    {/* 更多按钮 */}
                    <Show when={moreCategories.length > 0}>
                      <div class="watchlist-edit-dialog__more-container">
                        <button
                          class={`watchlist-edit-dialog__tab watchlist-edit-dialog__more-btn ${isMoreActive || showMoreDropdown() ? 'active' : ''}`}
                          onClick={() => setShowMoreDropdown(!showMoreDropdown())}
                        >
                          {isMoreActive ? activeCategory() : '更多'}
                          <span class={`watchlist-edit-dialog__more-arrow ${showMoreDropdown() ? 'open' : ''}`}>▼</span>
                        </button>
                        <Show when={showMoreDropdown()}>
                          <div class="watchlist-edit-dialog__more-dropdown">
                            <For each={moreCategories}>
                              {(cat) => (
                                <button
                                  class={`watchlist-edit-dialog__dropdown-item ${activeCategory() === cat.name ? 'active' : ''}`}
                                  onClick={() => {
                                    setActiveCategory(cat.name);
                                    setShowMoreDropdown(false);
                                  }}
                                >
                                  {cat.name}
                                </button>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    </Show>
                  </div>
                );
              })()}
            </Show>

            {/* 全币种列表 */}
            <div
              class="watchlist-edit-dialog__coin-list"
              onWheel={handleWheel}
              onTouchMove={handleTouchMove}
              onTouchStart={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
            >
              {/* 加载状态 */}
              <Show when={isLoading()}>
                <div class="watchlist-edit-dialog__loading">
                  <div class="watchlist-edit-dialog__spinner"></div>
                  <span>加载币种列表...</span>
                </div>
              </Show>

              {/* 币种列表 */}
              <Show when={!isLoading()}>
                <For each={displayCoins()}>
                  {(coin) => (
                    <div
                      class="watchlist-edit-dialog__coin-item"
                      onClick={() => handleSelectCoin(coin)}
                    >
                      <div class="watchlist-edit-dialog__coin-logo-container">
                        <img
                          src={getCoinCapLogoUrl(coin.baseAsset)}
                          alt={coin.baseAsset}
                          class="watchlist-edit-dialog__coin-logo"
                          onError={(e) => {
                            const img = e.currentTarget as HTMLImageElement;
                            img.style.display = 'none';
                            const fallback = img.nextElementSibling as HTMLElement;
                            if (fallback) fallback.style.display = 'flex';
                          }}
                        />
                        <div class="watchlist-edit-dialog__coin-logo-fallback" style="display: none;">
                          {coin.baseAsset.charAt(0)}
                        </div>
                      </div>
                      <div class="watchlist-edit-dialog__coin-info">
                        <span class="watchlist-edit-dialog__coin-symbol">{coin.baseAsset}</span>
                        <span class="watchlist-edit-dialog__coin-name">{coin.name}</span>
                      </div>
                    </div>
                  )}
                </For>

                <Show when={displayCoins().length === 0}>
                  <div class="watchlist-edit-dialog__empty">
                    暂无币种数据，请稍后重试
                  </div>
                </Show>
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
            width: 480px;
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

          .watchlist-edit-dialog__header-left {
            display: flex;
            align-items: center;
            gap: var(--space-sm);
          }

          .watchlist-edit-dialog__header-logo {
            width: 32px;
            height: 32px;
            border-radius: 50%;
          }

          .watchlist-edit-dialog__header-info {
            display: flex;
            flex-direction: column;
          }

          .watchlist-edit-dialog__title {
            font-size: 16px;
            font-weight: 600;
            color: var(--text-primary);
          }

          .watchlist-edit-dialog__subtitle {
            font-size: 12px;
            color: var(--text-tertiary);
          }

          .watchlist-edit-dialog__close {
            background: none;
            border: none;
            color: var(--text-tertiary);
            font-size: 16px;
            cursor: pointer;
            padding: 4px;
            line-height: 1;
          }

          .watchlist-edit-dialog__close:hover {
            color: var(--text-primary);
          }

          /* 搜索框 */
          .watchlist-edit-dialog__search {
            position: relative;
            padding: var(--space-sm) var(--space-md);
          }

          .watchlist-edit-dialog__input {
            width: 100%;
            padding: var(--space-sm) var(--space-md);
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid #1c1f24;
            border-radius: var(--radius-sm);
            color: var(--text-primary);
            font-size: 14px;
            outline: none;
            transition: border-color 0.15s ease;
            box-sizing: border-box;
          }

          .watchlist-edit-dialog__input:focus {
            border-color: var(--text-secondary);
          }

          .watchlist-edit-dialog__input::placeholder {
            color: var(--text-tertiary);
          }

          /* 搜索下拉 */
          .watchlist-edit-dialog__dropdown {
            position: absolute;
            top: 100%;
            left: var(--space-md);
            right: var(--space-md);
            background: #14161a;
            border: 1px solid #1c1f24;
            border-radius: var(--radius-sm);
            max-height: 200px;
            overflow-y: auto;
            z-index: 20;
          }

          .watchlist-edit-dialog__dropdown > .watchlist-edit-dialog__dropdown-item {
            display: flex;
            align-items: center;
            gap: var(--space-sm);
            padding: var(--space-sm) var(--space-md);
            cursor: pointer;
            transition: background 0.1s ease;
          }

          .watchlist-edit-dialog__dropdown > .watchlist-edit-dialog__dropdown-item:hover,
          .watchlist-edit-dialog__dropdown > .watchlist-edit-dialog__dropdown-item.selected {
            background: rgba(255, 255, 255, 0.08);
          }

          .watchlist-edit-dialog__dropdown-logo-container {
            width: 24px;
            height: 24px;
            flex-shrink: 0;
          }

          .watchlist-edit-dialog__dropdown-logo {
            width: 24px;
            height: 24px;
            border-radius: 50%;
          }

          .watchlist-edit-dialog__dropdown-logo-fallback {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05));
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: 600;
            color: var(--text-secondary);
          }

          .watchlist-edit-dialog__dropdown-name {
            flex: 1;
            font-size: 14px;
            color: var(--text-primary);
          }

          .watchlist-edit-dialog__dropdown-symbol {
            font-size: 12px;
            color: var(--text-tertiary);
            font-family: 'SF Mono', monospace;
          }

          .watchlist-edit-dialog__no-results {
            position: absolute;
            top: 100%;
            left: var(--space-md);
            right: var(--space-md);
            background: #14161a;
            border: 1px solid #1c1f24;
            border-radius: var(--radius-sm);
            padding: var(--space-md);
            text-align: center;
            color: var(--text-tertiary);
            font-size: 13px;
          }

          /* 分类 Tab */
          .watchlist-edit-dialog__tabs {
            display: flex;
            gap: var(--space-xs);
            padding: var(--space-sm) var(--space-md);
            border-bottom: 1px solid #1c1f24;
            flex-shrink: 0;
            overflow: visible;
            position: relative;
            z-index: 10;
          }

          .watchlist-edit-dialog__tab {
            padding: var(--space-xs) var(--space-sm);
            background: none;
            border: 1px solid transparent;
            border-radius: var(--radius-sm);
            color: var(--text-tertiary);
            font-size: 12px;
            cursor: pointer;
            transition: all 0.15s ease;
            white-space: nowrap;
          }

          .watchlist-edit-dialog__tab:hover {
            color: var(--text-secondary);
          }

          .watchlist-edit-dialog__tab.active {
            background: rgba(255, 255, 255, 0.08);
            border-color: var(--text-secondary);
            color: var(--text-primary);
          }

          /* 更多按钮容器 */
          .watchlist-edit-dialog__more-container {
            position: relative;
            margin-left: auto;
          }

          .watchlist-edit-dialog__more-btn {
            display: flex;
            align-items: center;
            gap: 4px;
          }

          .watchlist-edit-dialog__more-arrow {
            font-size: 8px;
            transition: transform 0.2s ease;
          }

          .watchlist-edit-dialog__more-arrow.open {
            transform: rotate(180deg);
          }

          /* 更多下拉菜单 */
          .watchlist-edit-dialog__more-dropdown {
            position: absolute;
            top: 100%;
            right: 0;
            margin-top: 4px;
            min-width: 140px;
            background: rgba(30, 33, 38, 0.98);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: var(--radius-sm);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
            z-index: 100;
            padding: 4px;
          }

          .watchlist-edit-dialog__dropdown-item {
            display: block;
            width: 100%;
            padding: 8px 12px;
            background: none;
            border: none;
            border-radius: 4px;
            color: var(--text-secondary);
            font-size: 12px;
            text-align: left;
            cursor: pointer;
            transition: all 0.15s ease;
          }

          .watchlist-edit-dialog__dropdown-item:hover {
            background: rgba(255, 255, 255, 0.08);
            color: var(--text-primary);
          }

          .watchlist-edit-dialog__dropdown-item.active {
            background: rgba(255, 255, 255, 0.12);
            color: var(--text-primary);
          }

          /* 币种列表 */
          .watchlist-edit-dialog__coin-list {
            flex: 1;
            overflow-y: auto;
            padding: var(--space-sm);
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
            gap: var(--space-xs);
            align-content: start;
            min-height: 200px;
            position: relative;
            z-index: 1;
          }

          .watchlist-edit-dialog__coin-item {
            display: flex;
            align-items: center;
            gap: var(--space-xs);
            padding: var(--space-xs) var(--space-sm);
            background: rgba(255, 255, 255, 0.02);
            border-radius: var(--radius-sm);
            cursor: pointer;
            transition: background 0.1s ease;
          }

          .watchlist-edit-dialog__coin-item:hover {
            background: rgba(255, 255, 255, 0.08);
          }

          .watchlist-edit-dialog__coin-logo-container {
            width: 24px;
            height: 24px;
            flex-shrink: 0;
          }

          .watchlist-edit-dialog__coin-logo {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            flex-shrink: 0;
          }

          .watchlist-edit-dialog__coin-logo-fallback {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05));
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: 600;
            color: var(--text-secondary);
          }

          .watchlist-edit-dialog__coin-info {
            display: flex;
            flex-direction: column;
            min-width: 0;
          }

          .watchlist-edit-dialog__coin-symbol {
            font-size: 12px;
            font-weight: 600;
            color: var(--text-primary);
          }

          .watchlist-edit-dialog__coin-name {
            font-size: 10px;
            color: var(--text-tertiary);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .watchlist-edit-dialog__empty {
            grid-column: 1 / -1;
            text-align: center;
            padding: var(--space-lg);
            color: var(--text-tertiary);
          }

          .watchlist-edit-dialog__loading {
            grid-column: 1 / -1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: var(--space-sm);
            padding: var(--space-lg);
            color: var(--text-tertiary);
          }

          .watchlist-edit-dialog__spinner {
            width: 24px;
            height: 24px;
            border: 2px solid rgba(255, 255, 255, 0.1);
            border-top-color: var(--text-primary);
            border-radius: 50%;
            animation: watchlist-spin 0.8s linear infinite;
          }

          @keyframes watchlist-spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </Portal>
    </Show>
  );
};
