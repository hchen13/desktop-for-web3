/**
 * Widget 组件类型定义
 */

export type GridSize = {
  width: number;
  height: number;
};

export interface BaseWidget {
  id: string;
  size: GridSize;
}

export interface CalendarWidget extends BaseWidget {
  type: 'calendar';
}

export interface NewsWidget extends BaseWidget {
  type: 'news';
}

export interface WatchlistWidget extends BaseWidget {
  type: 'watchlist';
}

export interface ChainMonitorWidget extends BaseWidget {
  type: 'chain-monitor';
}

export interface WorldClockWidget extends BaseWidget {
  type: 'world-clock';
}

export type WidgetElement = CalendarWidget | NewsWidget | WatchlistWidget | ChainMonitorWidget | WorldClockWidget;

// Grid Size 常量
export const WIDGET_SIZES = {
  SMALL: { width: 2, height: 1 },   // 2x1 - 小组件
  MEDIUM: { width: 2, height: 2 },  // 2x2 - 标准组件
  LARGE: { width: 4, height: 2 },   // 4x2 - 大组件
  TALL: { width: 2, height: 4 },    // 2x4 - 纵向组件
} as const;

export type WidgetSizeKey = keyof typeof WIDGET_SIZES;
