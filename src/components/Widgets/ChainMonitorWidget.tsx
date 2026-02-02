/**
 * ChainMonitor Widget - 链上监控组件
 * 新UI设计：单链显示，支持链选择器
 * 每个实例的设置独立存储在 GridElement.state.settings 中
 */

import { Show, onMount, onCleanup, createSignal, For, createEffect } from 'solid-js';
import { Portal } from '../layout/Portal';
import { useContextMenu } from '../layout/ContextMenu';
import type { ContextMenuItem } from '../layout/ContextMenu';
import { mergeMenuItems, getElementIdFromEvent } from '../../grid/contextMenuUtils';
import { SUPPORTED_CHAINS, getChainConfig, DEFAULT_CHAINS, isChainSupported } from '../../config/chainMonitorConfig';
import type { ChainId, ChainMetrics } from '../../services/chain-monitor/types';
import { getDominantColor } from '../../utils/imageColorExtractor';
import { chainMonitorService } from '../../services/chain-monitor/chainMonitorService';
import { formatMetricsForUI } from '../../utils/formatters';
import type { ChainMonitorSettings, WidgetState } from '../../config/widgetDefaults';
import { DEFAULT_CHAIN_MONITOR_SETTINGS } from '../../config/widgetDefaults';
import './ChainMonitorWidget.css';

// SVG Icons
const activeAddressIcon = '/icons/blockchain-monitor/activeAddress.svg';
const timeIcon = '/icons/blockchain-monitor/time.svg';
const gasIcon = '/icons/blockchain-monitor/gas.svg';
const tpsIcon = '/icons/blockchain-monitor/tps.svg';
const tvlIcon = '/icons/blockchain-monitor/tvl.svg';


// 获取链的颜色
const getChainColor = (chainId: ChainId): string => {
  const colors: Record<ChainId, string> = {
    eth: '#4CAF50', // 绿色
    btc: '#F7931A', // 橙色
    sol: '#9945FF', // 紫色
    bsc: '#F3BA2F', // 黄色
    polygon: '#8247E5', // 蓝色
  };
  return colors[chainId] || '#4CAF50';
};

// 将 RGB 格式转换为 hex 格式
const rgbToHex = (rgb: string): string => {
  const match = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!match) {
    return rgb; // 如果已经是 hex 格式，直接返回
  }
  const r = parseInt(match[1]);
  const g = parseInt(match[2]);
  const b = parseInt(match[3]);
  return `#${[r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('')}`;
};

