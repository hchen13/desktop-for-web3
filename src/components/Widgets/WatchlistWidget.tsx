/**
 * Watchlist Widget —— 交易所参考价监控组件
 *
 * 接入 PriceService（src/services/prices）：
 *  - 用稳定的 PriceSubscription handle，换币只更新 AssetKey 集合，不重建订阅
 *  - 换币后立即 targeted 刷新一次，不等下一轮 timer，也不需要刷新页面
 *  - 行点击：跳转对应资产详情页
 *
 * 展示的是交易所提供的股票关联产品参考价，change24h 是该产品自身的滚动 24 小时
 * 变化，不是美股相对上一常规交易日收盘的涨跌。
 */

import { Show, onMount, onCleanup, createSignal, createMemo, createEffect, Index } from 'solid-js';
import { priceService } from '../../services/prices/PriceService';
import { getCuratedAsset, getLogoUrlChain } from '../../services/prices/assets';
import { assetKeyFromSetting, assetKeySymbol } from '../../services/prices/assetKey';
import { fallbackMetaFor } from '../../services/prices/instrumentResolver';
import { describeCoverage } from '../../services/prices/aggregate';
import type {
  AssetKey,
  AssetMeta,
  PriceSnapshot,
  PriceSubscription,
} from '../../services/prices/types';
import { useContextMenu } from '../layout/ContextMenu';
import { mergeMenuItems } from '../../grid/contextMenuUtils';
import { WatchlistEditDialog } from './WatchlistEditDialog';

import type {
  WidgetState,
  WatchlistSettings,
  WatchlistCoinSetting,
} from '../../config/widgetDefaults';
import { DEFAULT_WATCHLIST_SETTINGS } from '../../config/widgetDefaults';

const DRAG_THRESHOLD = 5;
const MISSING_PRICE_RETRY_DELAY_MS = 12000;
const STALE_PRICE_MS = 5 * 60 * 1000;

const formatPrice = (price: number): string => {
  if (!Number.isFinite(price)) return '--';
  if (price >= 1) {
    return `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }
  // 小价位多保留几位
  return `$${price.toLocaleString('en-US', { maximumFractionDigits: 8 }).replace(/0+$/, '').replace(/\.$/, '')}`;
};

const formatChange = (change: number | null): string => {
  if (change === null || !Number.isFinite(change)) return '--%';
  return `${change.toFixed(2)}%`;
};

function metaFor(assetKey: AssetKey): AssetMeta | null {
  return getCuratedAsset(assetKey) ?? fallbackMetaFor(assetKey);
}

function getDetailUrl(meta: AssetMeta): string {
  switch (meta.category) {
    case 'crypto':
      return `https://www.coingecko.com/en/coins/${meta.logoSlug ?? meta.symbol.toLowerCase()}`;
    case 'stock':
    case 'etf':
      return `https://finance.yahoo.com/quote/${encodeURIComponent(meta.symbol)}`;
    case 'fx':
      return `https://www.tradingview.com/symbols/${encodeURIComponent(meta.symbol)}/`;
    case 'commodity':
      return `https://www.tradingview.com/symbols/${encodeURIComponent(meta.symbol)}USD/`;
    default:
      return `https://www.google.com/search?q=${encodeURIComponent(meta.symbol)}`;
  }
}

/** 价格 tooltip：交易所参考价 + 参与 venues + coverage tier */
function describeSnapshot(snapshot: PriceSnapshot): string {
  const venues = snapshot.sources.length > 0 ? snapshot.sources.join(' / ') : '无';
  return [
    '交易所参考价',
    `来源：${venues}`,
    `覆盖：${describeCoverage(snapshot)}`,
    `计价：${snapshot.quoteCurrency}`,
  ].join('\n');
}

