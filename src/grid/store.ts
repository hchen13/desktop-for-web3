/**
 * Grid System Store - 全局状态管理
 * 
 * 布局持久化存储策略：
 * - 使用 chrome.storage.local 存储用户的当前布局
 * - 默认布局从 config/defaultLayouts.json 加载
 * - 任何布局变更后自动保存
 */

import { createStore } from 'solid-js/store';
import type { DesktopLayout, GridElement, GridPosition, DragState, GridSystemSize } from './types';
import { findAvailablePosition, calculateRequiredRows, isValidPosition } from './utils';
import { GRID_CONFIG } from './types';
import defaultLayoutsConfig from '../config/defaultLayouts.json';

const STORAGE_KEY = 'gridLayouts';
const STORAGE_CURRENT_ID_KEY = 'currentLayoutId';

export const getCurrentGridSystemSize = (): GridSystemSize => {
  if (typeof window === 'undefined') {
    return { columns: GRID_CONFIG.minWidth, rows: GRID_CONFIG.minHeight };
  }
  return require('./utils').calculateGridSystemSize(window.innerWidth, window.innerHeight);
};

const getDefaultLayouts = (): DesktopLayout[] => {
  return defaultLayoutsConfig.layouts.map(layout => ({
    ...layout,
    elements: layout.elements.map(el => ({
      ...el,
      position: { x: el.position.x, y: el.position.y },
      size: { width: el.size.width, height: el.size.height },
    })) as GridElement[],
  }));
};

const DEFAULT_LAYOUTS = getDefaultLayouts();

interface GridStoreState {
  layouts: DesktopLayout[];
  currentLayoutId: string;
  dragState: DragState;
  isInitialized: boolean;
}

export const [gridStore, setGridStore] = createStore<GridStoreState>({
  layouts: DEFAULT_LAYOUTS,
  currentLayoutId: 'desktop-1',
  dragState: {
    isDragging: false,
    element: null,
    startPosition: null,
    currentPosition: null,
  },
  isInitialized: false,
});

const saveToStorage = (): void => {
  if (typeof window === 'undefined') return;
  
  let safeLayouts: DesktopLayout[] = [];
  try {
    safeLayouts = JSON.parse(JSON.stringify(gridStore.layouts));
  } catch {
    safeLayouts = gridStore.layouts as DesktopLayout[];
  }

  const chrome = (window as any).chrome;
  if (chrome?.storage?.local) {
    const data = {
      [STORAGE_KEY]: safeLayouts,
      [STORAGE_CURRENT_ID_KEY]: gridStore.currentLayoutId,
    };
    chrome.storage.local.set(data);
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safeLayouts));
    localStorage.setItem(STORAGE_CURRENT_ID_KEY, gridStore.currentLayoutId);
  }
};

export const loadFromStorage = (callback?: () => void): void => {
  if (typeof window === 'undefined') {
    callback?.();
    return;
  }

  const chrome = (window as any).chrome;
  if (chrome?.storage?.local) {
    chrome.storage.local.get([STORAGE_KEY, STORAGE_CURRENT_ID_KEY], (result: any) => {
      if (result[STORAGE_KEY] && Array.isArray(result[STORAGE_KEY]) && result[STORAGE_KEY].length > 0) {
        setGridStore('layouts', result[STORAGE_KEY]);
      }
      if (result[STORAGE_CURRENT_ID_KEY]) {
        setGridStore('currentLayoutId', result[STORAGE_CURRENT_ID_KEY]);
      }
      setGridStore('isInitialized', true);
      callback?.();
    });
  } else {
    const stored = localStorage.getItem(STORAGE_KEY);
    const storedId = localStorage.getItem(STORAGE_CURRENT_ID_KEY);
    if (stored) {
      try {
        const layouts = JSON.parse(stored);
        if (Array.isArray(layouts) && layouts.length > 0) {
          setGridStore('layouts', layouts);
        }
      } catch {}
    }
    if (storedId) {
      setGridStore('currentLayoutId', storedId);
    }
    setGridStore('isInitialized', true);
    callback?.();
  }
};

export const getCurrentLayout = (): DesktopLayout => {
  return gridStore.layouts.find(l => l.id === gridStore.currentLayoutId)!;
};

export const getCurrentElements = (): GridElement[] => {
  return getCurrentLayout()?.elements || [];
};

export const getCurrentRows = (): number => {
  return calculateRequiredRows(getCurrentElements());
};

let beforeSwitchLayoutCallback: ((prevId: string, newId: string) => void) | null = null;

export const registerBeforeSwitchCallback = (callback: (prevId: string, newId: string) => void) => {
  beforeSwitchLayoutCallback = callback;
};

export const switchLayout = (layoutId: string): void => {
  const prevId = gridStore.currentLayoutId;
  if (beforeSwitchLayoutCallback && prevId !== layoutId) {
    beforeSwitchLayoutCallback(prevId, layoutId);
  }
  setGridStore('currentLayoutId', layoutId);
  saveToStorage();
};

