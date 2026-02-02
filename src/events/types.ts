/**
 * 事件系统类型定义
 * 统一的事件处理架构
 */

/**
 * 可交互元素选择器
 * 用于判断事件目标是否在可交互区域内
 */
export const INTERACTIVE_SELECTORS = [
  'button',
  'a',
  'input',
  'textarea',
  'select',
  '[role="button"]',
  '.calendar-day',
  '.context-menu',
  '.event-tooltip',
] as const;

/**
 * 事件优先级（从高到低）
 */
export enum EventPriority {
  CONTEXT_MENU = 1,  // 右键菜单
  INTERACTION = 2,   // 组件内部交互
  DRAG = 3,          // 拖拽操作
}

/**
 * 拖拽状态
 */
export interface DragState {
  isDragging: boolean;        // 正在拖拽
  isPotentialDrag: boolean;   // 可能拖拽（mousedown 后等待移动判断）
  startPosition: { x: number; y: number };
  currentPosition: { x: number; y: number };
  startTime: number;
  element: HTMLElement | null;
  elementId: string | null;
}

/**
 * 拖拽常量
 */
export const DRAG_THRESHOLD = 5;    // 移动超过 5px 算拖拽
export const CLICK_TIME_MAX = 200;  // 200ms 内释放算点击

/**
 * 上下文菜单目标类型
 */
export type ContextMenuTarget =
  | { type: 'grid-background' }
  | { type: 'element'; element: GridElementData };

/**
 * 网格元素数据（用于右键菜单）
 */
export interface GridElementData {
  id: string;
  type: 'widget' | 'icon' | 'fixed';
  component: string;
  fixed: boolean;
}

/**
 * 上下文菜单动作
 */
export type ContextMenuAction =
  | { type: 'delete'; elementId: string }
  | { type: 'add-component' }
  | { type: 'refresh'; elementId: string }
  | { type: 'toggle-view'; elementId: string };

/**
 * 事件类型
 */
export interface AppEvent {
  type: 'drag-start' | 'drag-end' | 'drag-move' | 'context-menu' | 'click';
  timestamp: number;
}

/**
 * 判断是否在可交互元素内
 */
export function isInsideInteractiveElement(target: HTMLElement): boolean {
  return INTERACTIVE_SELECTORS.some(selector => target.closest(selector));
}
