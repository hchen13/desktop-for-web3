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
import {
  findAvailablePosition,
  calculateRequiredRows,
  isValidPosition,
  calculateGridSystemSize,
} from './utils';
import { GRID_CONFIG } from './types';
import defaultLayoutsConfig from '../config/defaultLayouts.json';

const STORAGE_KEY = 'gridLayouts';
const STORAGE_CURRENT_ID_KEY = 'currentLayoutId';

export const getCurrentGridSystemSize = (): GridSystemSize => {
  if (typeof window === 'undefined') {
    return { columns: GRID_CONFIG.minWidth, rows: GRID_CONFIG.minHeight };
  }
  return calculateGridSystemSize(window.innerWidth, window.innerHeight);
};

const getDefaultLayouts = (): DesktopLayout[] => {
  return defaultLayoutsConfig.layouts.map((layout) => ({
    ...layout,
    elements: layout.elements.map((el) => ({
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

  // 加载完成后调用，并在 storage 之前为空时持久化默认布局
  // —— 这样 popup 等其它扩展入口能立即读到布局，无需用户先去交互一下 newtab
  const finish = (didLoadFromStorage: boolean) => {
    setGridStore('isInitialized', true);
    if (!didLoadFromStorage) {
      saveToStorage();
    }
    callback?.();
  };

  const chrome = (window as any).chrome;
  if (chrome?.storage?.local) {
    try {
      chrome.storage.local.get([STORAGE_KEY, STORAGE_CURRENT_ID_KEY], (result: any) => {
        let didLoad = false;
        try {
          const lastError = chrome.runtime?.lastError;
          if (lastError) {
            console.error('[GridStore] storage.local.get error:', lastError);
            finish(false);
            return;
          }
          if (
            result &&
            result[STORAGE_KEY] &&
            Array.isArray(result[STORAGE_KEY]) &&
            result[STORAGE_KEY].length > 0
          ) {
            setGridStore('layouts', result[STORAGE_KEY]);
            didLoad = true;
          }
          if (result && result[STORAGE_CURRENT_ID_KEY]) {
            setGridStore('currentLayoutId', result[STORAGE_CURRENT_ID_KEY]);
          }
        } catch (err) {
          console.error('[GridStore] storage.local callback error:', err);
        }
        finish(didLoad);
      });
    } catch (err) {
      console.error('[GridStore] storage.local.get threw:', err);
      finish(false);
    }
    return;
  }

  let didLoad = false;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const storedId = localStorage.getItem(STORAGE_CURRENT_ID_KEY);
    if (stored) {
      try {
        const layouts = JSON.parse(stored);
        if (Array.isArray(layouts) && layouts.length > 0) {
          setGridStore('layouts', layouts);
          didLoad = true;
        }
      } catch (err) {
        console.error('[GridStore] localStorage parse error, falling back to defaults:', err);
      }
    }
    if (storedId) {
      setGridStore('currentLayoutId', storedId);
    }
  } catch (err) {
    console.error('[GridStore] localStorage access error:', err);
  }
  finish(didLoad);
};

export const getCurrentLayout = (): DesktopLayout => {
  return gridStore.layouts.find((l) => l.id === gridStore.currentLayoutId)!;
};

export const getCurrentElements = (): GridElement[] => {
  return getCurrentLayout()?.elements || [];
};

export const getCurrentRows = (): number => {
  return calculateRequiredRows(getCurrentElements());
};

type BeforeSwitchCallback = (prevId: string, newId: string) => void;
const beforeSwitchLayoutCallbacks = new Set<BeforeSwitchCallback>();

/**
 * 注册布局切换前回调，返回取消订阅函数。多个 widget 可独立订阅。
 */
export const registerBeforeSwitchCallback = (callback: BeforeSwitchCallback): (() => void) => {
  beforeSwitchLayoutCallbacks.add(callback);
  return () => {
    beforeSwitchLayoutCallbacks.delete(callback);
  };
};

export const switchLayout = (layoutId: string): void => {
  const prevId = gridStore.currentLayoutId;
  if (prevId !== layoutId) {
    beforeSwitchLayoutCallbacks.forEach((cb) => {
      try {
        cb(prevId, layoutId);
      } catch (err) {
        console.error('[GridStore] beforeSwitchCallback threw:', err);
      }
    });
  }
  setGridStore('currentLayoutId', layoutId);
  saveToStorage();
};

export const addElement = (element: GridElement, layoutId = gridStore.currentLayoutId): boolean => {
  return addElementToLayout(layoutId, element);
};

/**
 * 添加元素到**指定** layout（不一定是当前 layout）
 * 用于 popup 流程：用户从 popup 选定目标桌面后由 newtab 消费 pendingIconAdds 队列
 */
export const addElementToLayout = (layoutId: string, element: GridElement): boolean => {
  const layout = gridStore.layouts.find((l) => l.id === layoutId);
  if (!layout) return false;

  // 重复 id 直接返回 true（视为已添加，避免 popup 队列被多 tab 消费时重复加）
  if (layout.elements.some((e) => e.id === element.id)) {
    return true;
  }

  const otherElements = layout.elements;
  let finalPosition = element.position;

  if (!finalPosition) {
    const gridSize = getCurrentGridSystemSize();
    const position = findAvailablePosition(element.size, gridSize.columns, 0, otherElements);
    if (!position) return false;
    finalPosition = position;
  }

  setGridStore(
    'layouts',
    (l) => l.id === layoutId,
    'elements',
    (elements) => [...elements, { ...element, position: finalPosition }],
  );

  saveToStorage();
  return true;
};

export const moveElement = (elementId: string, newPosition: GridPosition): boolean => {
  const elements = getCurrentElements();
  const element = elements.find((e) => e.id === elementId);

  if (!element) return false;

  const otherElements = elements.filter((e) => e.id !== elementId);
  const gridSize = getCurrentGridSystemSize();
  const maxRows = calculateRequiredRows(elements);

  if (!isValidPosition(newPosition, element.size, gridSize.columns, maxRows, otherElements)) {
    return false;
  }

  setGridStore(
    'layouts',
    (layout) => layout.id === gridStore.currentLayoutId,
    'elements',
    (e: any) => e.id === elementId,
    'position',
    newPosition,
  );

  saveToStorage();
  return true;
};

export const removeElement = (elementId: string, layoutId = gridStore.currentLayoutId): void => {
  setGridStore(
    'layouts',
    (layout) => layout.id === layoutId,
    'elements',
    (elements) => elements.filter((e) => e.id !== elementId),
  );
  saveToStorage();
};

export const updateIconElement = (
  elementId: string,
  name: string,
  url: string,
  layoutId = gridStore.currentLayoutId,
): boolean => {
  const layout = gridStore.layouts.find((l) => l.id === layoutId);
  const element = layout?.elements.find((e) => e.id === elementId);

  if (!element || element.type !== 'icon') return false;

  setGridStore(
    'layouts',
    (l) => l.id === layoutId,
    'elements',
    (e: any) => e.id === elementId,
    'data',
    {
      ...(element.data || {}),
      name,
      url,
    },
  );

  saveToStorage();
  return true;
};

export const updateElementState = (
  elementId: string,
  state: Record<string, any>,
  layoutId = gridStore.currentLayoutId,
): void => {
  setGridStore(
    'layouts',
    (layout) => layout.id === layoutId,
    'elements',
    (e: any) => e.id === elementId,
    'state',
    state,
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
  setGridStore('layouts', (layouts) => [...layouts, newLayout]);
  saveToStorage();
};

export const deleteLayout = (layoutId: string): void => {
  const layouts = gridStore.layouts;
  if (layouts.length <= 1) return;

  const deletedIndex = layouts.findIndex((l) => l.id === layoutId);
  if (deletedIndex === -1) return;

  if (gridStore.currentLayoutId === layoutId) {
    const newIndex = deletedIndex > 0 ? deletedIndex - 1 : 1;
    setGridStore('currentLayoutId', layouts[newIndex].id);
  }

  setGridStore('layouts', (layouts) => layouts.filter((l) => l.id !== layoutId));
  saveToStorage();
};

export const updateLayout = (layoutId: string, name: string, iconId?: string): void => {
  const layout = gridStore.layouts.find((l) => l.id === layoutId);
  if (!layout) return;

  const newIconId = iconId !== undefined && iconId !== '' ? iconId : layout.iconId;

  setGridStore('layouts', (layouts) =>
    layouts.map((l) => (l.id === layoutId ? { ...l, name, iconId: newIconId } : l)),
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
  const defaultIds = new Set(defaultLayouts.map((l) => l.id));

  const userLayouts = gridStore.layouts.filter((l) => !defaultIds.has(l.id));

  const resetLayouts = defaultLayouts.map((defaultLayout) => ({
    ...defaultLayout,
    elements: [...defaultLayout.elements],
  }));

  setGridStore('layouts', [...resetLayouts, ...userLayouts]);
  setGridStore('currentLayoutId', 'desktop-1');
  saveToStorage();
};

export const saveLayouts = saveToStorage;
export const loadLayouts = loadFromStorage;

// ============================================================================
// Popup → Newtab 联动：pendingIconAdds 队列
// ============================================================================
//
// Popup 从扩展工具栏点击后，写一条 PendingIconAdd 到 chrome.storage.local
// （key = 'pendingIconAdds'）。Newtab 在以下时机消费：
//   1. 启动时（loadFromStorage 后）
//   2. chrome.storage.onChanged 监听（其它 tab 的 popup 写入时）
//
// 消费策略：原子读取 → 全部应用（含去重）→ 写回空数组。
// 多个 newtab 同时打开时存在竞争，但 addElementToLayout 内已做 id 去重，
// 重复消费同一条不会产生多余元素。
// ============================================================================

const STORAGE_PENDING_ADDS_KEY = 'pendingIconAdds';

export interface PendingIconAdd {
  targetLayoutId: string;
  icon: {
    name: string;
    url: string;
    category: string;
  };
  enqueuedAt: number;
}

/** 从 chrome.storage.local 读取并消费 pending 队列 */
export const processPendingIconAdds = (): void => {
  if (typeof window === 'undefined') return;
  const chromeRef = (window as any).chrome;
  if (!chromeRef?.storage?.local) return;

  chromeRef.storage.local.get(STORAGE_PENDING_ADDS_KEY, (result: any) => {
    if (chromeRef.runtime?.lastError) {
      console.error('[GridStore] read pendingIconAdds failed:', chromeRef.runtime.lastError);
      return;
    }
    const queue: PendingIconAdd[] = Array.isArray(result?.[STORAGE_PENDING_ADDS_KEY])
      ? result[STORAGE_PENDING_ADDS_KEY]
      : [];
    if (queue.length === 0) return;

    let applied = 0;
    for (const entry of queue) {
      const element: GridElement = {
        // 用 enqueuedAt 做幂等 id：popup 同一次入队 = 同一个 id，多 tab 消费不会重复加
        id: `icon-popup-${entry.enqueuedAt}`,
        type: 'icon',
        component: 'icon',
        position: undefined as any, // 让 addElementToLayout 自动找位置
        size: { width: 1, height: 1 },
        data: {
          name: entry.icon.name,
          url: entry.icon.url,
          category: (entry.icon.category as 'cex' | 'dex' | 'tools' | 'l2') || 'tools',
        },
      };
      const ok = addElementToLayout(entry.targetLayoutId, element);
      if (ok) applied++;
    }

    // 清空队列（即使有失败的；失败原因通常是布局不存在 / 满，重试也无意义）
    chromeRef.storage.local.set({ [STORAGE_PENDING_ADDS_KEY]: [] }, () => {
      if (chromeRef.runtime?.lastError) {
        console.error('[GridStore] clear pendingIconAdds failed:', chromeRef.runtime.lastError);
      }
    });

    if (applied > 0) {
      console.log(`[GridStore] processed ${applied}/${queue.length} pending icon adds`);
    }
  });
};

/** 注册 chrome.storage.onChanged 监听，popup 加入队列时实时消费 */
let pendingListenerRegistered = false;
export const registerPendingIconAddsListener = (): void => {
  if (pendingListenerRegistered) return;
  if (typeof window === 'undefined') return;
  const chromeRef = (window as any).chrome;
  if (!chromeRef?.storage?.onChanged) return;

  chromeRef.storage.onChanged.addListener((changes: any, areaName: string) => {
    if (areaName !== 'local') return;
    if (!changes[STORAGE_PENDING_ADDS_KEY]) return;
    const newValue = changes[STORAGE_PENDING_ADDS_KEY].newValue;
    if (Array.isArray(newValue) && newValue.length > 0) {
      processPendingIconAdds();
    }
  });
  pendingListenerRegistered = true;
};
