/**
 * Grid 容器组件 - 桌面布局容器
 *
 * 重构版本：使用新的事件系统
 * - EventOrchestrator 统一处理事件
 * - DragSystem 处理拖拽逻辑
 * - 组件专注于渲染
 */

import { onMount, onCleanup, createMemo, createSignal, For, Show, JSX, lazy, Suspense } from 'solid-js';
import { gridStore, setGridStore, removeElement, addElement, updateIconElement, updateElementState, saveLayouts } from './store';
import { useContextMenu } from '../components/layout/ContextMenu';
import { mergeMenuItems, getElementIdFromEvent } from './contextMenuUtils';
import { createInitialWidgetState } from '../config/widgetDefaults';
import {
  getElementWidthPx,
  getElementHeightPx,
  getElementPosition,
  calculateGridSystemSize,
  getGridContainerWidth,
  getGridContainerHeight,
  pixelToGridPosition,
  isValidPosition,
  calculateRequiredRows,
  findAvailablePosition,
  getAnchorColumn,
  anchorToAbsolute,
  absoluteToAnchor,
} from './utils';
import type { GridElement, GridPosition, GridSize, GridSystemSize } from './types';
import { GRID_UNIT, GRID_GAP, GRID_SIZES } from './types';
import { getFavicon } from '../services/faviconService';
import { createDragSystem } from '../events/DragSystem';
import { AddIconDialog } from './AddIconDialog';
import { AddWidgetDialog, type WidgetType } from './AddWidgetDialog';
import { GridIcon } from './GridIcon';
import './grid.css';

// 动态导入 Widget 组件 - 使用 lazy 加载确保组件只创建一次
const lazyCalendar = lazy(() => import('../components/Widgets/CalendarWidget').then(m => ({ default: m.CalendarWidget })));
const lazyNews = lazy(() => import('../components/Widgets/NewsWidget').then(m => ({ default: m.NewsWidget })));
const lazyWatchlist = lazy(() => import('../components/Widgets/WatchlistWidget').then(m => ({ default: m.WatchlistWidget })));
const lazyChainMonitor = lazy(() => import('../components/Widgets/ChainMonitorWidget').then(m => ({ default: m.ChainMonitorWidget })));
const lazyWorldClock = lazy(() => import('../components/Widgets/WorldClockWidget').then(m => ({ default: m.WorldClockWidget })));
const lazyEconMap = lazy(() => import('../components/Widgets/EconMap2Widget').then(m => ({ default: m.EconMapWidget })));
const lazyRateMonitor = lazy(() => import('../components/Widgets/RateMonitorWidget').then(m => ({ default: m.RateMonitorWidget })));
const lazySearch = lazy(() => import('../components/SearchBar/SearchBar').then(m => ({ default: m.SearchBar })));
const lazyTime = lazy(() => import('../components/TimeDisplay/TimeDisplay').then(m => ({ default: m.TimeDisplay })));

// 根据组件名称返回对应的 lazy 组件
const getLazyComponent = (component: string) => {
  switch (component) {
    case 'calendar': return lazyCalendar;
    case 'news': return lazyNews;
    case 'watchlist': return lazyWatchlist;
    case 'chain-monitor': return lazyChainMonitor;
    case 'world-clock': return lazyWorldClock;
    case 'econ-map': return lazyEconMap;
    case 'rate-monitor': return lazyRateMonitor;
    case 'search': return lazySearch;
    case 'time': return lazyTime;
    default: return null;
  }
};

interface GridContainerProps {
  layoutId?: string;
}

