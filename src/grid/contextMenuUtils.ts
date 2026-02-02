/**
 * 右键菜单工具函数
 * 用于合并默认菜单项和组件特有菜单项
 */

import type { ContextMenuItem } from '../components/layout/ContextMenu';
import { removeElement } from './store';

/**
 * 创建默认菜单项（包括删除）
 * @param elementId 元素ID
 * @param isFixed 是否为固定元素
 * @returns 默认菜单项数组
 */
export function createDefaultMenuItems(elementId: string, isFixed: boolean = false): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  
  // 只有非固定元素可以删除
  if (!isFixed) {
    items.push({
      label: '删除',
      variant: 'danger',
      action: () => {
        removeElement(elementId);
      },
    });
  }
  
  return items;
}

/**
 * 合并组件菜单项和默认菜单项
 * @param componentItems 组件特有的菜单项
 * @param elementId 元素ID
 * @param isFixed 是否为固定元素
 * @returns 合并后的菜单项数组（组件项在前，默认项在后）
 */
export function mergeMenuItems(
  componentItems: ContextMenuItem[],
  elementId: string,
  isFixed: boolean = false
): ContextMenuItem[] {
  const defaultItems = createDefaultMenuItems(elementId, isFixed);
  
  // 组件项在前，默认项（删除）在后
  return [...componentItems, ...defaultItems];
}

/**
 * 从事件目标获取元素ID
 * @param eventTarget 事件目标元素
 * @returns 元素ID或null
 */
export function getElementIdFromEvent(eventTarget: EventTarget | null): string | null {
  if (!eventTarget) return null;
  
  const element = (eventTarget as HTMLElement).closest('.grid-element');
  return element?.getAttribute('data-element-id') || null;
}
