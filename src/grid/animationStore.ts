/**
 * Layout 切换动画状态管理
 * 完全解耦，不影响现有 grid/store.ts
 */

import { createStore } from 'solid-js/store';

export type TransitionDirection = 'next' | 'prev' | 'none';

export interface AnimationState {
  // 当前正在进行的过渡
  isTransitioning: boolean;

  // 过渡方向: next=向上滑出(显示下一个), prev=向下滑出(显示上一个)
  direction: TransitionDirection;

  // 进入动画的布局 ID
  enteringLayoutId: string | null;

  // 离开动画的布局 ID
  exitingLayoutId: string | null;

  // 滚动节流时间戳
  lastWheelTime: number;

  // 滚动累积量（用于防误触）
  wheelAccumulator: number;
}

const INITIAL_STATE: AnimationState = {
  isTransitioning: false,
  direction: 'none',
  enteringLayoutId: null,
  exitingLayoutId: null,
  lastWheelTime: 0,
  wheelAccumulator: 0,
};

export const [animationStore, setAnimationStore] = createStore<AnimationState>(
  INITIAL_STATE
);

/**
 * 启动布局切换动画
 * @param fromId 当前布局 ID
 * @param toId 目标布局 ID
 * @param direction 切换方向
 */
export function startTransition(
  fromId: string,
  toId: string,
  direction: TransitionDirection
): void {
  setAnimationStore({
    isTransitioning: true,
    direction,
    enteringLayoutId: toId,
    exitingLayoutId: fromId,
  });
}

/**
 * 完成过渡动画
 */
export function endTransition(): void {
  setAnimationStore({
    isTransitioning: false,
    direction: 'none',
    enteringLayoutId: null,
    exitingLayoutId: null,
  });
}

/**
 * 处理滚动事件，返回目标布局 ID 或 null
 * @param deltaY 滚动增量
 * @param layouts 所有布局
 * @param currentId 当前布局 ID
 * @returns 目标布局 ID 或 null
 */
export function handleWheel(
  deltaY: number,
  layouts: Array<{ id: string }>,
  currentId: string
): string | null {
  const WHEEL_THRESHOLD = 50; // 累积滚动阈值
  const WHEEL_DEBOUNCE = 800; // 防抖时间

  const now = Date.now();
  const timeSinceLastWheel = now - animationStore.lastWheelTime;

  // 防抖：切换后短时间内不响应
  if (timeSinceLastWheel < WHEEL_DEBOUNCE) {
    return null;
  }

  // 累积滚动量
  const newAccumulator = animationStore.wheelAccumulator + deltaY;
  setAnimationStore('wheelAccumulator', Math.abs(newAccumulator) < 500
    ? newAccumulator
    : 0);

  // 检查是否达到阈值
  if (Math.abs(newAccumulator) < WHEEL_THRESHOLD) {
    return null;
  }

  // 重置累积量和时间戳
  setAnimationStore({
    wheelAccumulator: 0,
    lastWheelTime: now,
  });

  // 确定方向和目标
  const currentIndex = layouts.findIndex(l => l.id === currentId);
  if (currentIndex === -1) return null;

  // 向下滚(deltaY > 0)显示下一个，向上滚(deltaY < 0)显示上一个
  // newAccumulator > 0 表示向下滚动，应该切换到下一个
  const direction = newAccumulator > 0 ? 'next' : 'prev';
  const targetIndex = direction === 'next'
    ? currentIndex + 1
    : currentIndex - 1;

  // 边界检查
  if (targetIndex < 0 || targetIndex >= layouts.length) {
    return null;
  }

  return layouts[targetIndex].id;
}

/**
 * 重置滚动状态
 */
export function resetWheelState(): void {
  setAnimationStore({
    lastWheelTime: 0,
    wheelAccumulator: 0,
  });
}
