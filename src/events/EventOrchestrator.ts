/**
 * Event Orchestrator - 事件编排中心
 *
 * 统一处理所有鼠标事件，按优先级分发到相应的处理器
 * 事件优先级：CONTEXT_MENU > INTERACTION > DRAG
 */

import { createSignal, onMount, onCleanup, JSX, ParentComponent } from 'solid-js';
import {
  EventPriority,
  type DragState,
  DRAG_THRESHOLD,
  CLICK_TIME_MAX,
  isInsideInteractiveElement,
  type GridElementData,
} from './types';

/**
 * 事件类型
 */
export type EventType = 'context-menu' | 'interaction' | 'drag' | 'none';

/**
 * 事件处理器回调
 */
export interface EventHandlers {
  /** 右键菜单处理器 */
  onContextMenu?: (e: MouseEvent, target: HTMLElement, elementData: GridElementData | null) => void;
  /** 拖拽开始处理器 */
  onDragStart?: (e: MouseEvent, elementId: string, element: HTMLElement) => void;
  /** 拖拽移动处理器 */
  onDragMove?: (e: MouseEvent) => void;
  /** 拖拽结束处理器 */
  onDragEnd?: (e: MouseEvent, wasDragging: boolean, clickDuration: number) => void;
}

/**
 * Event Orchestrator Props
 */
export interface EventOrchestratorProps {
  /** 子组件 */
  children: JSX.Element;
  /** 事件处理器 */
  handlers: EventHandlers;
  /** 获取元素的函数 */
  getElementById?: (id: string) => { fixed?: boolean; type?: string } | null;
}

/**
 * 默认的可交互元素选择器（可被外部配置覆盖）
 */
export const INTERACTIVE_SELECTORS_DEFAULT = [
  'button',
  'a',
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[role="button"]',
  '.calendar-day',
  '.context-menu',
  '.event-tooltip',
  '.search-input',
] as const;

/**
 * 判断事件目标是否在可交互元素内
 */
function isInInteractiveElement(target: HTMLElement): boolean {
  return INTERACTIVE_SELECTORS_DEFAULT.some(selector =>
    target.closest(selector)
  );
}

/**
 * 判断是否在 Sidebar 内
 */
function isInSidebar(target: HTMLElement): boolean {
  return !!target.closest('.sidebar');
}

/**
 * 从 DOM 元素获取网格元素数据
 */
function getElementDataFromDOM(target: HTMLElement): GridElementData | null {
  const gridElement = target.closest('.grid-element');
  if (!gridElement) return null;

  const elementId = gridElement.getAttribute('data-element-id');
  if (!elementId) return null;

  // 这里可以通过 elementId 查找实际的元素数据
  // 暂时返回基本信息，实际使用时需要配合 getElementById
  return {
    id: elementId,
    type: 'widget', // 默认类型
    component: '',
    fixed: false,
  };
}

/**
 * Event Orchestrator 组件
 *
 * 使用示例：
 * ```tsx
 * <EventOrchestrator
 *   handlers={{
 *     onContextMenu: handleContextMenu,
 *     onDragStart: handleDragStart,
 *     onDragMove: handleDragMove,
 *     onDragEnd: handleDragEnd,
 *   }}
 *   getElementById={(id) => gridStore.elements.find(e => e.id === id)}
 * >
 *   <GridContainer />
 * </EventOrchestrator>
 * ```
 */
