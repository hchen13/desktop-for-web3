/**
 * Watchlist Widget — 多源价格监控组件
 *
 * 接入 PriceService（src/services/prices）：
 *  - subscribe 时把当前监控的 symbol 集合喂给单例
 *  - 多 instance 共享同一份后台数据
 *  - 行点击：跳转对应资产详情页
 */

import { Show, onMount, onCleanup, createSignal, createMemo, Index } from 'solid-js';
import { priceService } from '../../services/prices/PriceService';
import { getAssetMeta, getLogoUrlChain } from '../../services/prices/assets';
import type { PriceSnapshot } from '../../services/prices/types';
import type { AssetMeta } from '../../services/prices/types';
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

function logoFor(meta: AssetMeta): string[] {
  return getLogoUrlChain(meta);
}

const PriceDisplay = (props: { snapshot: PriceSnapshot }) => {
  // 必须用 accessor 让 props 变化能被 reactive system 感知；
  // 直接 const change = props.snapshot.change24h 是一次性快照，prop 改了也不更新（SolidJS gotcha）
  const change = () => props.snapshot.change24h;
  const isValid = () => change() !== null && Number.isFinite(change());
  const cls = () => (isValid() && change()! >= 0 ? 'up' : 'down');
  return (
    <div class="price-item__values">
      <span class="price-item__price">{formatPrice(props.snapshot.price)}</span>
      <span class={`price-item__change ${cls()}`}>{formatChange(change())}</span>
    </div>
  );
};

interface CoinRowProps {
  setting: WatchlistCoinSetting;
  getSnapshot: (symbol: string) => PriceSnapshot | null;
  onNameClick?: () => void;
  onRowClick?: () => void;
}

const CoinRow = (props: CoinRowProps) => {
  const meta = createMemo(() => getAssetMeta(props.setting.symbol));
  const logoChain = createMemo<string[]>(() => {
    const m = meta();
    return m ? logoFor(m) : [];
  });
  const [logoIdx, setLogoIdx] = createSignal(0);
  const currentLogo = createMemo<string | null>(() => {
    const chain = logoChain();
    return chain.length > 0 && logoIdx() < chain.length ? chain[logoIdx()] : null;
  });
  const snap = createMemo(() => props.getSnapshot(props.setting.symbol));

  let mouseDownPos: { x: number; y: number } | null = null;

  const handleMouseDown = (e: MouseEvent) => {
    mouseDownPos = { x: e.clientX, y: e.clientY };
  };

  const handleNameClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (mouseDownPos) {
      const dx = Math.abs(e.clientX - mouseDownPos.x);
      const dy = Math.abs(e.clientY - mouseDownPos.y);
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
        mouseDownPos = null;
        return;
      }
    }
    mouseDownPos = null;
    props.onNameClick?.();
  };

  const handleRowClick = (e: MouseEvent) => {
    if (mouseDownPos) {
      const dx = Math.abs(e.clientX - mouseDownPos.x);
      const dy = Math.abs(e.clientY - mouseDownPos.y);
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
        mouseDownPos = null;
        return;
      }
    }
    mouseDownPos = null;
    props.onRowClick?.();
  };

  return (
    <div class="price-item" onMouseDown={handleMouseDown} onClick={handleRowClick}>
      <div class="price-item__logo">
        <Show
          when={currentLogo()}
          fallback={<span class="price-item__logo-fallback">{props.setting.symbol[0]}</span>}
        >
          <img
            src={currentLogo()!}
            alt={props.setting.symbol}
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
        <span class="price-item__symbol">{props.setting.symbol}</span>
        <span class="price-item__name">{props.setting.name}</span>
      </div>
      <Show
        when={snap() != null}
        fallback={
          <div class="price-item__values">
            <span class="price-item__loading">价格获取中</span>
          </div>
        }
      >
        <PriceDisplay snapshot={snap()!} />
      </Show>
    </div>
  );
};

interface WatchlistWidgetProps {
  elementId?: string;
  state?: WidgetState;
  onStateChange?: (newState: WidgetState) => void;
}

