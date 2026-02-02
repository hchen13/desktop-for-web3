/**
 * ContextMenu 组件 - 右键菜单
 * 支持动态菜单项、位置自适应、点击外部关闭
 */

import { createSignal, onMount, onCleanup, For, Show, JSX, createEffect } from 'solid-js';
import { Portal } from './Portal';

export interface ContextMenuItem {
  /** 菜单项标签 */
  label: string;
  /** 点击回调 */
  action: () => void;
  /** 是否危险操作（如删除） */
  variant?: 'normal' | 'danger';
  /** 是否禁用 */
  disabled?: boolean;
}

interface ContextMenuProps {
  /** 是否显示菜单 */
  isOpen: boolean;
  /** 菜单位置 X */
  x: number;
  /** 菜单位置 Y */
  y: number;
  /** 菜单项列表 */
  items: ContextMenuItem[];
  /** 关闭回调 */
  onClose: () => void;
}

/**
 * 调整菜单位置避免超出视口
 */
function adjustPosition(
  x: number,
  y: number,
  menuWidth: number,
  menuHeight: number
): { x: number; y: number } {
  const padding = 8;
  const maxX = window.innerWidth - menuWidth - padding;
  const maxY = window.innerHeight - menuHeight - padding;

  return {
    x: Math.max(padding, Math.min(x, maxX)),
    y: Math.max(padding, Math.min(y, maxY)),
  };
}

// 预估菜单尺寸（在没有实际渲染前）
const ESTIMATED_MENU_WIDTH = 140;
const ESTIMATED_MENU_ITEM_HEIGHT = 40;

export const ContextMenu = (props: ContextMenuProps) => {
  const [adjustedPosition, setAdjustedPosition] = createSignal({ x: props.x, y: props.y });
  const [menuSize, setMenuSize] = createSignal({ width: ESTIMATED_MENU_WIDTH, height: ESTIMATED_MENU_ITEM_HEIGHT });
  let menuRef: HTMLDivElement | undefined = undefined;
  let contentRef: HTMLDivElement | undefined = undefined;

  // 当位置或打开状态变化时，更新位置
  createEffect(() => {
    if (props.isOpen) {
      const { width, height } = menuSize();
      const adjusted = adjustPosition(props.x, props.y, width, height);
      setAdjustedPosition(adjusted);
    }
  });

  // 渲染后获取实际尺寸并微调位置
  const updateActualSize = () => {
    if (contentRef) {
      const rect = contentRef.getBoundingClientRect();
      setMenuSize({ width: rect.width, height: rect.height });
      const adjusted = adjustPosition(props.x, props.y, rect.width, rect.height);
      setAdjustedPosition(adjusted);
    }
  };

  // 全局点击监听 - 点击菜单外部时关闭
  const handleGlobalClick = (e: MouseEvent) => {
    if (!props.isOpen) return;
    if (menuRef && !menuRef.contains(e.target as Node)) {
      props.onClose();
    }
  };

  // 菜单项点击处理
  const handleItemClick = (item: ContextMenuItem) => {
    if (item.disabled) return;
    item.action();
    props.onClose();
  };

  // 注册全局事件监听
  onMount(() => {
    document.addEventListener('click', handleGlobalClick, true);
    // 使用 requestAnimationFrame 确保在渲染完成后获取尺寸
    if (props.isOpen) {
      requestAnimationFrame(updateActualSize);
    }

    onCleanup(() => {
      document.removeEventListener('click', handleGlobalClick, true);
    });
  });

  return (
    <Show when={props.isOpen}>
      <Portal>
        <div
          ref={menuRef!}
          class="context-menu"
          style={{
            left: `${adjustedPosition().x}px`,
            top: `${adjustedPosition().y}px`,
          }}
        >
          <div ref={contentRef!} class="context-menu__content">
            <For each={props.items}>
              {(item) => (
                <button
                  classList={{
                    'context-menu__item': true,
                    'context-menu__item--danger': item.variant === 'danger',
                    'context-menu__item--disabled': item.disabled,
                  }}
                  onClick={() => handleItemClick(item)}
                  disabled={item.disabled}
                >
                  {item.label}
                </button>
              )}
            </For>
          </div>
        </div>
      </Portal>
    </Show>
  );
};

/**
 * 右键菜单 Hook
 * 用于管理右键菜单状态
 */
export interface UseContextMenuResult {
  /** 上下文菜单组件 */
  ContextMenuComponent: () => JSX.Element;
  /** 显示右键菜单 */
  showContextMenu: (x: number, y: number, items: ContextMenuItem[]) => void;
  /** 关闭右键菜单 */
  closeContextMenu: () => void;
  /** 当前是否打开 */
  isOpen: () => boolean;
}

export function useContextMenu(): UseContextMenuResult {
  const [isOpen, setIsOpen] = createSignal(false);
  const [position, setPosition] = createSignal({ x: 0, y: 0 });
  const [items, setItems] = createSignal<ContextMenuItem[]>([]);

  const showContextMenu = (x: number, y: number, menuItems: ContextMenuItem[]) => {
    setItems(menuItems);
    setPosition({ x, y });
    setIsOpen(true);
  };

  const closeContextMenu = () => {
    setIsOpen(false);
  };

  const ContextMenuComponent = () => (
    <ContextMenu
      isOpen={isOpen()}
      x={position().x}
      y={position().y}
      items={items()}
      onClose={closeContextMenu}
    />
  );

  return {
    ContextMenuComponent,
    showContextMenu,
    closeContextMenu,
    isOpen,
  };
}