const PriceDisplay = (props: { snapshot: PriceSnapshot; now: number }) => {
  // 必须用 accessor 让 props 变化能被 reactive system 感知；
  // 直接 const change = props.snapshot.change24h 是一次性快照，prop 改了也不更新（SolidJS gotcha）
  const change = () => props.snapshot.change24h;
  const isValid = () => change() !== null && Number.isFinite(change());
  const cls = () => (isValid() && change()! >= 0 ? 'up' : 'down');
  const isStale = () =>
    props.snapshot.quality !== 'live' || props.now - props.snapshot.lastUpdate > STALE_PRICE_MS;
  return (
    <div class="price-item__values">
      <span
        classList={{
          'price-item__price': true,
          'price-item__price--stale': isStale(),
        }}
        title={describeSnapshot(props.snapshot)}
      >
        {formatPrice(props.snapshot.price)}
      </span>
      <span class={`price-item__change ${cls()}`}>{formatChange(change())}</span>
    </div>
  );
};

interface CoinRowProps {
  setting: WatchlistCoinSetting;
  assetKey: AssetKey;
  getSnapshot: (assetKey: AssetKey) => PriceSnapshot | null;
  isDataLate: boolean;
  now: number;
  onNameClick?: () => void;
  onRowClick?: () => void;
}

const CoinRow = (props: CoinRowProps) => {
  const meta = createMemo(() => metaFor(props.assetKey));
  const logoChain = createMemo<string[]>(() => {
    const m = meta();
    return m ? getLogoUrlChain(m) : [];
  });
  const [logoIdx, setLogoIdx] = createSignal(0);
  const currentLogo = createMemo<string | null>(() => {
    const chain = logoChain();
    return chain.length > 0 && logoIdx() < chain.length ? chain[logoIdx()] : null;
  });
  const snap = createMemo(() => props.getSnapshot(props.assetKey));
  const isUnavailable = createMemo(() => snap()?.quality === 'unavailable');
  // unavailable 且没有任何缓存价时只显示状态文案，不显示 $0
  const hasPrice = createMemo(() => {
    const s = snap();
    return s != null && s.lastUpdate > 0;
  });
  const displaySymbol = createMemo(() => meta()?.symbol ?? assetKeySymbol(props.assetKey));

  let mouseDownPos: { x: number; y: number } | null = null;

  const isClick = (e: MouseEvent): boolean => {
    if (!mouseDownPos) return true;
    const dx = Math.abs(e.clientX - mouseDownPos.x);
    const dy = Math.abs(e.clientY - mouseDownPos.y);
    mouseDownPos = null;
    return dx <= DRAG_THRESHOLD && dy <= DRAG_THRESHOLD;
  };

  const handleMouseDown = (e: MouseEvent) => {
    mouseDownPos = { x: e.clientX, y: e.clientY };
  };

  const handleNameClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (isClick(e)) props.onNameClick?.();
  };

  const handleRowClick = (e: MouseEvent) => {
    if (isClick(e)) props.onRowClick?.();
  };

  return (
    <div class="price-item" onMouseDown={handleMouseDown} onClick={handleRowClick}>
      <div class="price-item__logo">
        <Show
          when={currentLogo()}
          fallback={<span class="price-item__logo-fallback">{displaySymbol()[0]}</span>}
        >
          <img
            src={currentLogo()!}
            alt={displaySymbol()}
            class="price-item__logo-img"
            onError={() => {
              // 按 chain 顺序换下一个 URL；最后一个也失败则进入 fallback 占位
              const next = logoIdx() + 1;
              if (next < logoChain().length) setLogoIdx(next);
              else setLogoIdx(logoChain().length); // 超 length → currentLogo 返 null → fallback 显示
            }}
          />
        </Show>
      </div>
      <div class="price-item__main price-item__main--clickable" onClick={handleNameClick}>
        <span class="price-item__symbol">{displaySymbol()}</span>
        <span class="price-item__name">{props.setting.name}</span>
      </div>
      <Show
        when={hasPrice()}
        fallback={
          <div class="price-item__values">
            <span class="price-item__loading">
              {isUnavailable() ? '暂无可用市场' : props.isDataLate ? '数据源重试中' : '价格获取中'}
            </span>
          </div>
        }
      >
        <div class="price-item__values-wrap">
          <PriceDisplay snapshot={snap()!} now={props.now} />
          <Show when={isUnavailable()}>
            <span class="price-item__notice">暂无可用市场</span>
          </Show>
        </div>
      </Show>
    </div>
  );
};