export const GridContainer = (props: GridContainerProps = {}) => {
  let containerRef: HTMLDivElement | undefined;
  const dragSystem = createDragSystem();

  // 右键菜单
  const { ContextMenuComponent, showContextMenu, closeContextMenu } = useContextMenu();

  // 添加图标对话框状态
  const [isAddIconDialogOpen, setIsAddIconDialogOpen] = createSignal(false);
  const [rightClickPosition, setRightClickPosition] = createSignal<{ x: number; y: number } | null>(null);

  // 添加组件对话框状态
  const [isAddWidgetDialogOpen, setIsAddWidgetDialogOpen] = createSignal(false);

  // 编辑图标对话框状态
  const [isEditIconDialogOpen, setIsEditIconDialogOpen] = createSignal(false);
  const [editingIconId, setEditingIconId] = createSignal<string | null>(null);
  
  // 编辑图标的初始值
  const editingIconInitialName = createMemo(() => {
    const iconId = editingIconId();
    if (!iconId) return '';
    const element = elements().find(e => e.id === iconId);
    return element && element.type === 'icon' ? (element.data as any)?.name || '' : '';
  });
  
  const editingIconInitialUrl = createMemo(() => {
    const iconId = editingIconId();
    if (!iconId) return '';
    const element = elements().find(e => e.id === iconId);
    return element && element.type === 'icon' ? (element.data as any)?.url || '' : '';
  });

  // 使用传入的 layoutId 或 gridStore 的 currentLayoutId
  const currentLayoutId = () => props.layoutId ?? gridStore.currentLayoutId;

  // 使用 gridStore 创建响应式的 elements（锚点相对坐标）
  const elements = createMemo(() => {
    const layout = gridStore.layouts.find(l => l.id === currentLayoutId());
    return layout?.elements || [];
  });

  // Grid System 尺寸（动态计算）
  const [gridSystemSize, setGridSystemSize] = createSignal<GridSystemSize>(
    calculateGridSystemSize(window.innerWidth, window.innerHeight)
  );

  // 计算锚点列索引
  const anchorColumn = createMemo(() => getAnchorColumn(gridSystemSize().columns));

  // 将元素的锚点相对坐标转换为绝对坐标，供 DragSystem 使用
  const elementsWithAbsolutePositions = createMemo(() => {
    const anchor = anchorColumn();
    return elements().map(el => ({
      ...el,
      position: anchorToAbsolute(el.position, anchor),
    }));
  });

  // 监听窗口大小变化，更新 Grid System 尺寸
  const updateGridSystemSize = () => {
    const newSize = calculateGridSystemSize(window.innerWidth, window.innerHeight);
    setGridSystemSize(newSize);

    // 更新 grid area 容器尺寸
    if (containerRef) {
      const width = getGridContainerWidth(newSize.columns);
      const height = getGridContainerHeight(newSize.rows);
      containerRef.style.width = `${width}px`;
      containerRef.style.height = `${height}px`;
    }
  };

  // 初始化
  onMount(() => {
    // 动态设置 CSS 变量
    document.documentElement.style.setProperty('--grid-unit', `${GRID_UNIT}px`);

    updateGridSystemSize();
    window.addEventListener('resize', updateGridSystemSize);

    // 设置拖拽系统容器和初始状态
    // DragSystem 使用绝对坐标进行计算
    dragSystem.setContainer(containerRef ?? null);
    dragSystem.setGridSystemSize(gridSystemSize());
    dragSystem.setElements(elementsWithAbsolutePositions());

    onCleanup(() => {
      window.removeEventListener('resize', updateGridSystemSize);
    });
  });

  // 监听元素变化，更新拖拽系统（使用绝对坐标）
  createMemo(() => {
    dragSystem.setElements(elementsWithAbsolutePositions());
  });

  // 监听 Grid System 尺寸变化
  createMemo(() => {
    dragSystem.setGridSystemSize(gridSystemSize());
  });

  // 获取拖拽系统的信号
  const dragSignals = dragSystem.getSignals();

  // 拖拽状态
  let dragElementRef: HTMLDivElement | null = null;

  /**
   * 处理右键菜单事件
   */
  const handleContextMenu = (element: GridElement, e: MouseEvent) => {
    // 对于 calendar、chain-monitor 和 world-clock 组件，让组件自己完全处理（包括删除选项）
    const isSelfHandled = (element as any).component === 'calendar'
      || (element as any).component === 'chain-monitor'
      || (element as any).component === 'world-clock';

    if (element.type === 'fixed' && isSelfHandled) {
      // 不阻止默认行为，让组件自己的 onContextMenu 处理
      return;
    }

    // widget 类型的 world-clock 也让组件自己处理
    if (element.type === 'widget' && (element as any).component === 'world-clock') {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    // 默认菜单：只有非固定元素可以删除
    if (element.fixed !== true) {
      const menuItems = [];
      
      // 如果是图标类型，添加编辑选项
      if (element.type === 'icon') {
        menuItems.push({
          label: '编辑',
          variant: 'normal' as const,
          action: () => {
            setEditingIconId(element.id);
            setIsEditIconDialogOpen(true);
          },
        });
      }
      
      menuItems.push({
        label: '删除',
        variant: 'danger' as const,
        action: () => removeElement(element.id),
      });
      
      showContextMenu(e.clientX, e.clientY, menuItems);
    }
    // 时间显示固定元素不提供菜单
  };

  /**
   * 处理空白区域的右键菜单
   */
  const handleEmptyAreaContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // 检查点击位置是否在grid元素上
    const target = e.target as HTMLElement;
    const gridElement = target.closest('.grid-element');
    if (gridElement) {
      // 如果点击在grid元素上，不处理空白区域菜单
      return;
    }

    // 保存右键点击位置（相对于grid容器的坐标）
    if (containerRef) {
      const rect = containerRef.getBoundingClientRect();
      const relativeX = e.clientX - rect.left;
      const relativeY = e.clientY - rect.top;
      setRightClickPosition({ x: relativeX, y: relativeY });
    }

    showContextMenu(e.clientX, e.clientY, [
      {
        label: '添加图标',
        variant: 'normal',
        action: () => {
          setIsAddIconDialogOpen(true);
        },
      },
      {
        label: '添加组件',
        variant: 'normal',
        action: () => {
          setIsAddWidgetDialogOpen(true);
        },
      },
    ]);
  };

  /**
   * 根据鼠标位置找到最近的可用grid位置
   * 注意：pixelToGridPosition 返回绝对坐标，因此必须使用 elementsWithAbsolutePositions 进行冲突检测
   */
  const findNearestAvailableGridPosition = (pixelX: number, pixelY: number): GridPosition | null => {
    if (!containerRef) return null;

    const gridPos = pixelToGridPosition(pixelX, pixelY);
    const size = gridSystemSize();
    const currentElements = elementsWithAbsolutePositions();
    const maxRows = size.rows;

    // 检查当前位置是否可用
    const iconSize = GRID_SIZES.ICON;
    if (isValidPosition(gridPos, iconSize, size.columns, maxRows, currentElements)) {
      return gridPos;
    }

    // 如果当前位置不可用，在附近搜索可用位置
    const searchRadius = 3;
    for (let dy = -searchRadius; dy <= searchRadius; dy++) {
      for (let dx = -searchRadius; dx <= searchRadius; dx++) {
        const testPos: GridPosition = {
          x: gridPos.x + dx,
          y: gridPos.y + dy,
        };

        if (isValidPosition(testPos, iconSize, size.columns, maxRows, currentElements)) {
          return testPos;
        }
      }
    }

    // 如果附近没有可用位置，使用findAvailablePosition
    const availablePos = findAvailablePosition(
      iconSize,
      size.columns,
      Math.max(0, gridPos.y - searchRadius),
      currentElements
    );

    return availablePos;
  };

  /**
   * 处理添加图标确认
   */
  const handleAddIconConfirm = (name: string, url: string) => {
    if (!rightClickPosition()) return;

    let position = findNearestAvailableGridPosition(
      rightClickPosition()!.x,
      rightClickPosition()!.y
    );

    if (!position) {
      // 如果找不到可用位置，尝试在默认位置添加
      const defaultPos = findAvailablePosition(
        GRID_SIZES.ICON,
        gridSystemSize().columns,
        0,
        elementsWithAbsolutePositions()
      );
      if (!defaultPos) {
        setIsAddIconDialogOpen(false);
        setRightClickPosition(null);
        return;
      }
      position = defaultPos;
    }

    const newIcon: GridElement = {
      id: `icon-${Date.now()}`,
      type: 'icon',
      position: absoluteToAnchor(position, anchorColumn()),
      size: GRID_SIZES.ICON,
      data: {
        name,
        url,
        category: 'tools',
      },
    };

    addElement(newIcon);
    setIsAddIconDialogOpen(false);
    setRightClickPosition(null);
  };

  /**
   * 处理编辑图标确认
   */
  const handleEditIconConfirm = (name: string, url: string) => {
    const iconId = editingIconId();
    if (!iconId) return;

    updateIconElement(iconId, name, url);
    setIsEditIconDialogOpen(false);
    setEditingIconId(null);
  };

  /**
   * 获取 Widget 组件的尺寸
   */
  const getWidgetSize = (widgetType: WidgetType): GridSize => {
    switch (widgetType) {
      case 'calendar':
        return GRID_SIZES.CALENDAR_FULL;
      case 'news':
        return { width: 3, height: 3 };
      case 'watchlist':
        return GRID_SIZES.STANDARD_WIDGET;
      case 'chain-monitor':
        return GRID_SIZES.STANDARD_WIDGET;
      case 'world-clock':
        return GRID_SIZES.TIME_DISPLAY;
      case 'econ-map':
        return GRID_SIZES.ECON_MAP;
      case 'rate-monitor':
        return GRID_SIZES.ICON;
      default:
        return GRID_SIZES.STANDARD_WIDGET;
    }
  };

  /**
   * 根据 Widget 类型和鼠标位置找到最近的可用 grid 位置
   * 不会与现有组件重叠，不会挤压现有组件
   */
  const findNearestAvailableGridPositionForWidget = (
    widgetType: WidgetType,
    pixelX: number,
    pixelY: number
  ): GridPosition | null => {
    if (!containerRef) return null;

    const widgetSize = getWidgetSize(widgetType);
    const gridPos = pixelToGridPosition(pixelX, pixelY);
    const size = gridSystemSize();
    const currentElements = elementsWithAbsolutePositions();
    const maxRows = size.rows;

    // 检查当前位置是否可用
    if (isValidPosition(gridPos, widgetSize, size.columns, maxRows, currentElements)) {
      return gridPos;
    }

    // 如果当前位置不可用，在附近搜索可用位置（螺旋搜索）
    const searchRadius = Math.max(5, Math.max(widgetSize.width, widgetSize.height) * 2);
    for (let radius = 1; radius <= searchRadius; radius++) {
      // 螺旋搜索：从中心向外
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          // 跳过已经搜索过的内圈
          if (Math.abs(dx) < radius && Math.abs(dy) < radius) continue;

          const testPos: GridPosition = {
            x: gridPos.x + dx,
            y: gridPos.y + dy,
          };

          // 确保位置在边界内
          if (testPos.x < 0 || testPos.y < 0) continue;
          if (testPos.x + widgetSize.width > size.columns) continue;
          if (testPos.y + widgetSize.height > maxRows) continue;

          if (isValidPosition(testPos, widgetSize, size.columns, maxRows, currentElements)) {
            return testPos;
          }
        }
      }
    }

    // 如果附近没有可用位置，使用 findAvailablePosition
    const availablePos = findAvailablePosition(
      widgetSize,
      size.columns,
      Math.max(0, gridPos.y - searchRadius),
      currentElements
    );

    return availablePos;
  };

  /**
   * 处理添加组件确认
   */
  const handleAddWidgetConfirm = (widgetType: WidgetType) => {
    if (!rightClickPosition()) return;

    let position = findNearestAvailableGridPositionForWidget(
      widgetType,
      rightClickPosition()!.x,
      rightClickPosition()!.y
    );

    if (!position) {
      // 如果找不到可用位置，尝试在默认位置添加
      const widgetSize = getWidgetSize(widgetType);
      const defaultPos = findAvailablePosition(
        widgetSize,
        gridSystemSize().columns,
        0,
        elementsWithAbsolutePositions()
      );
      if (!defaultPos) {
        setIsAddWidgetDialogOpen(false);
        setRightClickPosition(null);
        return;
      }
      position = defaultPos;
    }

    const newWidget: GridElement = {
      id: `widget-${Date.now()}`,
      type: 'widget',
      component: widgetType,
      position: absoluteToAnchor(position, anchorColumn()),
      size: getWidgetSize(widgetType),
      state: createInitialWidgetState(widgetType),
    };

    addElement(newWidget);
    setIsAddWidgetDialogOpen(false);
    setRightClickPosition(null);
  };

  /**
   * 处理 mousedown 事件（由 Event Orchestrator 调用）
   */
  const handleMouseDown = (element: GridElement, elementRef: HTMLDivElement, e: MouseEvent) => {
    // 只响应左键
    if (e.button !== 0) return;

    // 固定元素不响应拖拽
    if (element.fixed === true) return;

    // 启动拖拽
    const started = dragSystem.startDrag(element, e, elementRef);
    if (!started) return;

    dragElementRef = elementRef;

    // 添加 document 级别的监听器
    document.addEventListener('mousemove', handleMouseMove, { passive: false });
    document.addEventListener('mouseup', handleMouseUp);
  };

  /**
   * 处理 mousemove 事件
   */
  const handleMouseMove = (e: MouseEvent) => {
    e.preventDefault();

    const result = dragSystem.handleMouseMove(e);
    if (result && result.shouldUpdate) {
      dragSystem.updateDragElementVisual(result.visualPosition);
    }
  };

  /**
   * 处理 mouseup 事件
   */
  const handleMouseUp = (e: MouseEvent) => {
    // 首先移除事件监听器，防止任何情况下监听器泄漏
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);

    if (!dragElementRef) return;

    // 在 endDrag 之前保存 element 引用，因为 endDrag 会重置状态
    const element = dragSystem.getState().draggedElement;
    const result = dragSystem.endDrag(e);
    if (!result) {
      dragElementRef = null;
      return;
    }

    const { wasDragging, clickDuration, newPosition, finalLayout } = result;

    // 如果是点击而不是拖拽，恢复样式即可
    // 实际的点击跳转由各组件自身的 onClick 处理（如 GridIcon）
    if (!wasDragging && clickDuration < 200 && element) {
      restoreElementStyle(dragElementRef, element);
      dragElementRef = null;
      return;
    }

    // 如果没有真正拖拽
    if (!wasDragging || !element) {
      restoreElementStyle(dragElementRef, element);
      dragElementRef = null;
      return;
    }

    // 拖拽结束，应用最终位置
    if (newPosition && finalLayout && containerRef) {
      applyFinalPosition(dragElementRef, element, newPosition, finalLayout, () => {
        // 动画完成后清理引用
        dragElementRef = null;
      });
    } else {
      // 无效位置（如拖到固定组件上方），恢复到原位
      restoreElementStyle(dragElementRef, element);
      dragElementRef = null;
    }
  };

  /**
   * 恢复元素样式
   * 注意：element.position 是锚点相对坐标，需要转换
   */
  const restoreElementStyle = (elementRef: HTMLDivElement, element: GridElement | null) => {
    if (!element) return;

    const absolutePos = anchorToAbsolute(element.position, anchorColumn());
    const elementPos = getElementPosition(absolutePos);
    elementRef.style.position = 'absolute';
    elementRef.style.left = `${elementPos.left}px`;
    elementRef.style.top = `${elementPos.top}px`;
    elementRef.style.transform = '';
    elementRef.style.transition = '';
    elementRef.style.zIndex = '';
  };

  /**
   * 应用最终位置
   * newPosition 和 finalLayout 中的位置是 DragSystem 返回的绝对坐标
   * 需要转换为锚点相对坐标保存到 store
   */
  const applyFinalPosition = (
    elementRef: HTMLDivElement,
    element: GridElement,
    newPosition: GridPosition,
    finalLayout: Map<string, GridPosition>,
    onComplete?: () => void
  ) => {
    // newPosition 是绝对坐标，直接用于渲染
    const finalPixelPos = getElementPosition(newPosition);

    elementRef.style.transition = 'none';
    elementRef.style.transform = '';
    elementRef.style.position = 'absolute';
    elementRef.style.left = `${finalPixelPos.left}px`;
    elementRef.style.top = `${finalPixelPos.top}px`;
    elementRef.style.zIndex = '';
    elementRef.classList.remove('grid-element--dragging');

    onComplete?.();

    // 更新 store - 将绝对坐标转换为锚点相对坐标保存
    const currentId = gridStore.currentLayoutId;
    const anchor = anchorColumn();
    finalLayout.forEach((absolutePos, elementId) => {
      const anchorRelativePos = absoluteToAnchor(absolutePos, anchor);
      setGridStore(
        'layouts',
        (layout: any) => layout.id === currentId,
        'elements',
        (el: any) => el.id === elementId,
        'position',
        anchorRelativePos
      );
    });
    
    saveLayouts();
  };

  // 生成所有 grid cell
  const gridCells = createMemo(() => {
    const size = gridSystemSize();
    const cells: Array<{ x: number; y: number }> = [];
    for (let x = 0; x < size.columns; x++) {
      for (let y = 0; y < size.rows; y++) {
        cells.push({ x, y });
      }
    }
    return cells;
  });

  return (
    <>
    <div 
      class="grid-area" 
      ref={containerRef!}
      onContextMenu={handleEmptyAreaContextMenu}
    >
      {/* 渲染所有 grid cell */}
      <For each={gridCells()}>
        {(cell) => {
          const pos = createMemo(() => getElementPosition(cell));
          return (
            <div
              class="grid-cell"
              style={{
                left: `${pos().left}px`,
                top: `${pos().top}px`,
              }}
            />
          );
        }}
      </For>

      {/* 渲染所有元素 */}
      <For each={elements()} fallback={null}>
        {(element) => {
          // 将元素转换为绝对坐标版本，供 DragSystem 使用
          const elementWithAbsPos = createMemo(() => ({
            ...element,
            position: anchorToAbsolute(element.position, anchorColumn()),
          }));
          // 获取拖拽系统的显示位置（绝对坐标）
          const displayPos = createMemo(() => dragSystem.getElementDisplayPosition(elementWithAbsPos()));
          const width = createMemo(() => getElementWidthPx(element.size));
          const height = createMemo(() => getElementHeightPx(element.size));
          // 直接使用绝对坐标转换为像素位置
          const position = createMemo(() => getElementPosition(displayPos()));
          const isFixed = createMemo(() => element.fixed === true);
          const isDragging = createMemo(() => dragSignals.isDragging()?.id === element.id);

          return (
            <div
              classList={{
                'grid-element': true,
                'grid-element--fixed': isFixed(),
                'grid-element--dragging': isDragging(),
              }}
              data-element-id={element.id}
              style={{
                width: `${width()}px`,
                height: `${height()}px`,
                left: `${position().left}px`,
                top: `${position().top}px`,
                transition: isDragging() ? 'none' : undefined,
                cursor: element.fixed ? 'default' : 'move',
              }}
              onMouseDown={(e) => {
                const elementRef = e.currentTarget as HTMLDivElement;
                handleMouseDown(element, elementRef, e);
              }}
              onContextMenu={(e) => handleContextMenu(element, e)}
            >
              {element.type === 'fixed' && (
                <div class="grid-fixed-content">
                  <FixedContentRenderer component={(element as any).component} />
                </div>
              )}

              {element.type === 'widget' && (
                <div class="grid-widget">
                  <div class="grid-widget__content">
                    <WidgetRenderer 
                      component={(element as any).component}
                      elementId={element.id}
                      state={element.state}
                      onStateChange={(newState) => updateElementState(element.id, newState)}
                    />
                  </div>
                </div>
              )}

              {element.type === 'icon' && (
                <GridIcon
                  url={(element as any).data.url}
                  name={(element as any).data.name}
                />
              )}
            </div>
          );
        }}
      </For>

      {/* 拖拽阴影预览 */}
      <ShadowPlaceholderRenderer
        dragSystem={dragSystem}
      />
    </div>
    <ContextMenuComponent />
    <AddIconDialog
      isOpen={isAddIconDialogOpen()}
      onClose={() => {
        setIsAddIconDialogOpen(false);
        setRightClickPosition(null);
      }}
      onConfirm={handleAddIconConfirm}
    />
    <AddWidgetDialog
      isOpen={isAddWidgetDialogOpen()}
      onClose={() => {
        setIsAddWidgetDialogOpen(false);
        setRightClickPosition(null);
      }}
      onConfirm={handleAddWidgetConfirm}
    />
    <AddIconDialog
      isOpen={isEditIconDialogOpen()}
      isEditMode={true}
      initialName={editingIconInitialName()}
      initialUrl={editingIconInitialUrl()}
      onClose={() => {
        setIsEditIconDialogOpen(false);
        setEditingIconId(null);
      }}
      onConfirm={handleEditIconConfirm}
    />
  </>
  );
};

