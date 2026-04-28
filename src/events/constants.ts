/**
 * 事件系统共享常量
 * 单一来源 — EventOrchestrator 与 DragSystem 都从这里 import
 */

/** 拖拽阈值：移动严格大于此像素值才视为拖拽 */
export const DRAG_THRESHOLD = 5;

/** 点击时间上限：mousedown 与 mouseup 间隔不超过此值才视为点击 */
export const CLICK_TIME_MAX = 300;