// 链选择器下拉菜单
const ChainSelector = (props: {
  selectedChain: ChainId;
  isOpen: boolean;
  onSelect: (chain: ChainId) => void;
  onToggle: () => void;
  onClose: () => void;
  triggerRef?: HTMLButtonElement | undefined;
  activeAddresses?: number;
  activeAddressesUnit?: string;
}) => {
  const [dropdownPosition, setDropdownPosition] = createSignal({ top: 0, left: 0 });
  let internalTriggerRef: HTMLButtonElement | undefined;

  // 使用传入的ref或内部ref
  const actualTriggerRef = () => props.triggerRef || internalTriggerRef;

  // 计算下拉菜单位置
  const updateDropdownPosition = () => {
    const ref = actualTriggerRef();
    if (ref) {
      const rect = ref.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left,
      });
    }
  };

  // 当打开状态变化时更新位置
  createEffect(() => {
    if (props.isOpen) {
      updateDropdownPosition();
    }
  });

  // 点击外部关闭
  const handleClickOutside = (e: MouseEvent) => {
    const ref = actualTriggerRef();
    if (ref && !ref.contains(e.target as Node)) {
      const dropdown = document.querySelector('.chain-selector__dropdown');
      if (dropdown && !dropdown.contains(e.target as Node)) {
        props.onClose();
      }
    }
  };

  // ESC 键关闭
  const handleEscapeKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      props.onClose();
    }
  };

  // 动态管理事件监听器
  createEffect(() => {
    if (props.isOpen) {
      updateDropdownPosition();
      document.addEventListener('click', handleClickOutside, true);
      document.addEventListener('keydown', handleEscapeKey, true);
      window.addEventListener('scroll', updateDropdownPosition, true);
      window.addEventListener('resize', updateDropdownPosition);
    } else {
      document.removeEventListener('click', handleClickOutside, true);
      document.removeEventListener('keydown', handleEscapeKey, true);
      window.removeEventListener('scroll', updateDropdownPosition, true);
      window.removeEventListener('resize', updateDropdownPosition);
    }
  });

  onCleanup(() => {
    document.removeEventListener('click', handleClickOutside, true);
    document.removeEventListener('keydown', handleEscapeKey, true);
    window.removeEventListener('scroll', updateDropdownPosition, true);
    window.removeEventListener('resize', updateDropdownPosition);
  });

  return (
    <div class="chain-selector">
      <button
        ref={(el) => {
          if (props.triggerRef) {
            (props.triggerRef as any).current = el;
          } else {
            internalTriggerRef = el;
          }
        }}
        class="chain-selector__trigger"
        onClick={(e) => {
          e.stopPropagation();
          props.onToggle();
          setTimeout(updateDropdownPosition, 0);
        }}
        aria-haspopup="listbox"
        aria-expanded={props.isOpen}
      >
        <div class="chain-selector__icon">
          <img
            src={getChainConfig(props.selectedChain)?.logoUrl || ''}
            alt={getChainConfig(props.selectedChain)?.name || 'Chain'}
            class="chain-selector__icon-img"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
        <span class="chain-selector__name">
          {getChainConfig(props.selectedChain)?.name || 'Ethereum'}
        </span>
        <span class="chain-selector__chevron">{props.isOpen ? '▲' : '▼'}</span>
      </button>

      <Show when={props.activeAddresses !== undefined}>
        <div class="chain-selector__users-badge">
          <span class="chain-selector__users-dot"></span>
          <span class="chain-selector__users-text">
            {props.activeAddresses || 0}
            {props.activeAddressesUnit || 'k'}
          </span>
        </div>
      </Show>

      <Show when={props.isOpen}>
        <Portal>
          <div
            class="chain-selector__dropdown"
            role="listbox"
            style={{
              top: `${dropdownPosition().top}px`,
              left: `${dropdownPosition().left}px`,
            }}
          >
            <ul class="chain-selector__dropdown-list">
              <For each={SUPPORTED_CHAINS}>
                {(chain) => {
                  const isSelected = chain.id === props.selectedChain;
                  return (
                    <li
                      class="chain-selector__option"
                      classList={{ 'chain-selector__option--selected': isSelected }}
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => props.onSelect(chain.id as ChainId)}
                    >
                      <div class="chain-selector__option-icon">
                        <img
                          src={chain.logoUrl}
                          alt={chain.name}
                          class="chain-selector__option-icon-img"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </div>
                      <span class="chain-selector__option-name">{chain.name}</span>
                    </li>
                  );
                }}
              </For>
            </ul>
          </div>
        </Portal>
      </Show>
    </div>
  );
};

