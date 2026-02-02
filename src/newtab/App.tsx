/**
 * App 根组件 - Grid System 布局
 * 整个桌面都是 Grid System，固定大小不可滚动
 */

import { onMount, onCleanup, createSignal, Show } from 'solid-js';
import { Sidebar } from '../grid/Sidebar';
import { SettingsButton } from '../grid/SettingsButton';
import { AnimatedLayoutContainer } from '../grid/AnimatedLayoutContainer';
import { gridStore, switchLayout, loadFromStorage } from '../grid/store';
import { handleWheel } from '../grid/animationStore';
import { getDefaultElements, getDefaultLayoutIds } from '../grid/defaultLayouts';
import { preloadIcons } from '../services/iconCache';
import { getBuiltinIcon } from '../services/builtinIcons';
import '../grid/grid.css';

export const App = () => {
  const [isReady, setIsReady] = createSignal(false);

  onMount(() => {
    // 自动设置页面缩放比例为 90%
    const chromeApi = (window as any).chrome;
    if (chromeApi && chromeApi.tabs && chromeApi.tabs.setZoom) {
      chromeApi.tabs.setZoom(null, 0.9).catch(() => {});
    }

    (window as any).__gridStore = gridStore;
    (window as any).__getCurrentLayout = () => {
      return gridStore.layouts.find(l => l.id === gridStore.currentLayoutId);
    };

    loadFromStorage(() => {
      setIsReady(true);
      preloadAllIcons();
    });

    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const isEditable = target.closest('input, textarea, [contenteditable="true"]');
      if (!isEditable) {
        e.preventDefault();
      }
    };

    const handleWheelEvent = (e: WheelEvent) => {
      const target = e.target as HTMLElement;

      if (target && typeof target.closest === 'function') {
        const closest = target.closest('.grid-widget__content, input, textarea, .event-tooltip, .event-tooltip__overlay, .grid-sidebar, .grid-sidebar__tabs, .add-tab-dialog, .add-tab-dialog-overlay');
        if (closest) {
          return;
        }
      }

      const tooltip = document.querySelector('.event-tooltip');
      if (tooltip) {
        const rect = tooltip.getBoundingClientRect();
        if (
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        ) {
          return;
        }
      }

      const targetId = handleWheel(
        e.deltaY,
        gridStore.layouts,
        gridStore.currentLayoutId
      );

      if (targetId) {
        switchLayout(targetId);
      }
    };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('wheel', handleWheelEvent, { passive: true });

    onCleanup(() => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('wheel', handleWheelEvent);
    });
  });

  const preloadAllIcons = () => {
    const urlsToPreload: string[] = [];

    gridStore.layouts.forEach(layout => {
      layout.elements.forEach(element => {
        if (element.type === 'icon') {
          const url = (element.data as any)?.url;
          if (url) {
            const builtin = getBuiltinIcon(url);
            if (builtin) {
              urlsToPreload.push(builtin);
            } else {
              try {
                const domain = new URL(url).hostname;
                urlsToPreload.push(`https://icon.horse/icon/${domain}`);
              } catch {}
            }
          }
        }
      });
    });

    preloadIcons([...new Set(urlsToPreload)]);
  };

  return (
    <Show when={isReady()} fallback={<div class="grid-desktop" />}>
      <div class="grid-desktop">
        <Sidebar />
        <SettingsButton />

        <div class="grid-container">
          <AnimatedLayoutContainer />
        </div>
      </div>
    </Show>
  );
};
