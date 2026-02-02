/**
 * Watchlist Widget - 价格监控组件
 * 显示关注代币的实时价格和涨跌幅
 * 同时使用 REST API（初始数据）和 WebSocket（实时更新）
 */

import { Show, onMount, onCleanup, createSignal, createMemo, Index } from 'solid-js';
import {
  subscribeWatchlistPrices,
  onConnectionStatusChange,
  updatePriceCacheBatch,
  probeConnectivity,
  getCurrentSource,
  fetchCoinList,
  type CoinInfo,
} from '../../services/binance';
import { fetch24hrTickerMini, fetch24hrTickerMiniSingle } from '../../services/binance/binanceRest';
import { WATCHLIST_COINS, getCoinCapLogoUrl } from '../../config/watchlistConfig';
import type { PriceData, ConnectionStatus, WatchlistCoinConfig } from '../../services/binance/types';
import { useContextMenu } from '../layout/ContextMenu';
import { mergeMenuItems } from '../../grid/contextMenuUtils';
import { WatchlistEditDialog } from './WatchlistEditDialog';

// 数据新鲜度阈值：5分钟
const STALE_THRESHOLD_MS = 5 * 60 * 1000;

// 格式化价格：使用 Binance 原始字符串，添加千分位，去掉尾随零
const formatPrice = (item: PriceData) => {
  // 优先使用 priceString，回退到 price
  const priceStr = item.priceString || (item.price != null ? String(item.price) : '0');

  // 添加千分位分隔符，去掉尾随零
  const parts = priceStr.split('.');
  const integerPart = parseFloat(parts[0] || '0').toLocaleString('en-US');
  const decimalPart = parts[1];

  if (decimalPart !== undefined) {
    // 去掉尾随零
    const trimmedDecimal = decimalPart.replace(/0+$/, '');
    if (trimmedDecimal) {
      return `$${integerPart}.${trimmedDecimal}`;
    }
  }
  return `$${integerPart}`;
};

const formatChange = (change: number | undefined) => {
  if (change === undefined || change === null || !Number.isFinite(change)) {
    return '--%';
  }
  return `${change.toFixed(2)}%`;
};

// 价格显示子组件 - 只更新价格相关部分
const PriceDisplay = (props: { price: PriceData }) => {
  const change = props.price.change24h;
  const isValidChange = change !== undefined && change !== null && Number.isFinite(change);
  const changeClass = isValidChange && change >= 0 ? 'up' : 'down';

  return (
    <div class="price-item__values">
      <span class="price-item__price">{formatPrice(props.price)}</span>
      <span class={`price-item__change ${changeClass}`}>
        {formatChange(change)}
      </span>
    </div>
  );
};