// EVM链的默认UI（图1）
const EVMChainView = (props: {
  chain: ChainId;
  data: any;
  onChainSelect: (chain: ChainId) => void;
  isSelectorOpen: boolean;
  onToggleSelector: () => void;
  onCloseSelector: () => void;
  chainColor?: string;
  activeAddresses?: number;
  activeAddressesUnit?: string;
}) => {
  const chainColor = () => props.chainColor || getChainColor(props.chain);
  const chainConfig = getChainConfig(props.chain);

  return (
    <div class="chain-monitor-card chain-monitor-card--evm">
      {/* Header */}
      <header class="chain-monitor-card__header">
        <ChainSelector
          selectedChain={props.chain}
          isOpen={props.isSelectorOpen}
          onSelect={props.onChainSelect}
          onToggle={props.onToggleSelector}
          onClose={props.onCloseSelector}
          activeAddresses={props.activeAddresses}
          activeAddressesUnit={props.activeAddressesUnit}
        />
        {/* Active Users Badge */}
        <div class="chain-monitor-card__users-badge chain-monitor-card__users-badge--evm" style={{ color: chainColor() }}>
          <div
            class="chain-monitor-card__users-icon"
            style={`mask-image: url(${activeAddressIcon}); -webkit-mask-image: url(${activeAddressIcon}); mask-size: contain; -webkit-mask-size: contain; mask-repeat: no-repeat; -webkit-mask-repeat: no-repeat; mask-position: center; -webkit-mask-position: center; background-color: ${chainColor() || '#FFFFFF'};`}
            role="img"
            aria-label="Active Addresses"
          />
          <Show when={props.data.activeAddresses !== null && props.data.activeAddresses !== undefined} fallback={
            <span class="chain-monitor-card__users-text">--</span>
          }>
            <span class="chain-monitor-card__users-text">
              {props.data.activeAddresses}
            </span>
          </Show>
        </div>
      </header>

      {/* Body - Metrics Grid (2x2) */}
      <div class="chain-monitor-card__body">
        <main class="chain-monitor-card__metrics">
        {/* BLOCK */}
        <div class="chain-metric chain-metric--block">
          <div class="chain-metric__header">
            <span class="chain-metric__label">BLOCK</span>
            <img src={timeIcon} alt="Block Time" class="chain-metric__icon" />
          </div>
          <div class="chain-metric__value-container">
            <Show when={props.data.blockDelay !== null && props.data.blockDelay !== undefined} fallback={
              <span class="chain-metric__value">--</span>
            }>
              <span class="chain-metric__value">{props.data.blockDelay}</span>
              <span class="chain-metric__unit">s</span>
            </Show>
          </div>
        </div>

        {/* GAS */}
        <div class="chain-metric chain-metric--gas">
          <div class="chain-metric__header">
            <span class="chain-metric__label">GAS</span>
            <img src={gasIcon} alt="Gas Price" class="chain-metric__icon" />
          </div>
          <div class="chain-metric__value-container">
            <Show when={props.data.gasPrice !== null && props.data.gasPrice !== undefined} fallback={
              <span class="chain-metric__value">--</span>
            }>
              <span class="chain-metric__value">{props.data.gasPrice}</span>
            </Show>
            <Show when={props.data.gasUnit}>
              <span
                class="chain-metric__unit"
                classList={{ 'chain-metric__unit--sol': props.chain === 'sol' }}
                style={{ color: chainColor() }}
              >
                {props.data.gasUnit}
              </span>
            </Show>
          </div>
        </div>

        {/* TPS */}
        <div class="chain-metric chain-metric--tps">
          <div class="chain-metric__header">
            <span class="chain-metric__label">TPS</span>
            <img src={tpsIcon} alt="TPS" class="chain-metric__icon" />
          </div>
          <div class="chain-metric__value-container">
            <Show when={props.data.tps !== null && props.data.tps !== undefined} fallback={
              <span class="chain-metric__value">--</span>
            }>
              <span class="chain-metric__value">{props.data.tps}</span>
            </Show>
          </div>
        </div>

        {/* TVL */}
        <div class="chain-metric chain-metric--tvl">
          <div class="chain-metric__header">
            <span class="chain-metric__label">TVL</span>
            <img src={tvlIcon} alt="TVL" class="chain-metric__icon" />
          </div>
          <div class="chain-metric__value-container">
            <Show when={props.data.tvl !== null && props.data.tvl !== undefined} fallback={
              <span class="chain-metric__value">--</span>
            }>
              <span class="chain-metric__value">${props.data.tvl}</span>
            </Show>
          </div>
        </div>
        </main>

        {/* Progress Bar - 底部装饰线 */}
        <div class="chain-monitor-card__progress">
          <div
            class="chain-monitor-card__progress-segment"
            style={{
              'background-color': chainColor(),
              width: '100%',
            }}
          />
        </div>
      </div>
    </div>
  );
};