export const addElement = (element: GridElement): boolean => {
  const layout = getCurrentLayout();
  const otherElements = layout.elements;

  let finalPosition = element.position;

  if (!finalPosition) {
    const gridSize = getCurrentGridSystemSize();
    const position = findAvailablePosition(
      element.size,
      gridSize.columns,
      0,
      otherElements
    );
    if (!position) return false;
    finalPosition = position;
  }

  setGridStore(
    'layouts',
    layout => layout.id === gridStore.currentLayoutId,
    'elements',
    elements => [...elements, { ...element, position: finalPosition }]
  );

  saveToStorage();
  return true;
};

export const moveElement = (
  elementId: string,
  newPosition: GridPosition
): boolean => {
  const elements = getCurrentElements();
  const element = elements.find(e => e.id === elementId);

  if (!element) return false;

  const otherElements = elements.filter(e => e.id !== elementId);
  const gridSize = getCurrentGridSystemSize();
  const maxRows = calculateRequiredRows(elements);

  if (!isValidPosition(newPosition, element.size, gridSize.columns, maxRows, otherElements)) {
    return false;
  }

  setGridStore(
    'layouts',
    layout => layout.id === gridStore.currentLayoutId,
    'elements',
    (e: any) => e.id === elementId,
    'position',
    newPosition
  );

  saveToStorage();
  return true;
};

export const removeElement = (elementId: string): void => {
  setGridStore(
    'layouts',
    layout => layout.id === gridStore.currentLayoutId,
    'elements',
    elements => elements.filter(e => e.id !== elementId)
  );
  saveToStorage();
};

export const updateIconElement = (elementId: string, name: string, url: string): boolean => {
  const elements = getCurrentElements();
  const element = elements.find(e => e.id === elementId);

  if (!element || element.type !== 'icon') return false;

  setGridStore(
    'layouts',
    layout => layout.id === gridStore.currentLayoutId,
    'elements',
    (e: any) => e.id === elementId,
    'data',
    {
      ...(element.data || {}),
      name,
      url,
    }
  );

  saveToStorage();
  return true;
};

export const updateElementState = (elementId: string, state: Record<string, any>): void => {
  setGridStore(
    'layouts',
    layout => layout.id === gridStore.currentLayoutId,
    'elements',
    (e: any) => e.id === elementId,
    'state',
    state
  );
  saveToStorage();
};

export const addLayout = (name: string, iconId?: string): void => {
  const newLayout: DesktopLayout = {
    id: `desktop-${Date.now()}`,
    name,
    elements: [],
    iconId,
  };
  setGridStore('layouts', layouts => [...layouts, newLayout]);
  saveToStorage();
};

export const deleteLayout = (layoutId: string): void => {
  const layouts = gridStore.layouts;
  if (layouts.length <= 1) return;

  const deletedIndex = layouts.findIndex(l => l.id === layoutId);
  if (deletedIndex === -1) return;

  if (gridStore.currentLayoutId === layoutId) {
    const newIndex = deletedIndex > 0 ? deletedIndex - 1 : 1;
    setGridStore('currentLayoutId', layouts[newIndex].id);
  }

  setGridStore('layouts', layouts => layouts.filter(l => l.id !== layoutId));
  saveToStorage();
};

export const updateLayout = (layoutId: string, name: string, iconId?: string): void => {
  const layout = gridStore.layouts.find(l => l.id === layoutId);
  if (!layout) return;

  const newIconId = (iconId !== undefined && iconId !== '') ? iconId : layout.iconId;

  setGridStore(
    'layouts',
    layouts => layouts.map(l =>
      l.id === layoutId
        ? { ...l, name, iconId: newIconId }
        : l
    )
  );
  saveToStorage();
};

export const startDrag = (element: GridElement): void => {
  setGridStore('dragState', {
    isDragging: true,
    element,
    startPosition: element.position,
    currentPosition: element.position,
  });
};

export const updateDragPosition = (position: GridPosition): void => {
  setGridStore('dragState', 'currentPosition', position);
};

export const endDrag = (commit: boolean = true): void => {
  const { element, currentPosition } = gridStore.dragState;

  if (commit && element && currentPosition) {
    const success = moveElement(element.id, currentPosition);
    if (!success) {
      moveElement(element.id, element.position);
    }
  }

  setGridStore('dragState', {
    isDragging: false,
    element: null,
    startPosition: null,
    currentPosition: null,
  });
};

export const resetLayout = (): void => {
  const defaultLayouts = getDefaultLayouts();
  const defaultIds = new Set(defaultLayouts.map(l => l.id));
  
  const userLayouts = gridStore.layouts.filter(l => !defaultIds.has(l.id));
  
  const resetLayouts = defaultLayouts.map(defaultLayout => ({
    ...defaultLayout,
    elements: [...defaultLayout.elements],
  }));
  
  setGridStore('layouts', [...resetLayouts, ...userLayouts]);
  setGridStore('currentLayoutId', 'desktop-1');
  saveToStorage();
};

export const saveLayouts = saveToStorage;
export const loadLayouts = loadFromStorage;