interface WatchlistWidgetProps {
  elementId?: string;
  state?: WidgetState;
  /** 所在 layout 是否 active；keep-alive 的隐藏 layout 不应贡献行情订阅 */
  isActiveLayout?: boolean;
  onStateChange?: (newState: WidgetState) => void;
}

export const WatchlistWidget = (props: WatchlistWidgetProps) => {
  const getSettings = (): WatchlistSettings => {
    const settings = props.state?.settings as WatchlistSettings | undefined;
    if (settings?.coins && Array.isArray(settings.coins) && settings.coins.length > 0) {
      return { coins: settings.coins.map(migrateSetting) };
    }
    return { ...DEFAULT_WATCHLIST_SETTINGS };
  };

  const initialSettings = getSettings();
  const [coins, setCoins] = createSignal<WatchlistCoinSetting[]>(initialSettings.coins);
  const [snapshots, setSnapshots] = createSignal<Map<AssetKey, PriceSnapshot>>(new Map());
  const [isEditDialogOpen, setIsEditDialogOpen] = createSignal(false);
  const [editSlotIndex, setEditSlotIndex] = createSignal<number | undefined>(undefined);
  const [loadStartedAt, setLoadStartedAt] = createSignal(Date.now());
  const [now, setNow] = createSignal(Date.now());

  const { ContextMenuComponent, showContextMenu } = useContextMenu();

  const assetKeys = createMemo<AssetKey[]>(() =>
    coins().map((coin) => assetKeyFromSetting(coin) ?? `crypto:${coin.symbol.toUpperCase()}`),
  );

  const getSnapshot = (assetKey: AssetKey): PriceSnapshot | null => {
    return snapshots().get(assetKey) ?? null;
  };

  const saveSettings = (next: WatchlistCoinSetting[]) => {
    if (!props.onStateChange) return;
    props.onStateChange({
      ...props.state,
      settings: { coins: next } as WatchlistSettings,
    });
  };

  let subscription: PriceSubscription | null = null;

  const handleEditConfirm = (slotIndex: number, asset: AssetMeta) => {
    const next = coins().slice();
    next[slotIndex] = {
      symbol: asset.symbol,
      name: asset.name,
      category: asset.category,
      assetKey: `${asset.category}:${asset.symbol.toUpperCase()}`,
    };
    setCoins(next);
    saveSettings(next);
  };

  const handleCoinNameClick = (idx: number) => {
    setEditSlotIndex(idx);
    setIsEditDialogOpen(true);
  };

  const handleRowClick = (idx: number) => {
    const key = assetKeys()[idx];
    if (!key) return;
    const meta = metaFor(key);
    if (!meta) return;
    window.open(getDetailUrl(meta), '_blank', 'noopener,noreferrer');
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const items = [
      {
        label: '刷新价格',
        action: () => {
          void priceService.refreshAssets(new Set(assetKeys()));
        },
      },
    ];
    const elementId = props.elementId;
    const final = elementId ? mergeMenuItems(items, elementId, false) : items;
    showContextMenu(e.clientX, e.clientY, final);
  };

  const getCurrentSlot = createMemo(() => {
    const idx = editSlotIndex();
    if (idx === undefined) return null;
    const c = coins()[idx];
    if (!c) return null;
    return { symbol: c.symbol, name: c.name, category: c.category };
  });

  const rowCount = createMemo(() => Math.max(coins().length, 1));
  const isDataLate = createMemo(() => now() - loadStartedAt() > MISSING_PRICE_RETRY_DELAY_MS);

  // 换币只更新稳定 handle 的 AssetKey 集合；PriceService 会立即 targeted 刷新新资产
  createEffect(() => {
    const keys = new Set(assetKeys());
    if (!subscription) return;
    setLoadStartedAt(Date.now());
    subscription.updateAssets(keys);
  });

  createEffect(() => {
    const active = props.isActiveLayout !== false;
    subscription?.setActive(active);
  });

  onMount(() => {
    subscription = priceService.subscribe(new Set(assetKeys()), (next) => {
      setSnapshots(new Map(next));
    });
    subscription.setActive(props.isActiveLayout !== false);
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 30000);
    onCleanup(() => {
      subscription?.unsubscribe();
      subscription = null;
      clearInterval(timer);
    });
  });

  return (
    <div
      class="watchlist-widget"
      style={{ '--watchlist-row-count': String(rowCount()) }}
      onContextMenu={handleContextMenu}
    >
      <div class="watchlist-widget__list">
        <Index each={coins()}>
          {(coinFn, index) => (
            <CoinRow
              setting={coinFn()}
              assetKey={assetKeys()[index]}
              getSnapshot={getSnapshot}
              isDataLate={isDataLate()}
              now={now()}
              onNameClick={() => handleCoinNameClick(index)}
              onRowClick={() => handleRowClick(index)}
            />
          )}
        </Index>
      </div>

      <ContextMenuComponent />

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
          background: var(--widget-bg);
          border: var(--widget-border);
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
          overflow-y: auto;
          min-height: 0;
          scrollbar-width: none;
        }
        .watchlist-widget__list::-webkit-scrollbar {
          display: none;
        }
        .price-item {
          display: flex;
          align-items: center;
          padding: 0 var(--space-xs);
          border-radius: var(--radius-sm);
          transition: background 0.15s ease;
          flex: 0 0 max(32px, calc(100% / var(--watchlist-row-count)));
          min-height: 0;
          width: 100%;
          box-sizing: border-box;
          cursor: pointer;
        }
        .price-item:hover { background: var(--bg-control); }
        .price-item__main {
          display: flex; flex-direction: column;
          justify-content: center; gap: 0;
          max-width: 40%; min-width: 0; flex: 1 1 auto;
        }
        .price-item__main--clickable {
          cursor: pointer; border-radius: var(--radius-sm);
          padding: 2px 4px; margin: -2px -4px;
          transition: background 0.15s ease;
        }
        .price-item__main--clickable:hover { background: var(--bg-control-hover); }
        .price-item__symbol {
          font-size: 14px; font-weight: 600;
          color: var(--text-primary); line-height: 1.2;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .price-item__name {
          font-size: 10px; color: var(--text-tertiary); line-height: 1;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .price-item__values-wrap {
          display: flex; flex-direction: column; align-items: flex-end;
          margin-left: auto;
        }
        .price-item__values {
          display: flex; flex-direction: column;
          justify-content: center; align-items: flex-end;
          gap: 0; margin-left: auto; margin-right: 0; padding-right: 0;
        }
        .price-item__price {
          font-size: 14px; color: var(--text-primary);
          font-family: 'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace;
          font-feature-settings: "tnum"; font-weight: 500;
          line-height: 1.1; margin: 0; padding: 0;
        }
        .price-item__price--stale {
          color: var(--text-tertiary);
        }
        .price-item__change {
          font-size: 11px;
          font-family: 'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace;
          font-feature-settings: "tnum"; font-weight: 500;
          line-height: 1; margin: 0; padding: 0;
        }
        .price-item__change.up { color: var(--green-up); }
        .price-item__change.down { color: var(--red-down); }
        .price-item__loading { font-size: 11px; color: var(--text-tertiary); }
        .price-item__notice { font-size: 9px; color: var(--text-tertiary); line-height: 1; }
        .price-item__logo {
          width: 20px; height: 20px;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; margin-right: var(--space-xs);
        }
        .price-item__logo-img {
          width: 20px; height: 20px;
          object-fit: contain; border-radius: 50%;
        }
        .price-item__logo-fallback {
          width: 20px; height: 20px;
          display: inline-flex; align-items: center; justify-content: center;
          border-radius: 50%;
          background: var(--bg-control-active);
          color: var(--text-secondary);
          font-size: 10px; font-weight: 700;
          font-family: var(--font-mono, monospace);
        }
      `}</style>
    </div>
  );
};

/** 兼容旧格式：{symbol:'BTCUSDT', baseAsset:'BTC'} 与 category+symbol，统一补上 assetKey */
function migrateSetting(coin: WatchlistCoinSetting): WatchlistCoinSetting {
  const key = assetKeyFromSetting(coin);
  if (!key) return coin;
  const meta = getCuratedAsset(key);
  return {
    symbol: meta?.symbol ?? assetKeySymbol(key),
    name: meta?.name ?? coin.name ?? assetKeySymbol(key),
    category: meta?.category ?? coin.category ?? 'crypto',
    assetKey: key,
  };
}