// 单个币种行组件 - 分离静态和动态部分
// 使用函数形式获取价格以建立响应式依赖
const CoinRow = (props: {
  coin: { symbol: string; baseAsset: string; name: string; logoUrl?: string };
  getPrice: (symbol: string) => PriceData | null;
  onNameClick?: () => void;
}) => {
  const { coin, getPrice, onNameClick } = props;
  const logoUrl = coin.logoUrl || getCoinCapLogoUrl(coin.baseAsset);

  // 响应式获取价格 - 每次 priceCache 变化都会重新计算
  const price = createMemo(() => getPrice(coin.symbol));

  // 记录 mousedown 位置，用于区分拖拽和点击
  let mouseDownPos: { x: number; y: number } | null = null;
  const DRAG_THRESHOLD = 5; // 移动超过 5px 视为拖拽

  const handleMouseDown = (e: MouseEvent) => {
    mouseDownPos = { x: e.clientX, y: e.clientY };
  };

  // 点击币种名称（区分拖拽）
  const handleNameClick = (e: MouseEvent) => {
    e.stopPropagation();

    // 如果是拖拽操作，不触发编辑
    if (mouseDownPos) {
      const dx = Math.abs(e.clientX - mouseDownPos.x);
      const dy = Math.abs(e.clientY - mouseDownPos.y);
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
        mouseDownPos = null;
        return;
      }
    }
    mouseDownPos = null;

    onNameClick?.();
  };

  return (
    <div class="price-item">
      {/* 静态部分：logo 和名称 - 不会因为价格更新而重新渲染 */}
      <div class="price-item__logo">
        <img
          src={logoUrl}
          alt={coin.baseAsset}
          class="price-item__logo-img"
          onError={(e) => {
            // 如果图片加载失败，隐藏图片元素
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      </div>
      <div
        class="price-item__main price-item__main--clickable"
        onMouseDown={handleMouseDown}
        onClick={handleNameClick}
      >
        <span class="price-item__symbol">{coin.baseAsset}</span>
        <span class="price-item__name">{coin.name}</span>
      </div>

      {/* 动态部分：价格显示 - 只有这部分会更新 */}
      <Show when={price() != null} fallback={
        <div class="price-item__values">
          <span class="price-item__loading">价格获取中</span>
        </div>
      }>
        <PriceDisplay price={price()!} />
      </Show>
    </div>
  );
};

import type { WidgetState, WatchlistSettings, WatchlistCoinSetting } from '../../config/widgetDefaults';
import { DEFAULT_WATCHLIST_SETTINGS } from '../../config/widgetDefaults';

/** Widget 组件接收的 props（由 GridContainer 传入） */
interface WatchlistWidgetProps {
  elementId?: string;
  state?: WidgetState;
  onStateChange?: (newState: WidgetState) => void;
}

export const WatchlistWidget = (props: WatchlistWidgetProps) => {
  // 从实例 state 获取设置，回落到默认值
  const getSettings = (): WatchlistSettings => {
    const settings = props.state?.settings as WatchlistSettings | undefined;
    // 如果已有保存的设置且有 coins 数组，使用它
    if (settings?.coins && Array.isArray(settings.coins) && settings.coins.length > 0) {
      return settings;
    }
    // 否则使用默认设置
    return { ...DEFAULT_WATCHLIST_SETTINGS };
  };

  // 从保存的设置转换为完整的 WatchlistCoinConfig（添加 logoUrl）
  const settingsToCoins = (settings: WatchlistSettings): WatchlistCoinConfig[] => {
    return settings.coins.map(coin => ({
      symbol: coin.symbol,
      baseAsset: coin.baseAsset,
      name: coin.name,
      logoUrl: getCoinCapLogoUrl(coin.baseAsset),
    }));
  };

  // 从 WatchlistCoinConfig 转换为保存设置（去掉 logoUrl）
  const coinsToSettings = (coins: WatchlistCoinConfig[]): WatchlistCoinSetting[] => {
    return coins.map(coin => ({
      symbol: coin.symbol,
      baseAsset: coin.baseAsset,
      name: coin.name,
    }));
  };

  const initialSettings = getSettings();
  const initialCoins = settingsToCoins(initialSettings);

  // 组件内部价格缓存 - 每次页面加载都是全新的（不使用 sessionStorage）
  const [priceCache, setPriceCache] = createSignal<Map<string, PriceData>>(new Map());
  const [connectionStatus, setConnectionStatus] = createSignal<ConnectionStatus>('idle');
  const [hasInitialData, setHasInitialData] = createSignal(priceCache().size > 0);
  // 用户自定义的币种配置（从 state 初始化）
  const [watchlistCoins, setWatchlistCoins] = createSignal<WatchlistCoinConfig[]>(initialCoins);
  // 编辑对话框状态
  const [isEditDialogOpen, setIsEditDialogOpen] = createSignal(false);
  const [editSlotIndex, setEditSlotIndex] = createSignal<number | undefined>(undefined);
  // 同步状态
  const [isSyncing, setIsSyncing] = createSignal(false);

  // 右键菜单
  const { ContextMenuComponent, showContextMenu, closeContextMenu } = useContextMenu();

  // 保存设置到实例 state（持久化）
  const saveSettings = (coins: WatchlistCoinConfig[]) => {
    if (!props.onStateChange) return;

    const coinSettings = coinsToSettings(coins);
    props.onStateChange({
      ...props.state,
      settings: {
        coins: coinSettings,
      } as WatchlistSettings,
    });
  };

  // 创建 symbol 到索引的映射
  const symbolToIndex = createMemo(() => {
    const map = new Map<string, number>();
    watchlistCoins().forEach((coin, index) => {
      map.set(coin.symbol, index);
    });
    return map;
  });

  // 更新缓存的辅助函数（带时间戳比较）
  const updateCache = (newData: PriceData) => {
    setPriceCache(prev => {
      const existing = prev.get(newData.symbol);
      // 如果不存在，或者新数据时间戳更晚，则更新
      if (!existing || newData.lastUpdate > existing.lastUpdate) {
        const newCache = new Map(prev);
        newCache.set(newData.symbol, newData);
        return newCache;
      }
      return prev;
    });
  };

  // 获取特定 symbol 的价格（从缓存）
  const getPrice = (symbol: string): PriceData | null => {
    return priceCache().get(symbol) || null;
  };

  // 检查数据是否新鲜
  const isDataFresh = (data: PriceData): boolean => {
    return Date.now() - data.lastUpdate < STALE_THRESHOLD_MS;
  };

  // 获取过期的 symbol 并刷新
  const refreshStaleSymbols = async (): Promise<void> => {
    const now = Date.now();
    const coins = watchlistCoins();
    const staleSymbols: WatchlistCoinConfig[] = [];

    for (const coin of coins) {
      const data = priceCache().get(coin.symbol);
      if (!data || now - data.lastUpdate >= STALE_THRESHOLD_MS) {
        staleSymbols.push(coin);
      }
    }

    if (staleSymbols.length === 0) {
      return;
    }

    // 并发获取过期的 symbol
    const results = await Promise.allSettled(
      staleSymbols.map(coin => fetch24hrTickerMiniSingle(coin.symbol, coin))
    );

    let updatedCount = 0;
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        updateCache(result.value);
        updatedCount++;
      } else {
        console.error(`[Watchlist] Failed to refresh ${staleSymbols[index].symbol}:`, result.reason);
      }
    });

    console.log(`[Watchlist] Refreshed ${updatedCount}/${staleSymbols.length} symbols`);
  };

  // 数据同步（右键菜单触发）
  const handleDataSync = async () => {
    if (isSyncing()) return;

    setIsSyncing(true);
    console.log('[Watchlist] Starting data sync...');

    try {
      // 1. 刷新币种列表缓存
      await fetchCoinList(true);
      console.log('[Watchlist] Coin list refreshed');

      // 2. 刷新当前监控的 symbol 价格
      const coins = watchlistCoins();
      const restData = await fetch24hrTickerMini(coins);
      updatePriceCacheBatch(restData);
      restData.forEach(data => updateCache(data));

      console.log('[Watchlist] Data sync completed');
    } catch (error) {
      console.error('[Watchlist] Data sync failed:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  // 右键菜单处理
  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const menuItems = [
      {
        label: isSyncing() ? '同步中...' : '数据同步',
        action: handleDataSync,
        disabled: isSyncing(),
      },
    ];

    // 合并默认菜单项
    const elementId = props.elementId;
    const finalItems = elementId
      ? mergeMenuItems(menuItems, elementId, false)
      : menuItems;

    showContextMenu(e.clientX, e.clientY, finalItems);
  };

  // 点击币种名称打开编辑对话框
  const handleCoinNameClick = (index: number) => {
    setEditSlotIndex(index);
    setIsEditDialogOpen(true);
  };

  // 编辑对话框确认
  const handleEditConfirm = (slotIndex: number, coin: CoinInfo) => {
    const newConfig: WatchlistCoinConfig = {
      symbol: coin.symbol,
      baseAsset: coin.baseAsset,
      name: coin.name,
      logoUrl: getCoinCapLogoUrl(coin.baseAsset),
    };

    // 更新 watchlistCoins
    let newCoins: WatchlistCoinConfig[] = [];
    setWatchlistCoins(prev => {
      newCoins = [...prev];
      newCoins[slotIndex] = newConfig;
      return newCoins;
    });

    // 持久化设置（保存到 chrome.storage）
    saveSettings(newCoins);

    // 立即获取新币种的价格
    fetch24hrTickerMiniSingle(coin.symbol, newConfig)
      .then(data => updateCache(data))
      .catch(err => console.error('[Watchlist] Failed to fetch new coin price:', err));

    // 重新订阅 WebSocket 以包含新的 symbol
    // 这会触发 binanceWsService.subscribe() 检测到 coins 变化并重连
    subscribeWatchlistPrices(newCoins, (priceData: PriceData) => {
      updateCache(priceData);
    });
  };

  // 获取当前编辑的槽位数据
  const getCurrentSlot = createMemo(() => {
    const index = editSlotIndex();
    if (index === undefined) return null;
    const coins = watchlistCoins();
    if (index < 0 || index >= coins.length) return null;
    const coin = coins[index];
    return {
      symbol: coin.symbol,
      baseAsset: coin.baseAsset,
      name: coin.name,
    };
  });

  onMount(() => {
    // 声明清理函数变量
    let unsubscribeStatus: (() => void) | undefined;
    let unsubscribePrices: (() => void) | undefined;
    let checkInterval: number | undefined;

    // 0. 连通性探测（确定数据源）
    (async () => {
      try {
        const result = await probeConnectivity();
        console.log(`[Watchlist] Data source: ${result.source}`);

        // 探测完成后加载币种列表
        const coinList = await fetchCoinList();
        console.log(`[Watchlist] Coin list loaded: ${coinList.coins.length} coins`);
      } catch (error) {
        console.error('[Watchlist] Connectivity probe failed:', error);
      }
    })();

    // 1. 订阅连接状态变化
    unsubscribeStatus = onConnectionStatusChange((status) => {
      setConnectionStatus(status);
    });

    // 2. WebSocket 订阅实时更新
    unsubscribePrices = subscribeWatchlistPrices(watchlistCoins(), (priceData: PriceData) => {
      updateCache(priceData);
    });

    // 3. 定期检查并刷新过期的数据（每30秒）
    checkInterval = window.setInterval(() => {
      refreshStaleSymbols();
    }, 30000);

    // 4. 初始化：通过 REST API 获取所有 symbol 的初始数据（异步）
    (async () => {
      try {
        const restData = await fetch24hrTickerMini(watchlistCoins());

        // 更新缓存并同步到 WebSocket 服务
        updatePriceCacheBatch(restData);
        restData.forEach(data => updateCache(data));
        setHasInitialData(true);
      } catch (error) {
        console.error('[Watchlist] Failed to fetch REST API data:', error);
      }
    })();

    // onCleanup 必须在同步部分调用
    onCleanup(() => {
      unsubscribeStatus?.();
      unsubscribePrices?.();
      if (checkInterval !== undefined) {
        clearInterval(checkInterval);
      }
    });
  });

  // 检查是否全部加载失败
  const allFailed = () => connectionStatus() === 'error' && !hasInitialData() && priceCache().size === 0;

  // 检查是否正在连接或已连接（有数据或正在获取）
  const isLoading = () => connectionStatus() === 'idle' || connectionStatus() === 'connecting';

  return (
    <div class="watchlist-widget" onContextMenu={handleContextMenu}>
      <div class="watchlist-widget__list">
        {/* 未连接状态：显示加载转圈 */}
        <Show when={isLoading()}>
          <div class="watchlist-widget__loading">
            <div class="spinner"></div>
            <span class="watchlist-widget__loading-text">连接中...</span>
          </div>
        </Show>

        {/* 连接失败状态：显示错误信息 */}
        <Show when={allFailed()}>
          <div class="watchlist-widget__error">
            <span class="watchlist-widget__error-icon">⚠</span>
            <span class="watchlist-widget__error-text">连接失败</span>
          </div>
        </Show>

        {/* 已连接状态：显示币种列表 */}
        <Show when={!isLoading() && !allFailed()}>
          <Index each={watchlistCoins()}>
            {(coinFn, index) => {
              const coin = coinFn();  // Index 的第一个参数是 getter 函数
              return (
                <CoinRow
                  coin={coin}
                  getPrice={getPrice}
                  onNameClick={() => handleCoinNameClick(index)}
                />
              );
            }}
          </Index>
        </Show>
      </div>

      {/* 右键菜单 */}
      <ContextMenuComponent />

      {/* 编辑对话框 */}
      <Show when={getCurrentSlot() !== null}>
        <WatchlistEditDialog
          isOpen={isEditDialogOpen()}
          onClose={() => setIsEditDialogOpen(false)}
          onConfirm={handleEditConfirm}
          currentSlot={getCurrentSlot()!}
          slotIndex={editSlotIndex()!}
        />
      </Show>

      <style>{`
        .watchlist-widget {
          background: #0a0b0d;
          border: 1px solid #1c1f24;
          border-radius: var(--radius-lg);
          padding: var(--space-sm);
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
        }

        .watchlist-widget__list {
          display: flex;
          flex-direction: column;
          flex: 1;
          overflow: hidden;
        }

        /* 加载状态 */
        .watchlist-widget__loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          gap: 8px;
        }

        .spinner {
          width: 24px;
          height: 24px;
          border: 2px solid rgba(255, 255, 255, 0.1);
          border-top-color: var(--text-primary);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .watchlist-widget__loading-text {
          font-size: 11px;
          color: var(--text-tertiary);
        }

        /* 错误状态 */
        .watchlist-widget__error {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          gap: 6px;
        }

        .watchlist-widget__error-icon {
          font-size: 20px;
        }

        .watchlist-widget__error-text {
          font-size: 11px;
          color: var(--red-down);
        }

        .price-item {
          display: flex;
          align-items: center;
          padding: 0 var(--space-xs);
          border-radius: var(--radius-sm);
          transition: background 0.15s ease;
          flex: 0 0 calc(100% / 5);
          min-height: 0;
          width: 100%;
          box-sizing: border-box;
        }

        .price-item:hover {
          background: rgba(255, 255, 255, 0.04);
        }

        .price-item__main {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0;
          max-width: 40%;
        }

        .price-item__main--clickable {
          cursor: pointer;
          border-radius: var(--radius-sm);
          padding: 2px 4px;
          margin: -2px -4px;
          transition: background 0.15s ease;
        }

        .price-item__main--clickable:hover {
          background: rgba(255, 255, 255, 0.08);
        }

        .price-item__symbol {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
          line-height: 1.2;
        }

        .price-item__name {
          font-size: 10px;
          color: var(--text-tertiary);
          line-height: 1;
        }

        .price-item__values {
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: flex-end;
          gap: 0;
          margin-left: auto;
          margin-right: 0;
          padding-right: 0;
        }

        .price-item__price {
          font-size: 14px;
          color: var(--text-primary);
          font-family: 'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace;
          font-feature-settings: "tnum";
          font-weight: 500;
          line-height: 1.1;
          margin: 0;
          padding: 0;
        }

        .price-item__change {
          font-size: 11px;
          font-family: 'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace;
          font-feature-settings: "tnum";
          font-weight: 500;
          line-height: 1;
          margin: 0;
          padding: 0;
        }

        .price-item__change.up {
          color: var(--green-up);
        }

        .price-item__change.down {
          color: var(--red-down);
        }

        .price-item__loading {
          font-size: 11px;
          color: var(--text-tertiary);
        }

        /* Logo 样式 */
        .price-item__logo {
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          margin-right: var(--space-xs);
        }

        .price-item__logo-img {
          width: 20px;
          height: 20px;
          object-fit: contain;
          border-radius: 50%;
        }
      `}</style>
    </div>
  );
};
