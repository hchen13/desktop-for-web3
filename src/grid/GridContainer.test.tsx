/**
 * GridContainer tests
 * keep-alive 下 GridContainer 渲染的 layout（props.layoutId）可能不是 gridStore.currentLayoutId，
 * 所有写操作都必须落在自己渲染的那个 layout 上
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { GridContainer } from './GridContainer';
import { gridStore, setGridStore } from './store';
import { calculateGridSystemSize, getAnchorColumn } from './utils';
import type { GridElement } from './types';

const VIEWPORT_WIDTH = 1500;
const VIEWPORT_HEIGHT = 900;
const ANCHOR = getAnchorColumn(calculateGridSystemSize(VIEWPORT_WIDTH, VIEWPORT_HEIGHT).columns);

const iconAt = (id: string, absoluteX: number): GridElement => ({
  id,
  type: 'icon',
  position: { x: absoluteX - ANCHOR, y: 0 },
  size: { width: 1, height: 1 },
  data: { name: id, url: `https://${id}.example.com` },
});

const layoutOf = (id: string) => gridStore.layouts.find((l) => l.id === id)!;

const fireMouse = (
  target: Element | Document,
  type: 'mousedown' | 'mousemove' | 'mouseup' | 'contextmenu',
  clientX: number,
  clientY: number,
) => {
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY }),
  );
};

const clickMenuItem = (label: string) => {
  const item = Array.from(document.querySelectorAll<HTMLButtonElement>('.context-menu__item')).find(
    (el) => el.textContent === label,
  );
  if (!item) throw new Error(`context menu item not found: ${label}`);
  item.click();
};

describe('GridContainer 写操作落在 props.layoutId 对应的 layout', () => {
  beforeEach(() => {
    (globalThis as any).window.innerWidth = VIEWPORT_WIDTH;
    (globalThis as any).window.innerHeight = VIEWPORT_HEIGHT;

    // 容器与元素的 rect 都返回同一个大矩形：拖拽落点只取决于 mousedown / mouseup 的 client 坐标差
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 3000,
      bottom: 3000,
      width: 3000,
      height: 3000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    setGridStore({
      layouts: [
        { id: 'desktop-1', name: 'A', elements: [iconAt('a-1', 0)] },
        { id: 'desktop-2', name: 'B', elements: [iconAt('b-1', 0)] },
      ],
      // 可见的是 desktop-2，但 store 的 currentLayoutId 停在 desktop-1（keep-alive 失同步）
      currentLayoutId: 'desktop-1',
      dragState: {
        isDragging: false,
        element: null,
        startPosition: null,
        currentPosition: null,
      },
      isInitialized: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('拖拽落位写入被渲染的 layout', () => {
    const { container } = render(() => <GridContainer layoutId="desktop-2" />);
    const element = container.querySelector<HTMLElement>('[data-element-id="b-1"]')!;

    fireMouse(element, 'mousedown', 5, 5);
    fireMouse(document, 'mousemove', 245, 5);
    fireMouse(document, 'mouseup', 245, 5);

    expect(layoutOf('desktop-2').elements[0].position).toEqual({ x: 2 - ANCHOR, y: 0 });
    expect(layoutOf('desktop-1').elements[0].position).toEqual({ x: -ANCHOR, y: 0 });
  });

  it('右键删除从被渲染的 layout 移除元素', () => {
    const { container } = render(() => <GridContainer layoutId="desktop-2" />);

    fireMouse(container.querySelector('[data-element-id="b-1"]')!, 'contextmenu', 40, 40);
    clickMenuItem('删除');

    expect(layoutOf('desktop-2').elements).toHaveLength(0);
    expect(layoutOf('desktop-1').elements).toHaveLength(1);
  });

  it('右键添加图标加到被渲染的 layout', () => {
    const { container } = render(() => <GridContainer layoutId="desktop-2" />);

    fireMouse(container.querySelector('.grid-area')!, 'contextmenu', 245, 5);
    clickMenuItem('添加图标');

    fireEvent.input(document.querySelector('#icon-name-input')!, { target: { value: 'Solid' } });
    fireEvent.input(document.querySelector('#icon-url-input')!, {
      target: { value: 'solidjs.com' },
    });
    document.querySelector<HTMLButtonElement>('.add-icon-dialog__btn--confirm')!.click();

    expect(layoutOf('desktop-2').elements).toHaveLength(2);
    expect(layoutOf('desktop-1').elements).toHaveLength(1);
  });

  it('编辑图标改写被渲染的 layout 中的元素', () => {
    const { container } = render(() => <GridContainer layoutId="desktop-2" />);

    fireMouse(container.querySelector('[data-element-id="b-1"]')!, 'contextmenu', 40, 40);
    clickMenuItem('编辑');

    fireEvent.input(document.querySelector('#icon-name-input')!, { target: { value: '改名了' } });
    document.querySelector<HTMLButtonElement>('.add-icon-dialog__btn--confirm')!.click();

    expect((layoutOf('desktop-2').elements[0].data as any).name).toBe('改名了');
  });
});