// BTC的特殊UI（图2）
const BTCChainView = (props: {
  data: any;
  onChainSelect: (chain: ChainId) => void;
  isSelectorOpen: boolean;
  onToggleSelector: () => void;
  onCloseSelector: () => void;
  chainColor?: string;
}) => {
  const chainColor = () => props.chainColor || getChainColor('btc');
  let triggerRef: HTMLButtonElement | undefined;

  return (
    <div class="chain-monitor-card chain-monitor-card--btc">
      {/* Header */}
      <header class="chain-monitor-card__header chain-monitor-card__header--btc">
        <button
          ref={triggerRef!}
          class="chain-monitor-card__header-left"
          onClick={(e) => {
            e.stopPropagation();
            props.onToggleSelector();
          }}
          aria-haspopup="listbox"
          aria-expanded={props.isSelectorOpen}
        >
          <div class="chain-monitor-card__btc-icon">
            <img
              src={getChainConfig('btc')?.logoUrl || ''}
              alt="Bitcoin"
              class="chain-monitor-card__btc-icon-img"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
          <span class="chain-monitor-card__btc-name">Bitcoin</span>
          <span class="chain-monitor-card__chevron">
            {props.isSelectorOpen ? '▲' : '▼'}
          </span>
        </button>
        <div class="chain-monitor-card__users-badge chain-monitor-card__users-badge--btc" style={{ color: chainColor() }}>
          <div 
            class="chain-monitor-card__users-icon"
            style={`mask-image: url(${activeAddressIcon}); -webkit-mask-image: url(${activeAddressIcon}); mask-size: contain; -webkit-mask-size: contain; mask-repeat: no-repeat; -webkit-mask-repeat: no-repeat; mask-position: center; -webkit-mask-position: center; background-color: ${chainColor() || '#FFFFFF'};`}
            role="img"
            aria-label="Active Addresses"
          />
          <Show when={props.data.activeAddresses !== null && props.data.activeAddresses !== undefined} fallback={
            <span class="chain-monitor-card__users-text">--</span>
          }>
            <span class="chain-monitor-card__users-text">{props.data.activeAddresses}</span>
          </Show>
        </div>
      </header>

      {/* Chain Selector Dropdown for BTC */}
      <Show when={props.isSelectorOpen}>
        <ChainSelector
          selectedChain="btc"
          isOpen={props.isSelectorOpen}
          onSelect={props.onChainSelect}
          onToggle={props.onToggleSelector}
          onClose={props.onCloseSelector}
          triggerRef={triggerRef}
        />
      </Show>

      {/* Body - Main Indicators Grid */}
      <div class="chain-monitor-card__body">
        <main class="chain-monitor-card__indicators">
          {/* FEES Section - 第一行，占据整行 */}
          <div class="chain-monitor-card__fees">
            <div class="chain-monitor-card__fees-header">
              <span class="chain-monitor-card__fees-label">FEES</span>
              <img src={gasIcon} alt="Fees" class="chain-monitor-card__fees-icon" />
            </div>
            <div class="chain-monitor-card__fees-value-container">
              <Show when={props.data.fees !== null && props.data.fees !== undefined} fallback={
                <span class="chain-monitor-card__fees-value">--</span>
              }>
                <span class="chain-monitor-card__fees-value">{props.data.fees}</span>
                <span class="chain-monitor-card__fees-unit" style={{ color: chainColor() }}>{props.data.feesUnit}</span>
              </Show>
            </div>
          </div>

          {/* Bottom Two Columns - 第二行，左右各一个 */}
          {/* Left: BLOCK */}
          <div class="chain-monitor-card__bottom-left">
            <div class="chain-monitor-card__bottom-header">
              <span class="chain-monitor-card__bottom-label">BLOCK</span>
              <img src={timeIcon} alt="Block Time" class="chain-monitor-card__bottom-icon" />
            </div>
            <div class="chain-monitor-card__bottom-value-container">
              <Show when={props.data.blockDelay !== null && props.data.blockDelay !== undefined} fallback={
                <span class="chain-monitor-card__bottom-value">--</span>
              }>
                <span class="chain-monitor-card__bottom-value">{props.data.blockDelay}</span>
                <span class="chain-monitor-card__bottom-unit">{props.data.blockDelayUnit}</span>
              </Show>
            </div>
          </div>

          {/* Right: TPS */}
          <div class="chain-monitor-card__bottom-right">
            <div class="chain-monitor-card__bottom-header">
              <span class="chain-monitor-card__bottom-label">TPS</span>
              <img src={tpsIcon} alt="TPS" class="chain-monitor-card__bottom-icon" />
            </div>
            <div class="chain-monitor-card__bottom-value-container">
              <Show when={props.data.tps !== null && props.data.tps !== undefined} fallback={
                <span class="chain-monitor-card__bottom-value">--</span>
              }>
                <span class="chain-monitor-card__bottom-value">{props.data.tps}</span>
              </Show>
            </div>
          </div>
        </main>

        {/* Progress Bar - 底部装饰线 */}
        <div class="chain-monitor-card__progress chain-monitor-card__progress--btc">
          <div
            class="chain-monitor-card__progress-segment"
            style={{
              'background-color': chainColor(),
              width: '100%',
            }}
          />
        </div>
      </div>
    </div>
  );
};