export function EventOrchestrator(props: EventOrchestratorProps) {
  let containerRef: HTMLDivElement | undefined;
  let dragRef: HTMLDivElement | null = null;

  // 拖拽状态
  const dragState = createSignal<DragState>({
    isDragging: false,
    isPotentialDrag: false,
    startPosition: { x: 0, y: 0 },
    currentPosition: { x: 0, y: 0 },
    startTime: 0,
    element: null,
    elementId: null,
  });

  const getDragState = dragState[0];
  const setDragState = dragState[1];

  // 导出给外部查询的函数
  const isDragging = () => getDragState().isDragging;
  const isPotentialDrag = () => getDragState().isPotentialDrag;
  const getDraggedElementId = () => getDragState().elementId;

  // 暴露给外部访问
  (window as any).__eventOrchestrator = {
    isDragging,
    isPotentialDrag,
    getDraggedElementId,
  };

  /**
   * 判断事件类型
   * 按优先级返回：CONTEXT_MENU > INTERACTION > DRAG > NONE
   */
  const determineEventType = (e: MouseEvent): EventType => {
    const target = e.target as HTMLElement;

    // 优先级 1：检查是否在 sidebar 内
    if (isInSidebar(target)) {
      return 'interaction';
    }

    // 优先级 2：检查右键菜单
    if (e.button === 2) {
      return 'context-menu';
    }

    // 只处理左键的拖拽逻辑
    if (e.button !== 0) {
      return 'none';
    }

    // 优先级 3：检查是否在可交互元素内
    if (isInInteractiveElement(target)) {
      return 'interaction';
    }

    // 检查是否点击在固定元素上
    const elementData = getElementDataFromDOM(target);
    if (elementData && props.getElementById) {
      const element = props.getElementById(elementData.id);
      if (element?.fixed === true) {
        return 'interaction'; // 固定元素的交互由组件自己处理
      }
    }

    // 优先级 4：检查是否在可拖拽元素上
    if (elementData) {
      return 'drag';
    }

    return 'none';
  };

  /**
   * 处理 mousedown 事件
   */
  const handleMouseDown = (e: MouseEvent) => {
    const eventType = determineEventType(e);

    switch (eventType) {
      case 'context-menu': {
        const target = e.target as HTMLElement;
        const elementData = getElementDataFromDOM(target);
        props.handlers.onContextMenu?.(e, target, elementData);
        // 阻止默认右键菜单
        e.preventDefault();
        return;
      }

      case 'interaction':
        // 交互相件由自己处理，不阻止冒泡
        return;

      case 'drag': {
        const target = e.target as HTMLElement;
        const elementData = getElementDataFromDOM(target);
        if (!elementData) return;

        const gridElement = target.closest('.grid-element') as HTMLDivElement;
        if (!gridElement) return;

        // 记录拖拽初始状态
        setDragState({
          isDragging: false,
          isPotentialDrag: true,
          startPosition: { x: e.clientX, y: e.clientY },
          currentPosition: { x: e.clientX, y: e.clientY },
          startTime: Date.now(),
          element: gridElement,
          elementId: elementData.id,
        });

        dragRef = gridElement;
        dragRef.classList.add('grid-element--dragging');

        // 通知拖拽开始（潜在拖拽）
        props.handlers.onDragStart?.(e, elementData.id, gridElement);

        // 添加 document 级别的监听器来跟踪拖拽
        document.addEventListener('mousemove', handleMouseMove, { passive: false });
        document.addEventListener('mouseup', handleMouseUp);

        // 阻止事件冒泡和默认行为，但允许其他组件处理
        e.preventDefault();
        return;
      }

      default:
        return;
    }
  };

  /**
   * 处理 mousemove 事件
   */
  const handleMouseMove = (e: MouseEvent) => {
    const state = getDragState();
    if (!state.isPotentialDrag) return;

    const deltaX = e.clientX - state.startPosition.x;
    const deltaY = e.clientY - state.startPosition.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // 判断是否达到拖拽阈值
    if (distance > DRAG_THRESHOLD) {
      setDragState(prev => ({ ...prev, isDragging: true, isPotentialDrag: false }));
    }

    // 更新当前位置
    setDragState(prev => ({ ...prev, currentPosition: { x: e.clientX, y: e.clientY } }));

    // 通知拖拽移动
    if (getDragState().isDragging) {
      props.handlers.onDragMove?.(e);
    }
  };

  /**
   * 处理 mouseup 事件
   */
  const handleMouseUp = (e: MouseEvent) => {
    const state = getDragState();
    if (!state.isPotentialDrag && !state.isDragging) return;

    const wasDragging = state.isDragging;
    const clickDuration = Date.now() - state.startTime;

    // 清理 dragRef
    if (dragRef) {
      dragRef.classList.remove('grid-element--dragging');
    }

    // 重置拖拽状态
    setDragState({
      isDragging: false,
      isPotentialDrag: false,
      startPosition: { x: 0, y: 0 },
      currentPosition: { x: 0, y: 0 },
      startTime: 0,
      element: null,
      elementId: null,
    });

    const currentDragRef = dragRef;
    dragRef = null;

    // 移除 document 监听器
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);

    // 通知拖拽结束
    if (state.elementId) {
      props.handlers.onDragEnd?.(e, wasDragging, clickDuration);
    }
  };

  onCleanup(() => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  });

  return (
    <div
      ref={(el: HTMLDivElement) => (containerRef = el)}
      class="event-orchestrator"
      onMouseDown={handleMouseDown}
      style={{ 'width': '100%', 'height': '100%', 'position': 'relative' }}
    >
      {props.children}
    </div>
  );
}

/**
 * Hook：访问 Event Orchestrator 状态
 */
export function useEventOrchestrator() {
  return {
    isDragging: () => (window as any).__eventOrchestrator?.isDragging() ?? false,
    isPotentialDrag: () => (window as any).__eventOrchestrator?.isPotentialDrag() ?? false,
    getDraggedElementId: () => (window as any).__eventOrchestrator?.getDraggedElementId() ?? null,
  };
}
