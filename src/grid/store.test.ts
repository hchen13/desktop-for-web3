/**
 * Grid store tests
 * 注意：store 是模块单例 — 通过 setGridStore 在每个测试前重置
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  gridStore,
  setGridStore,
  loadFromStorage,
  addElement,
  moveElement,
  removeElement,
  addLayout,
  deleteLayout,
  resetLayout,
  switchLayout,
  registerBeforeSwitchCallback,
  getCurrentElements,
  getCurrentLayout,
} from './store';
import type { DesktopLayout, GridElement } from './types';

const STORAGE_KEY = 'gridLayouts';
const STORAGE_CURRENT_ID_KEY = 'currentLayoutId';

const baseLayout = (id: string, elements: GridElement[] = []): DesktopLayout => ({
  id,
  name: id,
  elements,
});

const resetStore = () => {
  setGridStore({
    layouts: [baseLayout('desktop-1', [])],
    currentLayoutId: 'desktop-1',
    dragState: {
      isDragging: false,
      element: null,
      startPosition: null,
      currentPosition: null,
    },
    isInitialized: false,
  });
};

const memStorage = (globalThis as any).__memoryStorage;

describe('loadFromStorage', () => {
  beforeEach(() => {
    resetStore();
    memStorage.__reset();
    // Set viewport so calculateGridSystemSize doesn't return min
    (globalThis as any).window.innerWidth = 1200;
    (globalThis as any).window.innerHeight = 800;
  });

  it('empty storage -> defaults + isInitialized=true', () =>
    new Promise<void>((resolve) => {
      loadFromStorage(() => {
        expect(gridStore.isInitialized).toBe(true);
        expect(gridStore.layouts.length).toBeGreaterThan(0);
        resolve();
      });
    }));

  it('storage with valid layouts -> restored', () =>
    new Promise<void>((resolve) => {
      const stored = [baseLayout('desktop-x', [])];
      memStorage.__setStore({
        [STORAGE_KEY]: stored,
        [STORAGE_CURRENT_ID_KEY]: 'desktop-x',
      });
      loadFromStorage(() => {
        expect(gridStore.layouts).toHaveLength(1);
        expect(gridStore.layouts[0].id).toBe('desktop-x');
        expect(gridStore.currentLayoutId).toBe('desktop-x');
        expect(gridStore.isInitialized).toBe(true);
        resolve();
      });
    }));

  it('chrome.runtime.lastError -> still sets isInitialized=true', () =>
    new Promise<void>((resolve) => {
      // Replace .get to simulate lastError
      const origGet = memStorage.get;
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      memStorage.get = vi.fn((_keys: any, cb: any) => {
        (globalThis as any).chrome.runtime.lastError = { message: 'boom' };
        cb({});
        // Reset for next test
        (globalThis as any).chrome.runtime.lastError = undefined;
      });
      loadFromStorage(() => {
        expect(gridStore.isInitialized).toBe(true);
        memStorage.get = origGet;
        errorSpy.mockRestore();
        resolve();
      });
    }));

  it('storage callback throws -> still sets isInitialized=true', () =>
    new Promise<void>((resolve) => {
      const origGet = memStorage.get;
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      // Return data that will cause the assignment to fail (e.g. a getter that throws)
      memStorage.get = vi.fn((_keys: any, cb: any) => {
        const bad: any = {};
        Object.defineProperty(bad, STORAGE_KEY, {
          get() {
            throw new Error('boom');
          },
        });
        cb(bad);
      });
      loadFromStorage(() => {
        expect(gridStore.isInitialized).toBe(true);
        memStorage.get = origGet;
        errorSpy.mockRestore();
        resolve();
      });
    }));
});

describe('addElement', () => {
  beforeEach(() => {
    resetStore();
    (globalThis as any).window.innerWidth = 1500;
    (globalThis as any).window.innerHeight = 900;
  });

  it('with explicit position adds successfully', () => {
    const el: GridElement = {
      id: 'e1',
      type: 'icon',
      position: { x: 0, y: 0 },
      size: { width: 1, height: 1 },
    };
    expect(addElement(el)).toBe(true);
    expect(getCurrentElements()).toHaveLength(1);
  });

  it('without position auto-finds available', () => {
    const el: GridElement = {
      id: 'e1',
      type: 'icon',
      position: undefined as any,
      size: { width: 1, height: 1 },
    };
    expect(addElement(el)).toBe(true);
    const added = getCurrentElements()[0];
    expect(added.position).toBeDefined();
  });

  it('returns false when no space available', () => {
    // viewport gives ~10 cols x 6 rows; fill within search range
    (globalThis as any).window.innerWidth = 800; // 6 cols
    setGridStore('layouts', 0, 'elements', []);
    const elements: GridElement[] = [];
    for (let y = 0; y < 21; y++) {
      for (let x = 0; x < 6; x++) {
        elements.push({
          id: `f-${x}-${y}`,
          type: 'icon',
          position: { x, y },
          size: { width: 1, height: 1 },
        });
      }
    }
    setGridStore('layouts', 0, 'elements', elements);
    const el: GridElement = {
      id: 'big',
      type: 'widget',
      position: undefined as any,
      size: { width: 6, height: 1 },
    };
    expect(addElement(el)).toBe(false);
  });
});

describe('moveElement', () => {
  beforeEach(() => {
    resetStore();
    (globalThis as any).window.innerWidth = 1500;
    (globalThis as any).window.innerHeight = 900;
    setGridStore('layouts', 0, 'elements', [
      { id: 'a', type: 'widget', position: { x: 0, y: 0 }, size: { width: 1, height: 1 } },
      { id: 'b', type: 'widget', position: { x: 2, y: 0 }, size: { width: 1, height: 1 } },
    ]);
  });

  it('valid move succeeds', () => {
    expect(moveElement('a', { x: 1, y: 0 })).toBe(true);
    const a = getCurrentElements().find((e) => e.id === 'a')!;
    expect(a.position).toEqual({ x: 1, y: 0 });
  });

  it('conflict returns false, no change', () => {
    expect(moveElement('a', { x: 2, y: 0 })).toBe(false);
    const a = getCurrentElements().find((e) => e.id === 'a')!;
    expect(a.position).toEqual({ x: 0, y: 0 });
  });

  it('non-existent element returns false', () => {
    expect(moveElement('zzz', { x: 0, y: 0 })).toBe(false);
  });
});

describe('removeElement', () => {
  beforeEach(() => {
    resetStore();
    setGridStore('layouts', 0, 'elements', [
      { id: 'a', type: 'widget', position: { x: 0, y: 0 }, size: { width: 1, height: 1 } },
    ]);
  });

  it('removes the element and persists', () => {
    removeElement('a');
    expect(getCurrentElements()).toHaveLength(0);
    // Persistence: chrome.storage.local.set called
    expect(memStorage.set).toHaveBeenCalled();
  });
});

describe('layout management', () => {
  beforeEach(() => {
    resetStore();
  });

  it('deleteLayout refuses when only one remains', () => {
    deleteLayout('desktop-1');
    expect(gridStore.layouts).toHaveLength(1);
  });

  it('deleteLayout switches when current is deleted', () => {
    // 直接操纵 store 以避免 Date.now() 时间戳碰撞
    setGridStore('layouts', [
      { id: 'desktop-1', name: '主页', elements: [] },
      { id: 'desktop-2', name: 'Other', elements: [] },
      { id: 'desktop-3', name: 'Third', elements: [] },
    ]);
    setGridStore('currentLayoutId', 'desktop-2');
    deleteLayout('desktop-2');
    expect(gridStore.layouts).toHaveLength(2);
    expect(gridStore.currentLayoutId).not.toBe('desktop-2');
  });

  it('resetLayout preserves user layouts', () => {
    setGridStore('layouts', [
      ...gridStore.layouts,
      { id: 'user-custom-1', name: 'My Layout', elements: [] },
    ]);
    resetLayout();
    expect(gridStore.layouts.some((l) => l.id === 'user-custom-1')).toBe(true);
  });

  it('switchLayout fires beforeSwitchCallback', () => {
    setGridStore('layouts', [
      { id: 'desktop-1', name: '主页', elements: [] },
      { id: 'desktop-other', name: 'Other', elements: [] },
    ]);
    const cb = vi.fn();
    const unsub = registerBeforeSwitchCallback(cb);
    switchLayout('desktop-other');
    expect(cb).toHaveBeenCalledWith('desktop-1', 'desktop-other');
    expect(gridStore.currentLayoutId).toBe('desktop-other');
    unsub();
  });

  it('switchLayout does not fire callback when same id', () => {
    const cb = vi.fn();
    const unsub = registerBeforeSwitchCallback(cb);
    switchLayout('desktop-1');
    expect(cb).not.toHaveBeenCalled();
    unsub();
  });

  it('multiple beforeSwitch callbacks all fire', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    setGridStore('layouts', [
      { id: 'desktop-1', name: '主页', elements: [] },
      { id: 'desktop-b', name: 'B', elements: [] },
    ]);
    const unsub1 = registerBeforeSwitchCallback(cb1);
    const unsub2 = registerBeforeSwitchCallback(cb2);
    switchLayout('desktop-b');
    expect(cb1).toHaveBeenCalledWith('desktop-1', 'desktop-b');
    expect(cb2).toHaveBeenCalledWith('desktop-1', 'desktop-b');
    unsub1();
    unsub2();
  });

  it('unsubscribe stops further callback firings', () => {
    const cb = vi.fn();
    setGridStore('layouts', [
      { id: 'desktop-1', name: '主页', elements: [] },
      { id: 'desktop-b', name: 'B', elements: [] },
      { id: 'desktop-c', name: 'C', elements: [] },
    ]);
    const unsub = registerBeforeSwitchCallback(cb);
    switchLayout('desktop-b');
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
    switchLayout('desktop-c');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('callback that throws does not break switch', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const goodCb = vi.fn();
    setGridStore('layouts', [
      { id: 'desktop-1', name: '主页', elements: [] },
      { id: 'desktop-b', name: 'B', elements: [] },
    ]);
    registerBeforeSwitchCallback(() => {
      throw new Error('boom');
    });
    registerBeforeSwitchCallback(goodCb);
    switchLayout('desktop-b');
    expect(goodCb).toHaveBeenCalled();
    expect(gridStore.currentLayoutId).toBe('desktop-b');
    errorSpy.mockRestore();
  });
});

describe('persistence round-trip', () => {
  beforeEach(() => {
    resetStore();
    memStorage.__reset();
  });

  it('addElement triggers persistence', () => {
    const el: GridElement = {
      id: 'e1',
      type: 'icon',
      position: { x: 0, y: 0 },
      size: { width: 1, height: 1 },
    };
    addElement(el);
    expect(memStorage.set).toHaveBeenCalled();
    const stored = memStorage.__getStore();
    expect(stored[STORAGE_KEY]).toBeDefined();
  });

  it('saved layouts can be restored on next load', () =>
    new Promise<void>((resolve) => {
      const el: GridElement = {
        id: 'e1',
        type: 'icon',
        position: { x: 1, y: 1 },
        size: { width: 1, height: 1 },
      };
      addElement(el);
      const saved = memStorage.__getStore();
      expect(saved[STORAGE_KEY][0].elements).toHaveLength(1);

      // Reset store then reload
      resetStore();
      loadFromStorage(() => {
        expect(getCurrentElements()).toHaveLength(1);
        expect(getCurrentElements()[0].id).toBe('e1');
        resolve();
      });
    }));
});

describe('getCurrentLayout / getCurrentElements', () => {
  beforeEach(() => resetStore());

  it('returns the active layout', () => {
    expect(getCurrentLayout().id).toBe('desktop-1');
  });

  it('returns elements of active layout', () => {
    setGridStore('layouts', 0, 'elements', [
      { id: 'x', type: 'widget', position: { x: 0, y: 0 }, size: { width: 1, height: 1 } },
    ]);
    expect(getCurrentElements()).toHaveLength(1);
  });
});
