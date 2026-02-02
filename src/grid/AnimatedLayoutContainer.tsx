/**
 * 带动画的布局容器
 * 采用 keep-alive 策略：所有 layout 的 GridContainer 实例常驻，通过 CSS 切换显示
 *
 * 动画策略：
 * 1. 切换时当前 layout 先淡出 (150ms)
 * 2. 然后切换显示的 layout
 * 3. 新 layout 淡入 (150ms)
 * 4. 无位移，只有透明度变化
 *
 * 优势：组件实例不销毁，图标加载状态得以保留，切回时无需重新加载
 */

import { createSignal, createEffect, createMemo, For } from 'solid-js';
import { gridStore } from './store';
import { GridContainer } from './GridContainer';

export const AnimatedLayoutContainer = () => {
  const [displayLayoutId, setDisplayLayoutId] = createSignal(gridStore.currentLayoutId);
  const [isTransitioning, setIsTransitioning] = createSignal(false);

  let isAnimating = false;

  createEffect(() => {
    const newId = gridStore.currentLayoutId;

    if (newId === displayLayoutId()) {
      return;
    }

    if (isAnimating) return;

    isAnimating = true;
    setIsTransitioning(true);

    setTimeout(() => {
      setDisplayLayoutId(newId);

      setTimeout(() => {
        setIsTransitioning(false);
        isAnimating = false;
      }, 150);
    }, 150);
  });

  const layouts = createMemo(() => gridStore.layouts);

  return (
    <div class="layout-transition-container">
      <For each={layouts()}>
        {(layout) => {
          const isActive = createMemo(() => layout.id === displayLayoutId());
          const shouldShow = createMemo(() => {
            if (isActive()) return true;
            if (isTransitioning() && layout.id === gridStore.currentLayoutId) return true;
            return false;
          });

          return (
            <div
              class="layout-keep-alive-wrapper"
              classList={{
                'layout-keep-alive-wrapper--active': isActive(),
                'layout-keep-alive-wrapper--hidden': !shouldShow(),
              }}
              style={{
                opacity: isActive() && !isTransitioning() ? 1 : 0,
                transition: 'opacity 0.15s ease-out',
              }}
            >
              <GridContainer layoutId={layout.id} />
            </div>
          );
        }}
      </For>
    </div>
  );
};