// 阴影预览渲染器组件
function ShadowPlaceholderRenderer(props: {
  dragSystem: ReturnType<typeof createDragSystem>;
}) {
  const dragSignals = props.dragSystem.getSignals();

  return (
    <Show when={dragSignals.isDragging()}>
      {(draggedElement) => {
        if (!draggedElement?.size) return null;

        // DragSystem 使用绝对坐标
        const targetPos = createMemo(() => {
          const state = props.dragSystem.getState();
          const displaced = state.displacedElements;
          if (displaced.has(draggedElement.id)) {
            return displaced.get(draggedElement.id)!;
          }
          return draggedElement.position;
        });

        const width = createMemo(() => getElementWidthPx(draggedElement.size));
        const height = createMemo(() => getElementHeightPx(draggedElement.size));
        // 直接使用绝对坐标
        const pos = createMemo(() => getElementPosition(targetPos()));

        return (
          <div
            class="grid-placeholder"
            style={{
              width: `${width()}px`,
              height: `${height()}px`,
              left: `${pos().left}px`,
              top: `${pos().top}px`,
            }}
          />
        );
      }}
    </Show>
  );
}

// Widget 渲染器组件 - 使用 lazy 加载确保组件只创建一次
function WidgetRenderer(props: { 
  component: string;
  elementId: string;
  state: Record<string, unknown> | undefined;
  onStateChange: (newState: Record<string, unknown>) => void;
}) {
  const LazyComp = getLazyComponent(props.component);

  if (!LazyComp) return <></>;

  return (
    <Suspense fallback={<></>}>
      <LazyComp 
        elementId={props.elementId}
        state={props.state}
        onStateChange={props.onStateChange}
      />
    </Suspense>
  );
}

// 固定内容渲染器 (搜索框、时间) - 使用 lazy 加载确保组件只创建一次
function FixedContentRenderer(props: { component: string }) {
  const LazyComp = getLazyComponent(props.component);

  return (
    <Show when={LazyComp} fallback={<></>}>
      {(Comp) => <Comp />}
    </Show>
  );
}