export const WatchlistWidget = (props: WatchlistWidgetProps) => {
  const getSettings = (): WatchlistSettings => {
    const settings = props.state?.settings as WatchlistSettings | undefined;
    if (settings?.coins && Array.isArray(settings.coins) && settings.coins.length > 0) {
      // 兼容旧格式（{symbol:'BTCUSDT', baseAsset:'BTC'}）
      const migrated: WatchlistCoinSetting[] = settings.coins.map((c) => {
        const anyC = c as unknown as {
          symbol: string;
          baseAsset?: string;
          name: string;
          category?: WatchlistCoinSetting['category'];
        };
        if (anyC.category) return c as WatchlistCoinSetting;
        const sym = anyC.baseAsset ?? anyC.symbol;
        return { symbol: sym, name: anyC.name, category: 'crypto' };
      });
      return { coins: migrated };
    }
    return { ...DEFAULT_WATCHLIST_SETTINGS };
  };

  const initialSettings = getSettings();
  const [coins, setCoins] = createSignal<WatchlistCoinSetting[]>(initialSettings.coins);
  const [snapshots, setSnapshots] = createSignal<Map<string, PriceSnapshot>>(new Map());
  const [isEditDialogOpen, setIsEditDialogOpen] = createSignal(false);
  const [editSlotIndex, setEditSlotIndex] = createSignal<number | undefined>(undefined);

  const { ContextMenuComponent, showContextMenu } = useContextMenu();

  const getSnapshot = (symbol: string): PriceSnapshot | null => {
    return snapshots().get(symbol) ?? null;
  };

  const saveSettings = (next: WatchlistCoinSetting[]) => {
    if (!props.onStateChange) return;
    props.onStateChange({
      ...props.state,
      settings: { coins: next } as WatchlistSettings,
    });
  };

  // 当前订阅 unsubscribe
  let unsubscribe: (() => void) | null = null;

  const subscribeToService = () => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    const symbols = new Set(coins().map((c) => c.symbol));
    unsubscribe = priceService.subscribe(symbols, (snap) => {
      setSnapshots(new Map(snap));
    });
  };

  const handleEditConfirm = (slotIndex: number, asset: AssetMeta) => {
    const next = coins().slice();
    next[slotIndex] = {
      symbol: asset.symbol,
      name: asset.name,
      category: asset.category,
    };
    setCoins(next);
    saveSettings(next);
    subscribeToService();
    void priceService.refresh(new Set([asset.symbol]));
  };

  const handleCoinNameClick = (idx: number) => {
    setEditSlotIndex(idx);
    setIsEditDialogOpen(true);
  };

  const handleRowClick = (idx: number) => {
    const setting = coins()[idx];
    if (!setting) return;
    const meta = getAssetMeta(setting.symbol);
    if (!meta) return;
    const url = getDetailUrl(meta);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const items = [
      {
        label: '刷新价格',
        action: () => {
          void priceService.refresh();
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

  onMount(() => {
    subscribeToService();
    onCleanup(() => {
      unsubscribe?.();
      unsubscribe = null;
    });
  });

  return (
    <div class="watchlist-widget" onContextMenu={handleContextMenu}>
      <div class="watchlist-widget__list">
        <Index each={coins()}>
          {(coinFn, index) => (
            <CoinRow
              setting={coinFn()}
              getSnapshot={getSnapshot}
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
          cursor: pointer;
        }
        .price-item:hover { background: rgba(255, 255, 255, 0.04); }
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
        .price-item__main--clickable:hover { background: rgba(255, 255, 255, 0.08); }
        .price-item__symbol {
          font-size: 14px; font-weight: 600;
          color: var(--text-primary); line-height: 1.2;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .price-item__name {
          font-size: 10px; color: var(--text-tertiary); line-height: 1;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
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
        .price-item__change {
          font-size: 11px;
          font-family: 'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace;
          font-feature-settings: "tnum"; font-weight: 500;
          line-height: 1; margin: 0; padding: 0;
        }
        .price-item__change.up { color: var(--green-up); }
        .price-item__change.down { color: var(--red-down); }
        .price-item__loading { font-size: 11px; color: var(--text-tertiary); }
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
          background: rgba(255, 255, 255, 0.1);
          color: rgba(255, 255, 255, 0.7);
          font-size: 10px; font-weight: 700;
          font-family: var(--font-mono, monospace);
        }
      `}</style>
    </div>
  );
};
