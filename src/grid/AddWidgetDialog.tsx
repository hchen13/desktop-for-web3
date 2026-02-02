/**
 * 添加组件对话框组件
 * 允许用户选择要添加的 Widget 组件
 */

import { createSignal, Show, createEffect } from 'solid-js';
import { Portal } from '../components/layout/Portal';
import { GRID_SIZES } from './types';

export type WidgetType = 'calendar' | 'news' | 'watchlist' | 'chain-monitor' | 'world-clock' | 'econ-map' | 'rate-monitor';

export interface WidgetOption {
  id: WidgetType;
  name: string;
  description: string;
  size: { width: number; height: number };
}

const WIDGET_OPTIONS: WidgetOption[] = [
  {
    id: 'calendar',
    name: '日历',
    description: '显示即将到来的加密货币事件',
    size: GRID_SIZES.CALENDAR_FULL,
  },
  {
    id: 'news',
    name: '资讯',
    description: 'Web3 新闻动态',
    size: { width: 3, height: 3 },
  },
  {
    id: 'watchlist',
    name: '价格监控',
    description: '追踪加密货币价格',
    size: GRID_SIZES.STANDARD_WIDGET,
  },
  {
    id: 'chain-monitor',
    name: '链上监控',
    description: '监控链上数据和 TVL',
    size: GRID_SIZES.STANDARD_WIDGET,
  },
  {
    id: 'world-clock',
    name: '世界时钟',
    description: '显示全球主要时区时间',
    size: GRID_SIZES.TIME_DISPLAY,
  },
  {
    id: 'econ-map',
    name: '经济地图',
    description: '宏观经济数据可视化（本地数据源）',
    size: GRID_SIZES.ECON_MAP,
  },
  {
    id: 'rate-monitor',
    name: '汇率监控',
    description: '稳定币与法币实时汇率',
    size: GRID_SIZES.ICON,
  },
];

interface AddWidgetDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (widgetType: WidgetType) => void;
}

export const AddWidgetDialog = (props: AddWidgetDialogProps) => {
  const [selectedWidget, setSelectedWidget] = createSignal<WidgetType | null>(null);

  const handleClose = () => {
    setSelectedWidget(null);
    props.onClose();
  };

  const handleConfirm = () => {
    const widget = selectedWidget();
    if (widget) {
      props.onConfirm(widget);
      setSelectedWidget(null);
    }
  };

  const handleWidgetClick = (widgetType: WidgetType) => {
    setSelectedWidget(widgetType);
  };

  const handleWidgetDoubleClick = (widgetType: WidgetType) => {
    props.onConfirm(widgetType);
    setSelectedWidget(null);
  };

  return (
    <Show when={props.isOpen}>
      <Portal>
        <div class="add-widget-dialog-overlay" onClick={handleClose}>
          <div class="add-widget-dialog" onClick={(e) => e.stopPropagation()}>
            <div class="add-widget-dialog__header">
              <h2 class="add-widget-dialog__title">添加组件</h2>
              <button class="add-widget-dialog__close" onClick={handleClose}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div class="add-widget-dialog__grid">
              {WIDGET_OPTIONS.map((option) => (
                <div
                  classList={{
                    'add-widget-dialog__option': true,
                    'add-widget-dialog__option--selected': selectedWidget() === option.id,
                  }}
                  onClick={() => handleWidgetClick(option.id)}
                  onDblClick={() => handleWidgetDoubleClick(option.id)}
                >
                  <div class="add-widget-dialog__option-header">
                    <span class="add-widget-dialog__option-name">{option.name}</span>
                    <span class="add-widget-dialog__option-size">
                      {option.size.width}×{option.size.height}
                    </span>
                  </div>
                  <div class="add-widget-dialog__option-description">
                    {option.description}
                  </div>
                </div>
              ))}
            </div>

            <div class="add-widget-dialog__actions">
              <button
                class="add-widget-dialog__btn add-widget-dialog__btn--cancel"
                onClick={handleClose}
              >
                取消
              </button>
              <button
                class="add-widget-dialog__btn add-widget-dialog__btn--confirm"
                onClick={handleConfirm}
                disabled={!selectedWidget()}
              >
                添加
              </button>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
};
