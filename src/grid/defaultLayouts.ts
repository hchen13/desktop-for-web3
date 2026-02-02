/**
 * 默认布局配置
 * 
 * 从 config/defaultLayouts.json 加载默认布局
 * 所有元素位置使用锚点相对坐标 (Anchor-Relative Position)
 */

import type { GridElement, DesktopLayout } from './types';
import defaultLayoutsConfig from '../config/defaultLayouts.json';

export interface DefaultLayoutConfig {
  id: string;
  name: string;
  getElements: () => GridElement[];
}

const parseLayoutElements = (elements: any[]): GridElement[] => {
  return elements.map(el => ({
    ...el,
    position: { x: el.position.x, y: el.position.y },
    size: { width: el.size.width, height: el.size.height },
  })) as GridElement[];
};

const layoutConfigCache = new Map<string, DefaultLayoutConfig>();

const createLayoutConfig = (layout: any): DefaultLayoutConfig => {
  return {
    id: layout.id,
    name: layout.name,
    getElements: () => parseLayoutElements(layout.elements),
  };
};

defaultLayoutsConfig.layouts.forEach(layout => {
  layoutConfigCache.set(layout.id, createLayoutConfig(layout));
});

export const DEFAULT_LAYOUT_CONFIGS: Record<string, DefaultLayoutConfig> = 
  Object.fromEntries(layoutConfigCache);

export const getDefaultElements = (layoutId: string): GridElement[] => {
  const config = layoutConfigCache.get(layoutId);
  if (!config) {
    return [];
  }
  return config.getElements();
};

export const getAllDefaultLayouts = (): DefaultLayoutConfig[] => {
  return Array.from(layoutConfigCache.values());
};

export const getDefaultLayoutIds = (): string[] => {
  return defaultLayoutsConfig.layouts.map(l => l.id);
};

export const isDefaultLayout = (layoutId: string): boolean => {
  return layoutConfigCache.has(layoutId);
};
