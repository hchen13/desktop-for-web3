/**
 * Grid System 类型定义
 *
 * 基于 design/layout/grid-system-design.md 规范
 */

/**
 * Grid 单元大小 (Grid Unit Size)
 * 固定 100px，不随 viewport 变化
 */
export const GRID_UNIT = 100; // px - grid 单元尺寸

/**
 * Grid 间隙 (Grid Gap)
 * 固定 20px
 */
export const GRID_GAP = 20; // px - 格子间隙

/**
 * Grid System 尺寸（动态计算）
 */
export interface GridSystemSize {
  columns: number;  // 动态列数
  rows: number;     // 动态行数
}

/**
 * Grid 位置类型（绝对坐标）
 * 表示元素在 Grid System 中的实际位置
 */
export interface GridPosition {
  x: number; // 列索引 (0-based)
  y: number; // 行索引 (0-based)
}

/**
 * 锚点相对位置类型
 * 表示元素相对于锚点的位置（用于布局保存）
 * 
 * 锚点位于 Grid Area 第一行的中心列
 * x 可以为负数（锚点左侧）或正数（锚点右侧）
 * y 始终 >= 0
 */
export interface AnchorRelativePosition {
  x: number; // 相对于锚点列的偏移量（负=左，正=右）
  y: number; // 相对于锚点行的偏移量（始终 >= 0）
}

/**
 * Grid 尺寸类型 (Grid Size)
 *
 * 元素在 Grid System 中占用的尺寸，以 Grid Unit 数量表示
 * 格式：{ width: number, height: number }
 * 简记：行数×列数 (例如 2×3 表示 2 行 3 列)
 */
export interface GridSize {
  width: number;  // 占用列数 (列方向尺寸)
  height: number; // 占用行数 (行方向尺寸)
}

/**
 * Grid 元素基础接口
 */
export interface GridElement {
  id: string;
  type: 'widget' | 'icon' | 'fixed';
  position: GridPosition;
  size: GridSize;
  component?: string;
  fixed?: boolean;
  data?: Record<string, any> | {
    name: string;
    url: string;
    category: 'cex' | 'dex' | 'tools' | 'l2';
  };
  state?: Record<string, any>;
}

/**
 * Widget 组件接口
 */
export interface Widget extends GridElement {
  type: 'widget';
  component: 'calendar' | 'price' | 'news' | 'watchlist' | 'calculator' | 'onchain' | 'chain-monitor' | 'world-clock' | 'econ-map' | 'rate-monitor';
  data?: Record<string, any>;
}

/**
 * 固定元素接口 (搜索框、时间显示等)
 */
export interface FixedElement extends GridElement {
  type: 'fixed';
  fixed: true;
  component: 'search' | 'time';
}

/**
 * 图标组件接口
 */
export interface AppIconElement extends GridElement {
  type: 'icon';
  component: 'icon';
  data: {
    name: string;
    url: string;
    category: 'cex' | 'dex' | 'tools' | 'l2';
  };
}

/**
 * 桌面布局接口
 */
export interface DesktopLayout {
  id: string;
  name: string;
  elements: GridElement[];
  /** 图标 ID (用于 Sidebar 显示) */
  iconId?: string;
}

/**
 * 拖拽状态
 */
export interface DragState {
  isDragging: boolean;
  element: GridElement | null;
  startPosition: GridPosition | null;
  currentPosition: GridPosition | null;
}

/**
 * 常用 Grid Size 预设
 *
 * 简记格式：行数×列数
 * 例如：SEARCH_BAR 为 1×4 表示 1 行 4 列
 */
export const GRID_SIZES = {
  ICON: { width: 1, height: 1 },           // 1×1
  SMALL_WIDGET: { width: 2, height: 1 },   // 1×2
  STANDARD_WIDGET: { width: 2, height: 2 }, // 2×2
  LARGE_WIDGET: { width: 4, height: 2 },   // 2×4
  VERTICAL_WIDGET: { width: 2, height: 3 }, // 2×3
  CALENDAR_FULL: { width: 3, height: 2 },   // 3×2 (日历完整视图)
  CALENDAR_COMPACT: { width: 2, height: 2 }, // 2×2 (日历极简视图)
  NEWS_WIDGET: { width: 2, height: 4 },    // 4×2 (资讯组件，高度动态)
  SEARCH_BAR: { width: 4, height: 1 },      // 1×4 (搜索框)
  TIME_DISPLAY: { width: 2, height: 1 },    // 1×2 (时间显示)
  ECON_MAP: { width: 3, height: 2 },        // 2×3 (宏观经济地图)
} as const;

/**
 * Grid 配置（基础参数）
 *
 * 注意：columns 和 rows 由 calculateGridSystemSize() 动态计算
 */
export const GRID_CONFIG = {
  unit: GRID_UNIT,   // 100px
  gap: GRID_GAP,     // 20px
  minWidth: 6,       // 最小列数
  minHeight: 6,      // 最小行数
  paddingLeft: 56,   // 左侧 padding（Sidebar 空间）
  paddingRight: 16,  // 右侧 padding（与顶部一致）
  paddingTop: 16,    // 顶部 padding
  paddingBottom: 16, // 底部 padding
} as const;
