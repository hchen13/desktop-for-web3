/**
 * Rate Monitor Widget - 币圈汇率组件
 * 
 * 功能:
 * - 显示稳定币 (USDT/USDC) 与法币 (USD/CNY/JPY/KRW) 之间的汇率
 * - 支持切换货币对和交换显示方向
 * - 实时/同步状态指示 (参考 News 组件样式)
 * - 数据来源: CoinGecko (默认) + Upbit/Pyth (fallback)
 * - 使用 Portal 渲染下拉菜单，避免被父组件 overflow 裁剪
 * - 每个实例的设置独立存储在 GridElement.state.settings 中
 * 
 * 风格: Bloomberg Terminal Dark Theme
 */

import { createSignal, createMemo, createEffect, onMount, onCleanup, Show, For } from 'solid-js';
import { Portal } from '../layout/Portal';
import {
  rateMonitorService,
  type RateDataState,
  type Stablecoin,
  type FiatCurrency,
} from '../../services/rate-monitor';
import type { RateMonitorSettings, WidgetState } from '../../config/widgetDefaults';
import { DEFAULT_RATE_MONITOR_SETTINGS } from '../../config/widgetDefaults';
import './RateMonitorWidget.css';

// 货币配置
const STABLECOINS: Stablecoin[] = ['USDT', 'USDC'];
const FIAT_CURRENCIES: FiatCurrency[] = ['USD', 'CNY', 'JPY', 'KRW'];

// 货币显示名称
const CURRENCY_LABELS: Record<Stablecoin | FiatCurrency, string> = {
  USDT: 'USDT',
  USDC: 'USDC',
  USD: 'USD',
  CNY: 'CNY',
  JPY: 'JPY',
  KRW: 'KRW',
};

// 货币精度配置
const RATE_PRECISION: Record<FiatCurrency, number> = {
  USD: 4,  // USDT/USD ≈ 1.0001
  CNY: 2,  // USDT/CNY ≈ 7.24
  JPY: 1,  // USDT/JPY ≈ 153.8
  KRW: 0,  // USDT/KRW ≈ 1450
};

// 图标组件 - 使用函数返回新的 JSX，避免 SolidJS 复用同一个 DOM 节点
const SyncingIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" class="rate-monitor__sync-spin">
    <path
      d="M12 2C6.477 2 2 6.477 2 12C2 17.523 6.477 22 12 22C17.523 22 22 17.523 22 12"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
    />
  </svg>
);

const LiveDot = () => (
  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
    <circle cx="6" cy="6" r="4" fill="currentColor" class="rate-monitor__live-pulse" />
  </svg>
);

const SwapIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 7H20M20 7L16 3M20 7l-4 4" />
    <path d="M16 17H4M4 17l4-4M4 17l4 4" />
  </svg>
);

const USDT_LOGO = new URL('../../../design/widgets/rate-monitor/usdt-logo.png', import.meta.url).href;
const USDC_LOGO = new URL('../../../design/widgets/rate-monitor/usdc-logo.png', import.meta.url).href;

// 格式化汇率
function formatRate(rate: number | null, fiat: FiatCurrency, swapped: boolean): string {
  if (rate === null) return '--';
  
  const precision = swapped 
    ? Math.max(6 - RATE_PRECISION[fiat], 2) // 反向时需要更多小数位
    : RATE_PRECISION[fiat];
  
  return rate.toFixed(precision);
}

// 根据字符串长度计算字体大小
function getFontSize(rateStr: string): number {
  const len = rateStr.length;
  if (len <= 4) return 22;      // 7.24
  if (len <= 5) return 20;      // 153.8
  if (len <= 6) return 17;      // 1450.0 or 0.0065
  if (len <= 7) return 14;      // 0.00069
  return 12;                    // 0.000689 or longer
}

// 下拉菜单类型
type MenuType = 'stablecoin' | 'fiat' | null;

/** Widget 组件接收的 props（由 GridContainer 传入） */
interface RateMonitorWidgetProps {
  elementId?: string;
  state?: WidgetState;
  onStateChange?: (newState: WidgetState) => void;
}

