/**
 * EventOrchestrator integration tests
 * 验证 mousedown/mousemove/mouseup 决策、点击 vs 拖拽阈值、右键优先级等
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { EventOrchestrator } from './EventOrchestrator';
import { DRAG_THRESHOLD } from './constants';

const fireMouseEvent = (
  el: Element | Document,
  type: 'mousedown' | 'mousemove' | 'mouseup' | 'contextmenu',
  init: Partial<MouseEvent> = {},
) => {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: init.button ?? 0,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
  });
  el.dispatchEvent(ev);
  return ev;
};

const renderWithGridElement = (handlers: any, getById?: (id: string) => any) => {
  return render(() => (
    <EventOrchestrator handlers={handlers} getElementById={getById}>
      <div class="grid-element" data-element-id="el-1" style={{ width: '100px', height: '100px' }}>
        content
      </div>
      <div class="sidebar">
        <button class="sidebar-btn">sidebar action</button>
      </div>
    </EventOrchestrator>
  ));
};

describe('EventOrchestrator threshold behavior', () => {
  beforeEach(() => {
    cleanup();
  });

  it('move <= 5px (4px) -> click only, no drag', () => {
    const onDragStart = vi.fn();
    const onDragMove = vi.fn();
    const onDragEnd = vi.fn();
    const { container } = renderWithGridElement({
      onDragStart,
      onDragMove,
      onDragEnd,
    });
    const grid = container.querySelector('.grid-element')!;

    fireMouseEvent(grid, 'mousedown', { clientX: 100, clientY: 100 });
    fireMouseEvent(document, 'mousemove', { clientX: 104, clientY: 100 });
    fireMouseEvent(document, 'mouseup', { clientX: 104, clientY: 100 });

    expect(onDragStart).toHaveBeenCalledTimes(1); // potential drag start
    expect(onDragMove).not.toHaveBeenCalled(); // didn't cross threshold
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    const [, wasDragging] = onDragEnd.mock.calls[0];
    expect(wasDragging).toBe(false);
  });

  it('move == 5px -> still click (strictly greater than)', () => {
    const onDragMove = vi.fn();
    const onDragEnd = vi.fn();
    const { container } = renderWithGridElement({ onDragMove, onDragEnd });
    const grid = container.querySelector('.grid-element')!;

    fireMouseEvent(grid, 'mousedown', { clientX: 100, clientY: 100 });
    fireMouseEvent(document, 'mousemove', { clientX: 100 + DRAG_THRESHOLD, clientY: 100 });
    fireMouseEvent(document, 'mouseup', { clientX: 100 + DRAG_THRESHOLD, clientY: 100 });

    expect(onDragMove).not.toHaveBeenCalled();
    const [, wasDragging] = onDragEnd.mock.calls[0];
    expect(wasDragging).toBe(false);
  });

  it('move > 5px -> drag', () => {
    const onDragMove = vi.fn();
    const onDragEnd = vi.fn();
    const { container } = renderWithGridElement({ onDragMove, onDragEnd });
    const grid = container.querySelector('.grid-element')!;

    fireMouseEvent(grid, 'mousedown', { clientX: 100, clientY: 100 });
    fireMouseEvent(document, 'mousemove', { clientX: 110, clientY: 100 });
    fireMouseEvent(document, 'mouseup', { clientX: 110, clientY: 100 });

    expect(onDragMove).toHaveBeenCalled();
    const [, wasDragging] = onDragEnd.mock.calls[0];
    expect(wasDragging).toBe(true);
  });

  it('mousedown + delayed mouseup with no movement -> click', () => {
    const onDragEnd = vi.fn();
    const { container } = renderWithGridElement({ onDragEnd });
    const grid = container.querySelector('.grid-element')!;

    fireMouseEvent(grid, 'mousedown', { clientX: 100, clientY: 100 });
    // No movement
    fireMouseEvent(document, 'mouseup', { clientX: 100, clientY: 100 });

    const [, wasDragging] = onDragEnd.mock.calls[0];
    expect(wasDragging).toBe(false);
  });
});

describe('EventOrchestrator right-click priority', () => {
  beforeEach(() => {
    cleanup();
  });

  it('right-click on grid -> context-menu', () => {
    const onContextMenu = vi.fn();
    const { container } = renderWithGridElement({ onContextMenu });
    const grid = container.querySelector('.grid-element')!;

    fireMouseEvent(grid, 'mousedown', { button: 2, clientX: 50, clientY: 50 });

    expect(onContextMenu).toHaveBeenCalledTimes(1);
  });

  it('right-click in sidebar -> context-menu (after fix)', () => {
    const onContextMenu = vi.fn();
    const { container } = renderWithGridElement({ onContextMenu });
    const sidebarBtn = container.querySelector('.sidebar-btn')!;

    fireMouseEvent(sidebarBtn, 'mousedown', { button: 2, clientX: 10, clientY: 10 });

    // Right-click priority is now above sidebar — should fire context menu
    expect(onContextMenu).toHaveBeenCalledTimes(1);
  });
});

describe('EventOrchestrator interactive elements', () => {
  beforeEach(() => {
    cleanup();
  });

  it('mousedown on interactive (button) inside grid -> no drag', () => {
    const onDragStart = vi.fn();
    const { container } = render(() => (
      <EventOrchestrator handlers={{ onDragStart }}>
        <div class="grid-element" data-element-id="el-1">
          <button class="inner-btn">click me</button>
        </div>
      </EventOrchestrator>
    ));
    const btn = container.querySelector('.inner-btn')!;

    fireMouseEvent(btn, 'mousedown', { button: 0, clientX: 50, clientY: 50 });

    expect(onDragStart).not.toHaveBeenCalled();
  });
});

describe('EventOrchestrator drag-then-cleanup', () => {
  beforeEach(() => {
    cleanup();
  });

  it('drag completes — second mousedown sees clean state', () => {
    const onDragEnd = vi.fn();
    const { container } = renderWithGridElement({ onDragEnd });
    const grid = container.querySelector('.grid-element')!;

    fireMouseEvent(grid, 'mousedown', { clientX: 100, clientY: 100 });
    fireMouseEvent(document, 'mousemove', { clientX: 200, clientY: 200 });
    fireMouseEvent(document, 'mouseup', { clientX: 200, clientY: 200 });

    expect(onDragEnd).toHaveBeenCalledTimes(1);

    // second mousedown should NOT be in drag state immediately
    fireMouseEvent(grid, 'mousedown', { clientX: 50, clientY: 50 });
    fireMouseEvent(document, 'mouseup', { clientX: 50, clientY: 50 });

    expect(onDragEnd).toHaveBeenCalledTimes(2);
    const [, wasDragging] = onDragEnd.mock.calls[1];
    expect(wasDragging).toBe(false);
  });
});

describe('EventOrchestrator threshold consistency with DragSystem', () => {
  it('DRAG_THRESHOLD constant is shared between modules', async () => {
    const orchestratorThreshold = (await import('./constants')).DRAG_THRESHOLD;
    const typesThreshold = (await import('./types')).DRAG_THRESHOLD;
    expect(orchestratorThreshold).toBe(typesThreshold);
    expect(orchestratorThreshold).toBe(5);
  });
});

describe('EventOrchestrator getElementById fixed-element check', () => {
  beforeEach(() => {
    cleanup();
  });

  it('fixed element returns interaction (not drag)', () => {
    const onDragStart = vi.fn();
    const { container } = renderWithGridElement({ onDragStart }, (id: string) => {
      if (id === 'el-1') return { fixed: true, type: 'fixed' };
      return null;
    });
    const grid = container.querySelector('.grid-element')!;

    fireMouseEvent(grid, 'mousedown', { button: 0, clientX: 50, clientY: 50 });

    expect(onDragStart).not.toHaveBeenCalled();
  });

  it('non-fixed element returns drag', () => {
    const onDragStart = vi.fn();
    const { container } = renderWithGridElement({ onDragStart }, (id: string) => {
      if (id === 'el-1') return { fixed: false, type: 'widget' };
      return null;
    });
    const grid = container.querySelector('.grid-element')!;

    fireMouseEvent(grid, 'mousedown', { button: 0, clientX: 50, clientY: 50 });

    expect(onDragStart).toHaveBeenCalledTimes(1);
  });
});
