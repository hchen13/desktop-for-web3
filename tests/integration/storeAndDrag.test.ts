/**
 * 跨模块集成测试：store + DragSystem 行为协同
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  gridStore,
  setGridStore,
  loadFromStorage,
  addElement,
  moveElement,
  removeElement,
  switchLayout,
} from '../../src/grid/store';
import { calculateNewLayout } from '../../src/events/DragSystem';
import { clampGridPosition } from '../../src/grid/utils';
import type { GridElement, DesktopLayout, GridSystemSize } from '../../src/grid/types';

const sys: GridSystemSize = { columns: 8, rows: 6 };

const memStorage = (globalThis as any).__memoryStorage;

const resetStore = () => {
  setGridStore({
    layouts: [
      { id: 'desktop-1', name: 'A', elements: [] } as DesktopLayout,
      { id: 'desktop-2', name: 'B', elements: [] } as DesktopLayout,
    ],
    currentLayoutId: 'desktop-1',
    dragState: {
      isDragging: false,
      element: null,
      startPosition: null,
      currentPosition: null,
    },
    isInitialized: true,
  });
  memStorage.__reset();
  (globalThis as any).window.innerWidth = 1500;
  (globalThis as any).window.innerHeight = 900;
};

describe('store + DragSystem integration', () => {
  beforeEach(resetStore);

  it('default load → drag → persist → reload preserves state', () =>
    new Promise<void>((resolve) => {
      // Load defaults (empty)
      loadFromStorage(() => {
        const el: GridElement = {
          id: 'a',
          type: 'icon',
          position: { x: 0, y: 0 },
          size: { width: 1, height: 1 },
        };
        addElement(el);
        moveElement('a', { x: 3, y: 0 });

        // Snapshot storage, then reset and reload
        const snapshot = JSON.parse(JSON.stringify(memStorage.__getStore()));
        resetStore();
        memStorage.__setStore(snapshot);

        loadFromStorage(() => {
          const layout = gridStore.layouts.find((l) => l.id === 'desktop-1')!;
          const found = layout.elements.find((e) => e.id === 'a');
          expect(found?.position).toEqual({ x: 3, y: 0 });
          resolve();
        });
      });
    }));

  it('switching desktops preserves their independent layouts', () => {
    addElement({
      id: 'a',
      type: 'icon',
      position: { x: 0, y: 0 },
      size: { width: 1, height: 1 },
    });
    expect(gridStore.layouts[0].elements).toHaveLength(1);

    switchLayout('desktop-2');
    expect(gridStore.layouts[1].elements).toHaveLength(0);

    addElement({
      id: 'b',
      type: 'icon',
      position: { x: 1, y: 1 },
      size: { width: 1, height: 1 },
    });
    expect(gridStore.layouts[1].elements).toHaveLength(1);

    switchLayout('desktop-1');
    expect(gridStore.layouts[0].elements).toHaveLength(1);
    expect(gridStore.layouts[0].elements[0].id).toBe('a');
  });

  it('drop onto fixed element rejects via moveElement (no change)', () => {
    setGridStore('layouts', 0, 'elements', [
      {
        id: 'fixed',
        type: 'fixed',
        position: { x: 4, y: 0 },
        size: { width: 1, height: 1 },
        fixed: true,
      },
      {
        id: 'a',
        type: 'icon',
        position: { x: 0, y: 0 },
        size: { width: 1, height: 1 },
      },
    ]);

    expect(moveElement('a', { x: 4, y: 0 })).toBe(false);
    const a = gridStore.layouts[0].elements.find((e) => e.id === 'a')!;
    expect(a.position).toEqual({ x: 0, y: 0 });
  });

  it('clamp via clampGridPosition keeps element within viewport', () => {
    const clamped = clampGridPosition({ x: 100, y: 100 }, { width: 2, height: 2 }, sys);
    expect(clamped).toEqual({ x: 6, y: 4 });

    // BFS layout uses this clamp internally — the result must be within bounds
    const elements: GridElement[] = [
      { id: 'a', type: 'widget', position: { x: 0, y: 0 }, size: { width: 1, height: 1 } },
    ];
    const result = calculateNewLayout(elements, 'a', { x: 100, y: 100 }, sys);
    const aPos = result.get('a')!;
    expect(aPos.x + 1).toBeLessThanOrEqual(sys.columns);
    expect(aPos.y + 1).toBeLessThanOrEqual(sys.rows);
  });

  it('full element lifecycle: add → move → remove', () => {
    const el: GridElement = {
      id: 'lifecycle',
      type: 'icon',
      position: { x: 0, y: 0 },
      size: { width: 1, height: 1 },
    };
    expect(addElement(el)).toBe(true);
    expect(gridStore.layouts[0].elements).toHaveLength(1);

    expect(moveElement('lifecycle', { x: 4, y: 2 })).toBe(true);
    expect(gridStore.layouts[0].elements[0].position).toEqual({ x: 4, y: 2 });

    removeElement('lifecycle');
    expect(gridStore.layouts[0].elements).toHaveLength(0);

    // All operations should have triggered persistence
    expect(memStorage.set).toHaveBeenCalled();
  });
});