export const RateMonitorWidget = (props: RateMonitorWidgetProps) => {
  // 从实例 state 获取设置，回落到默认值
  const getSettings = (): RateMonitorSettings => {
    const settings = props.state?.settings as RateMonitorSettings | undefined;
    return {
      stablecoin: settings?.stablecoin ?? DEFAULT_RATE_MONITOR_SETTINGS.stablecoin,
      fiat: settings?.fiat ?? DEFAULT_RATE_MONITOR_SETTINGS.fiat,
      swapped: settings?.swapped ?? DEFAULT_RATE_MONITOR_SETTINGS.swapped,
    };
  };
  
  const initialSettings = getSettings();
  
  const [dataState, setDataState] = createSignal<RateDataState>(rateMonitorService.getState());
  const [stablecoin, setStablecoin] = createSignal<Stablecoin>(initialSettings.stablecoin);
  const [fiat, setFiat] = createSignal<FiatCurrency>(initialSettings.fiat);
  const [swapped, setSwapped] = createSignal<boolean>(initialSettings.swapped);
  
  // 下拉菜单状态
  const [activeMenu, setActiveMenu] = createSignal<MenuType>(null);
  const [menuPosition, setMenuPosition] = createSignal<{ x: number; y: number }>({ x: 0, y: 0 });

  // 按钮引用
  let leftBtnRef: HTMLButtonElement | undefined;
  let rightBtnRef: HTMLButtonElement | undefined;

  let unsubscribe: (() => void) | null = null;

  // 保存设置到实例 state
  const saveSettings = (newSettings: Partial<RateMonitorSettings>) => {
    if (!props.onStateChange) return;
    
    const currentSettings = getSettings();
    const updatedSettings: RateMonitorSettings = {
      ...currentSettings,
      ...newSettings,
    };
    
    props.onStateChange({
      ...props.state,
      settings: updatedSettings,
    });
  };

  onMount(() => {
    unsubscribe = rateMonitorService.subscribe((newState) => {
      setDataState(newState);
    });
  });

  onCleanup(() => {
    unsubscribe?.();
  });

  // 获取当前显示的汇率
  const currentRate = () => {
    const state = dataState();
    const rate = state.rates[stablecoin()][fiat()];
    if (!rate) return null;

    if (swapped()) {
      return 1 / rate.rate;
    }

    return rate.rate;
  };

  // 格式化后的汇率字符串
  const rateString = createMemo(() => formatRate(currentRate(), fiat(), swapped()));

  // 动态字体大小
  const fontSize = createMemo(() => getFontSize(rateString()));

  // 背景 logo
  const backgroundLogo = createMemo(() => `url(${stablecoin() === 'USDT' ? USDT_LOGO : USDC_LOGO})`);

  // 切换稳定币
  const selectStablecoin = (coin: Stablecoin) => {
    setStablecoin(coin);
    saveSettings({ stablecoin: coin });
    setActiveMenu(null);
  };

  // 切换法币
  const selectFiat = (currency: FiatCurrency) => {
    setFiat(currency);
    saveSettings({ fiat: currency });
    setActiveMenu(null);
  };

  // 交换显示方向
  const handleSwap = () => {
    const newSwapped = !swapped();
    setSwapped(newSwapped);
    saveSettings({ swapped: newSwapped });
  };

  // 关闭菜单
  const closeMenu = () => {
    setActiveMenu(null);
  };

  // 打开菜单并计算位置
  const openMenu = (type: MenuType, btnRef: HTMLButtonElement | undefined) => {
    if (!btnRef) return;
    
    const rect = btnRef.getBoundingClientRect();
    setMenuPosition({
      x: rect.left + rect.width / 2,
      y: rect.bottom + 4,
    });
    setActiveMenu(type);
  };

  // 处理左侧按钮点击
  const handleLeftClick = (e: MouseEvent) => {
    e.stopPropagation();
    const menuType: MenuType = swapped() ? 'fiat' : 'stablecoin';
    if (activeMenu() === menuType) {
      closeMenu();
    } else {
      openMenu(menuType, leftBtnRef);
    }
  };

  // 处理右侧按钮点击
  const handleRightClick = (e: MouseEvent) => {
    e.stopPropagation();
    const menuType: MenuType = swapped() ? 'stablecoin' : 'fiat';
    if (activeMenu() === menuType) {
      closeMenu();
    } else {
      openMenu(menuType, rightBtnRef);
    }
  };

  // 左侧货币 (根据 swap 状态)
  const leftCurrency = () => swapped() ? fiat() : stablecoin();
  const rightCurrency = () => swapped() ? stablecoin() : fiat();

  return (
    <div class="rate-monitor">
      <div class="rate-monitor__ghost-logo" style={{ 'background-image': backgroundLogo() }} />
      {/* 状态指示器 */}
      <div class="rate-monitor__status">
        <Show
          when={dataState().status === 'syncing'}
          fallback={
            <div class="rate-monitor__status-content rate-monitor__status-content--live">
              <span class="rate-monitor__status-icon"><LiveDot /></span>
              <span class="rate-monitor__status-text">LIVE</span>
            </div>
          }
        >
          <div class="rate-monitor__status-content">
            <span class="rate-monitor__status-icon"><SyncingIcon /></span>
            <span class="rate-monitor__status-text">SYNCING</span>
          </div>
        </Show>
      </div>

      {/* 货币对选择器 */}
      <div class="rate-monitor__pair">
        {/* 左侧货币 */}
        <button
          ref={leftBtnRef}
          class="rate-monitor__currency-btn"
          onClick={handleLeftClick}
        >
          {CURRENCY_LABELS[leftCurrency()]}
        </button>

        {/* Swap 按钮 */}
        <button class="rate-monitor__swap-btn" onClick={handleSwap} aria-label="交换货币对">
          <SwapIcon />
        </button>

        {/* 右侧货币 */}
        <button
          ref={rightBtnRef}
          class="rate-monitor__currency-btn"
          onClick={handleRightClick}
        >
          {CURRENCY_LABELS[rightCurrency()]}
        </button>
      </div>

      {/* 汇率显示 */}
      <div class="rate-monitor__rate">
        <span
          class="rate-monitor__rate-value"
          style={{ 'font-size': `${fontSize()}px` }}
        >
          {rateString()}
        </span>
      </div>

      {/* 底部橙色装饰条 */}
      <div class="rate-monitor__footer" />

      {/* 下拉菜单使用 Portal 渲染到 body */}
      <Show when={activeMenu() !== null}>
        <Portal>
          <>
            {/* 点击外部关闭 overlay */}
            <div class="rate-monitor__overlay" onClick={closeMenu} />
            
            {/* 下拉菜单 */}
            <div
              class="rate-monitor__dropdown"
              style={{
                left: `${menuPosition().x}px`,
                top: `${menuPosition().y}px`,
              }}
            >
              <Show when={activeMenu() === 'stablecoin'}>
                <For each={STABLECOINS}>
                  {(coin) => (
                    <button
                      class="rate-monitor__dropdown-item"
                      classList={{ 'rate-monitor__dropdown-item--active': coin === stablecoin() }}
                      onClick={(e) => {
                        e.stopPropagation();
                        selectStablecoin(coin);
                      }}
                    >
                      {CURRENCY_LABELS[coin]}
                    </button>
                  )}
                </For>
              </Show>
              <Show when={activeMenu() === 'fiat'}>
                <For each={FIAT_CURRENCIES}>
                  {(currency) => (
                    <button
                      class="rate-monitor__dropdown-item"
                      classList={{ 'rate-monitor__dropdown-item--active': currency === fiat() }}
                      onClick={(e) => {
                        e.stopPropagation();
                        selectFiat(currency);
                      }}
                    >
                      {CURRENCY_LABELS[currency]}
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </>
        </Portal>
      </Show>
    </div>
  );
};

export default RateMonitorWidget;
