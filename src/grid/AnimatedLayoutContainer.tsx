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
 *
 * 因为隐藏 layout 的组件不会卸载，layout 是否 active 必须显式往下传，
 * 否则后台 layout 的 Watchlist 会继续贡献行情订阅。
 */

import { createSignal, createEffect, createMemo, onCleanup, For } from 'solid-js';
import { gridStore } from './store';
import { GridContainer } from './GridContainer';

export const AnimatedLayoutContainer = () => {
  const [displayLayoutId, setDisplayLayoutId] = createSignal(gridStore.currentLayoutId);
  const [isTransitioning, setIsTransitioning] = createSignal(false);

  let isAnimating = false;

  let fadeOutTimer: ReturnType<typeof setTimeout> | null = null;
  let fadeInTimer: ReturnType<typeof setTimeout> | null = null;

  const runTransition = () => {
    isAnimating = true;
    setIsTransitioning(true);

    fadeOutTimer = setTimeout(() => {
      fadeOutTimer = null;
      // 切换点必须读最新目标：动画期间又切了一次的话，中间那个 layout 已经过期，
      // 让它 active 会使它的 Watchlist 短暂上线并发请求
      const target = gridStore.currentLayoutId;
      setDisplayLayoutId(target);

      fadeInTimer = setTimeout(() => {
        fadeInTimer = null;
        isAnimating = false;

        // isAnimating 不是响应式依赖，effect 不会因为它复位而重跑，
        // 期间累积的切换必须在这里补上
        if (gridStore.currentLayoutId !== target) {
          runTransition();
          return;
        }
        setIsTransitioning(false);
      }, 150);
    }, 150);
  };

  onCleanup(() => {
    if (fadeOutTimer) clearTimeout(fadeOutTimer);
    if (fadeInTimer) clearTimeout(fadeInTimer);
    fadeOutTimer = null;
    fadeInTimer = null;
  });

  createEffect(() => {
    const newId = gridStore.currentLayoutId;
    if (newId === displayLayoutId()) return;
    if (isAnimating) return;
    runTransition();
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
              <GridContainer layoutId={layout.id} isActiveLayout={isActive()} />
            </div>
          );
        }}
      </For>
    </div>
  );
};