/** Widget 组件接收的 props（由 GridContainer 传入） */
interface ChainMonitorWidgetProps {
  elementId?: string;
  state?: WidgetState;
  onStateChange?: (newState: WidgetState) => void;
}

export const ChainMonitorWidget = (props: ChainMonitorWidgetProps) => {
  const normalizeChainId = (value?: string): ChainId => {
    const normalized = (value || '').toLowerCase();
    const aliasMap: Record<string, ChainId> = {
      ethereum: 'eth',
      bitcoin: 'btc',
      solana: 'sol',
      bnb: 'bsc',
      binance: 'bsc',
      matic: 'polygon',
      polygon: 'polygon',
    };

    if (isChainSupported(normalized)) {
      return normalized as ChainId;
    }

    if (aliasMap[normalized]) {
      return aliasMap[normalized];
    }

    return DEFAULT_CHAIN_MONITOR_SETTINGS.selectedChain as ChainId;
  };

  // 从实例 state 获取设置，回落到默认值
  const getSettings = (): ChainMonitorSettings => {
    const settings = props.state?.settings as ChainMonitorSettings | undefined;
    return {
      selectedChain: normalizeChainId(settings?.selectedChain),
    };
  };
  
  const initialSettings = getSettings();
  
  const [selectedChain, setSelectedChain] = createSignal<ChainId>(initialSettings.selectedChain as ChainId);
  const [isSelectorOpen, setIsSelectorOpen] = createSignal(false);
  const [chainColors, setChainColors] = createSignal<Record<ChainId, string>>({} as Record<ChainId, string>);
  const [metrics, setMetrics] = createSignal<ChainMetrics | null>(null);
  const [isLoading, setIsLoading] = createSignal(true);
  
  // 右键菜单
  const { ContextMenuComponent, showContextMenu } = useContextMenu();

  // 保存设置到实例 state
  const saveSettings = (newSettings: Partial<ChainMonitorSettings>) => {
    if (!props.onStateChange) return;
    
    const currentSettings = getSettings();
    const updatedSettings: ChainMonitorSettings = {
      ...currentSettings,
      ...newSettings,
    };
    
    props.onStateChange({
      ...props.state,
      settings: updatedSettings,
    });
  };

  // 提取所有链的颜色和加载数据
  onMount(() => {
    const colors: Record<ChainId, string> = {} as Record<ChainId, string>;
    let unsubscribe: (() => void) | undefined;

    const rawSelectedChain = (props.state?.settings as ChainMonitorSettings | undefined)?.selectedChain;
    if (rawSelectedChain && normalizeChainId(rawSelectedChain) !== rawSelectedChain) {
      saveSettings({ selectedChain: normalizeChainId(rawSelectedChain) });
    }

    // 先设置默认颜色，确保组件可以立即渲染
    for (const chain of SUPPORTED_CHAINS) {
      colors[chain.id as ChainId] = getChainColor(chain.id as ChainId);
    }
    setChainColors({ ...colors });

    // 预加载所有5个链的数据
    const allChains: ChainId[] = ['btc', 'eth', 'sol', 'bsc', 'polygon'];
    console.log('[ChainMonitor] Preloading data for all chains:', allChains);
    Promise.all(
      allChains.map(chain =>
        chainMonitorService.getAllMetrics(chain).catch(err => {
          console.error(`[ChainMonitor] Failed to preload ${chain}:`, err);
          return null;
        })
      )
    ).then(() => {
      console.log('[ChainMonitor] Preloading completed');
    });

    // 订阅当前选中链的数据更新
    unsubscribe = chainMonitorService.subscribe(selectedChain(), (data) => {
      setMetrics(data);
      setIsLoading(false);
    });

    // 初始加载当前选中链的数据
    loadMetrics(selectedChain());

    // 监听链切换，更新订阅
    createEffect(() => {
      const chain = selectedChain();
      // 取消旧订阅
      unsubscribe?.();
      // 订阅新链（使用闭包捕获的chain变量，确保回调只处理该链的数据）
      unsubscribe = chainMonitorService.subscribe(chain, (data) => {
        // 确保数据是订阅时链的数据（使用闭包捕获的chain，而不是selectedChain()）
        // 这样可以避免在链快速切换时使用错误的数据
        if (data.chain === chain) {
          setMetrics(data);
          setIsLoading(false);
        }
      });
      // 加载新链数据（会检查新鲜度，只有过期才获取）
      loadMetrics(chain);
    });

    // 然后异步提取真实颜色，逐个更新（不阻塞cleanup注册）
    (async () => {
      const colorPromises = SUPPORTED_CHAINS.map(async (chain) => {
        if (chain.logoUrl) {
          try {
            const color = await getDominantColor(chain.logoUrl);
            if (color) {
              const hexColor = rgbToHex(color);
              colors[chain.id as ChainId] = hexColor;
              setChainColors({ ...colors });
            }
          } catch (error) {
            console.warn(`Failed to extract color for ${chain.id}:`, error);
          }
        }
      });

      await Promise.all(colorPromises);
    })();

    // onCleanup 必须在同步部分调用
    onCleanup(() => {
      unsubscribe?.();
    });
  });

  /**
   * 加载数据（简化版）
   * 服务层已处理自动刷新和旧数据保留
   */
  const loadMetrics = async (chain: ChainId) => {
    // 先检查缓存，立即显示（如果有）
    const cachedData = chainMonitorService.getCachedMetrics(chain);
    if (cachedData) {
      setMetrics(cachedData);
      setIsLoading(false);
    }

    // 获取最新数据（服务会检查新鲜度，只有过期才获取）
    // 如果数据新鲜，不会触发网络请求
    const data = await chainMonitorService.getAllMetrics(chain, true);
    if (data) {
      setMetrics(data);
      setIsLoading(false);
    }
  };

  const handleChainSelect = (chain: ChainId) => {
    setSelectedChain(chain);
    setIsSelectorOpen(false);
    saveSettings({ selectedChain: chain });
    // 切换链时，createEffect 会自动处理订阅和数据加载
  };

  /**
   * 处理右键菜单
   */
  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    // 获取当前元素的 ID
    const elementId = getElementIdFromEvent(event.target);
    if (!elementId) {
      console.warn('[ChainMonitor] Could not find element ID for context menu');
      return;
    }

    // 组件特有的菜单项
    const componentItems: ContextMenuItem[] = [
      {
        label: '加载数据',
        action: () => {
          // 加载所有5个预定义链的数据
          const allChains: ChainId[] = ['btc', 'eth', 'sol', 'bsc', 'polygon'];
          console.log('[ChainMonitor] Manual refresh: Loading data for all chains:', allChains);
          
          // 并发加载所有链的数据（不使用缓存，强制刷新）
          Promise.all(
            allChains.map(chain => 
              chainMonitorService.getAllMetrics(chain, false).catch(err => {
                console.error(`[ChainMonitor] Failed to refresh ${chain}:`, err);
                return null;
              })
            )
          ).then(() => {
            console.log('[ChainMonitor] Manual refresh completed');
            // 数据更新后，订阅机制会自动更新UI
          });
        },
      },
    ];

    // 合并组件菜单项和默认菜单项（删除）
    const menuItems = mergeMenuItems(componentItems, elementId, false);

    showContextMenu(event.clientX, event.clientY, menuItems);
  };

  const currentData = () => {
    const m = metrics();
    const chain = selectedChain();
    // 确保metrics是当前选中链的数据
    if (m && m.chain === chain) {
      return formatMetricsForUI(m, chain);
    }
    // 如果链不匹配，返回null，让safeData处理
    return null;
  };
  const isBTC = () => selectedChain() === 'btc';
  const isSOL = () => selectedChain() === 'sol';
  const currentChainColor = () => chainColors()[selectedChain()] || getChainColor(selectedChain());

  // 提供默认数据结构，处理 null/undefined 情况
  // 注意：这里根据当前选中的链来决定默认单位，而不是 metrics 中的数据
  const safeData = () => {
    const data = currentData();
    // 如果数据存在，直接返回（等待订阅机制更新）
    // 订阅机制会在链切换时自动更新 metrics
    if (data) {
      return data;
    }
    // 如果数据为 null，返回默认结构
    // 默认结构根据当前选中的链来决定单位
    const currentIsBTC = isBTC();
    const currentIsSOL = isSOL();
    return {
      chain: selectedChain(),
      blockDelay: null,
      gasPrice: null,
      gasUnit: currentIsSOL ? '' : 'Gwei',
      tps: null,
      tvl: null,
      activeAddresses: null,
      // BTC 特有
      fees: null,
      feesUnit: 'sat/vB',
      blockDelayUnit: 'm',
    };
  };

  return (
    <div class="chain-monitor-widget" onContextMenu={handleContextMenu}>
      <Show when={isLoading() && !metrics()}>
        <div class="chain-monitor-loading">
          <div class="spinner"></div>
          <span class="chain-monitor-loading-text">连接中...</span>
        </div>
      </Show>
      <Show when={!isLoading() || metrics()}>
        <Show when={isBTC()}>
          <BTCChainView
            data={safeData()}
            onChainSelect={handleChainSelect}
            isSelectorOpen={isSelectorOpen()}
            onToggleSelector={() => setIsSelectorOpen(!isSelectorOpen())}
            onCloseSelector={() => setIsSelectorOpen(false)}
            chainColor={currentChainColor()}
          />
        </Show>
        <Show when={!isBTC()}>
          <EVMChainView
            chain={selectedChain()}
            data={safeData()}
            onChainSelect={handleChainSelect}
            isSelectorOpen={isSelectorOpen()}
            onToggleSelector={() => setIsSelectorOpen(!isSelectorOpen())}
            onCloseSelector={() => setIsSelectorOpen(false)}
            chainColor={currentChainColor()}
          />
        </Show>
      </Show>
      {/* 右键菜单组件 */}
      <ContextMenuComponent />
    </div>
  );
};
