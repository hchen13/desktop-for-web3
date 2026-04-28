/**
 * Drag System - 拖拽系统
 *
 * 处理网格元素的拖拽逻辑，包括：
 * - BFS 推开算法
 * - 拖拽视觉反馈
 * - 位置更新
 */

import { createSignal, createMemo } from 'solid-js';
import type { GridElement, GridPosition, GridSize, GridSystemSize } from '../grid/types';
import {
  isOverlapping,
  pixelToGridPosition,
  pixelToGridPositionCentered,
  clampGridPosition,
  isValidGridPosition,
  gridToPixelPosition,
  getElementWidthPx,
  getElementHeightPx,
} from '../grid/utils';
import { GRID_UNIT, GRID_GAP } from '../grid/types';
import { DRAG_THRESHOLD } from './constants';

/**
 * 获取元素占用的所有格子位置
 */
export const getOccupiedCells = (pos: GridPosition, size: GridSize): string[] => {
  const cells: string[] = [];
  for (let x = pos.x; x < pos.x + size.width; x++) {
    for (let y = pos.y; y < pos.y + size.height; y++) {
      cells.push(`${x},${y}`);
    }
  }
  return cells;
};

/**
 * 检查位置是否与任何固定元素重叠
 * 注意：所有位置参数都应该是绝对坐标
 */
export const overlapsWithFixedElement = (
  pos: GridPosition,
  size: GridSize,
  elements: GridElement[],
  excludeId?: string,
): boolean => {
  for (const el of elements) {
    if (excludeId && el.id === excludeId) continue;
    if (el.fixed !== true) continue;

    if (isOverlapping(pos, size, el.position, el.size)) {
      return true;
    }
  }
  return false;
};

/**
 * 获取grid边界（动态计算）
 */
const getGridBoundaries = (
  gridSystemSize: GridSystemSize,
): { maxCols: number; maxRows: number } => {
  return {
    maxCols: gridSystemSize.columns,
    maxRows: gridSystemSize.rows,
  };
};

/**
 * 限制位置在grid边界内且不与固定元素重叠
 * 返回 null 表示位置无效
 */
export const clampPosition = (
  pos: GridPosition,
  size: GridSize,
  elements: GridElement[],
  gridSystemSize: GridSystemSize,
  elementId?: string,
): GridPosition | null => {
  const { maxCols, maxRows } = getGridBoundaries(gridSystemSize);

  // 首先限制在边界内
  let clamped = {
    x: Math.max(0, Math.min(pos.x, maxCols - size.width)),
    y: Math.max(0, Math.min(pos.y, maxRows - size.height)),
  };

  // 检查是否与固定元素重叠
  if (overlapsWithFixedElement(clamped, size, elements, elementId)) {
    return null;
  }

  return clamped;
};

/**
 * BFS 算法找到所有元素的最终位置
 * 确保没有任何两个元素重叠
 * 如果被拖拽元素的新位置与固定元素重叠，返回空map（表示无效位置）
 *
 * 优化策略：
 * 1. 换位检测：被拖元素原位置能容纳被推元素时直接换位
 * 2. 拖拽方向感知：优先向拖拽方向推开
 * 3. 最小位移：选择距离原位置最近的可用位置
 * 4. 图标垂直后备：图标优先水平移动，水平不可行时允许垂直
 *
 * 注意：所有位置都使用绝对坐标
 */
export const calculateNewLayout = (
  elements: GridElement[],
  draggedElementId: string,
  newDraggedPos: GridPosition,
  gridSystemSize: GridSystemSize,
  originalDraggedPos?: GridPosition, // 可选：被拖元素的原位置，用于换位检测和方向感知
): Map<string, GridPosition> => {
  const result = new Map<string, GridPosition>();

  // 找到被拖拽元素
  const draggedEl = elements.find((el) => el.id === draggedElementId);
  if (!draggedEl) return result;

  // 获取原位置（用于换位检测和方向感知）
  const dragOriginalPos = originalDraggedPos || draggedEl.position;

  // 检查被拖拽元素的新位置是否与固定元素重叠
  if (overlapsWithFixedElement(newDraggedPos, draggedEl.size, elements, draggedElementId)) {
    return result;
  }

  // 初始化所有元素的当前位置
  const currentPositions = new Map<string, GridPosition>();
  for (const el of elements) {
    if (el.id === draggedElementId) {
      currentPositions.set(el.id, newDraggedPos);
    } else {
      currentPositions.set(el.id, { ...el.position });
    }
  }

  // 被占用的格子集合
  const getOccupied = (excludeIds?: string[]): Set<string> => {
    const occupied = new Set<string>();
    for (const [id, pos] of currentPositions) {
      if (excludeIds && excludeIds.includes(id)) continue;
      const el = elements.find((e) => e.id === id);
      if (el) {
        for (const cell of getOccupiedCells(pos, el.size)) {
          occupied.add(cell);
        }
      }
    }
    return occupied;
  };

  // 检查某个位置是否可用（考虑元素尺寸）
  const isPositionAvailable = (
    pos: GridPosition,
    size: GridSize,
    excludeIds?: string[],
  ): boolean => {
    // 边界检查
    if (
      pos.x < 0 ||
      pos.y < 0 ||
      pos.x + size.width > gridSystemSize.columns ||
      pos.y + size.height > gridSystemSize.rows
    ) {
      return false;
    }
    const cells = getOccupiedCells(pos, size);
    const occupied = getOccupied(excludeIds);
    return !cells.some((cell) => occupied.has(cell));
  };

  /**
   * 在被拖拽元素**原 footprint 内**找一个能放下目标元素的位置
   *
   * 关键改进：原版只查 dragOriginalPos 左上角一格，导致 2×2 widget 拖走后多个被推开的
   * 小元素中只有第一个能换位、其余跑到 BFS 路径。改为遍历 dragged 原 footprint 内所有
   * 子位置，返回距离 target 当前位置最近的可用位置。
   *
   * 返回 null 表示原 footprint 内无任何位置能放下 target。
   */
  const findSwapPositionInFootprint = (targetElement: GridElement): GridPosition | null => {
    const dW = draggedEl.size.width;
    const dH = draggedEl.size.height;
    const tW = targetElement.size.width;
    const tH = targetElement.size.height;

    // 目标元素比 dragged 大，原 footprint 装不下
    if (tW > dW || tH > dH) return null;

    const candidates: { pos: GridPosition; distance: number }[] = [];
    const targetCurrentPos = currentPositions.get(targetElement.id) ?? targetElement.position;

    for (let dx = 0; dx <= dW - tW; dx++) {
      for (let dy = 0; dy <= dH - tH; dy++) {
        const pos = { x: dragOriginalPos.x + dx, y: dragOriginalPos.y + dy };

        // 边界检查
        if (
          pos.x < 0 ||
          pos.y < 0 ||
          pos.x + tW > gridSystemSize.columns ||
          pos.y + tH > gridSystemSize.rows
        ) {
          continue;
        }
        // 不能与 dragged 元素的新位置重叠（拖动距离 < 自身尺寸时新旧 footprint 会部分重叠，
        // 这些重叠格已被 dragged 占据，不能再分配给 displaced）
        if (isOverlapping(pos, targetElement.size, newDraggedPos, draggedEl.size)) {
          continue;
        }
        // 与固定元素重叠 → 跳过
        if (overlapsWithFixedElement(pos, targetElement.size, elements, targetElement.id)) {
          continue;
        }
        // 与其他元素（含已被处理过移到新位置的）冲突 → 跳过
        if (!isPositionAvailable(pos, targetElement.size, [draggedElementId, targetElement.id])) {
          continue;
        }

        // 曼哈顿距离 — 选离 target 当前位置最近的，降低视觉位移
        const distance =
          Math.abs(pos.x - targetCurrentPos.x) + Math.abs(pos.y - targetCurrentPos.y);
        candidates.push({ pos, distance });
      }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.distance - b.distance);
    return candidates[0].pos;
  };

  // BFS 队列：需要重新定位的元素
  const queue: GridElement[] = [];

  // 首先处理被拖拽元素
  const validatedPos = clampGridPosition(newDraggedPos, draggedEl.size, gridSystemSize);
  if (!validatedPos) {
    return result; // 返回空 map 表示位置无效
  }

  // 再次验证位置是否与固定元素重叠
  if (overlapsWithFixedElement(validatedPos, draggedEl.size, elements, draggedElementId)) {
    return result; // 返回空 map 表示位置无效
  }

  result.set(draggedElementId, validatedPos);

  // 检查哪些元素与被拖拽元素的新位置冲突
  for (const el of elements) {
    if (el.id === draggedElementId) continue;
    // 固定元素不会被推开（不能移动）
    if (el.fixed === true) continue;

    if (isOverlapping(newDraggedPos, draggedEl.size, el.position, el.size)) {
      queue.push(el);
    }
  }

  // BFS 处理所有冲突的元素
  const processed = new Set<string>([draggedElementId]);

  // 计算拖拽方向（用于优先向拖拽方向推开）
  const dragDirX = newDraggedPos.x - dragOriginalPos.x;
  const dragDirY = newDraggedPos.y - dragOriginalPos.y;

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (processed.has(current.id)) continue;

    const currentPos = currentPositions.get(current.id)!;
    let foundPosition: GridPosition | null = null;

    // 优先尝试换位：被推开的元素应优先回填到 dragged 元素的原 footprint 内任一空位
    const swapPos = findSwapPositionInFootprint(current);
    if (swapPos) {
      foundPosition = swapPos;
    }
    // 诊断（开关：window.__DRAG_DEBUG = true）
    if (
      typeof window !== 'undefined' &&
      (window as unknown as Record<string, unknown>).__DRAG_DEBUG
    ) {
      // eslint-disable-next-line no-console
      console.log('[DragSwap]', {
        dragged: draggedElementId,
        draggedSize: draggedEl.size,
        dragFrom: dragOriginalPos,
        dragTo: newDraggedPos,
        displaced: current.id,
        displacedSize: current.size,
        swapDest: swapPos,
        path: swapPos ? 'swap' : 'bfs',
      });
    }

    // 如果不能换位，使用 BFS 搜索最近的可用位置
    if (!foundPosition) {
      // 根据拖拽方向确定搜索方向优先级
      // 优先向拖拽方向推开，使体验更自然
      const baseDirections = [
        { dx: 1, dy: 0, name: 'right' },
        { dx: -1, dy: 0, name: 'left' },
        { dx: 0, dy: 1, name: 'down' },
        { dx: 0, dy: -1, name: 'up' },
      ];

      // 根据拖拽方向排序
      const sortedDirections = [...baseDirections].sort((a, b) => {
        // 计算每个方向与拖拽方向的一致性（点积）
        const dotA = a.dx * Math.sign(dragDirX) + a.dy * Math.sign(dragDirY);
        const dotB = b.dx * Math.sign(dragDirX) + b.dy * Math.sign(dragDirY);
        return dotB - dotA; // 点积越大越优先（与拖拽方向越一致）
      });

      // 对于图标，垂直方向作为后备（但仍允许）
      const isIcon =
        current.size.width === 1 && current.size.height === 1 && current.type === 'icon';
      const directions = isIcon
        ? sortedDirections // 图标现在也允许四个方向，但根据拖拽方向排序
        : sortedDirections;

      // BFS 搜索可用位置 - 优先找距离最近的
      const searchQueue: Array<{ pos: GridPosition; distance: number }> = [];
      const visited = new Set<string>();
      const candidates: Array<{ pos: GridPosition; distance: number }> = [];

      // 从当前位置开始搜索
      for (const dir of directions) {
        const newPos = { x: currentPos.x + dir.dx, y: currentPos.y + dir.dy };
        const key = `${newPos.x},${newPos.y}`;
        if (!visited.has(key)) {
          visited.add(key);
          searchQueue.push({ pos: newPos, distance: 1 });
        }
      }

      // BFS 搜索，收集所有距离最小的可用位置
      let minFoundDistance = Infinity;
      const maxSearchDistance = 10; // 限制搜索范围

      while (searchQueue.length > 0) {
        // 按距离排序
        searchQueue.sort((a, b) => a.distance - b.distance);
        const { pos, distance } = searchQueue.shift()!;

        // 如果已经找到了更近的位置，且当前距离更远，停止搜索
        if (distance > minFoundDistance) {
          break;
        }

        // 超出搜索范围
        if (distance > maxSearchDistance) {
          continue;
        }

        // 边界检查
        if (!isValidGridPosition(pos, current.size, gridSystemSize)) {
          continue;
        }

        // 检查是否与固定元素重叠
        if (overlapsWithFixedElement(pos, current.size, elements, current.id)) {
          // 继续搜索其他方向
          for (const dir of directions) {
            const newPos = { x: pos.x + dir.dx, y: pos.y + dir.dy };
            const key = `${newPos.x},${newPos.y}`;
            if (!visited.has(key)) {
              visited.add(key);
              searchQueue.push({ pos: newPos, distance: distance + 1 });
            }
          }
          continue;
        }

        // 检查这个位置是否可用
        if (isPositionAvailable(pos, current.size, [current.id])) {
          candidates.push({ pos, distance });
          minFoundDistance = distance;
        } else {
          // 位置被占用，继续搜索
          for (const dir of directions) {
            const newPos = { x: pos.x + dir.dx, y: pos.y + dir.dy };
            const key = `${newPos.x},${newPos.y}`;
            if (!visited.has(key)) {
              visited.add(key);
              searchQueue.push({ pos: newPos, distance: distance + 1 });
            }
          }
        }
      }

      // 从候选位置中选择最优的（距离相同时选择与拖拽方向更一致的）
      if (candidates.length > 0) {
        candidates.sort((a, b) => {
          if (a.distance !== b.distance) {
            return a.distance - b.distance;
          }
          // 距离相同时，选择与拖拽方向更一致的
          const deltaA = { x: a.pos.x - currentPos.x, y: a.pos.y - currentPos.y };
          const deltaB = { x: b.pos.x - currentPos.x, y: b.pos.y - currentPos.y };
          const dotA = deltaA.x * Math.sign(dragDirX) + deltaA.y * Math.sign(dragDirY);
          const dotB = deltaB.x * Math.sign(dragDirX) + deltaB.y * Math.sign(dragDirY);
          return dotB - dotA;
        });
        foundPosition = candidates[0].pos;
      }
    }

    if (foundPosition) {
      result.set(current.id, foundPosition);
      currentPositions.set(current.id, foundPosition);
      processed.add(current.id);

      // 检查这个新移动是否导致其他元素冲突
      for (const el of elements) {
        if (el.id === current.id || el.fixed === true || processed.has(el.id)) continue;
        const elPos = currentPositions.get(el.id)!;
        if (isOverlapping(foundPosition, current.size, elPos, el.size)) {
          queue.push(el);
        }
      }
    } else {
      // 没找到位置，保持原样
      result.set(current.id, currentPos);
      processed.add(current.id);
    }
  }

  // 其他未移动的元素保持原位置
  for (const el of elements) {
    if (!result.has(el.id)) {
      result.set(el.id, el.position);
    }
  }

  // ===== 终局验证 =====
  // 规则：
  // 1) displaced 落在 dragged **原 footprint 内** → 总是允许（这是合理 swap）
  // 2) displaced 跑出原 footprint → 距离不能超过 dragged 尺寸 + 1
  //    超过则视为 BFS 远跑（被推元素比 dragged 大装不下 / 级联失控），整个 drop 拒绝
  // 3) dragged 不能与任何最终位置重叠（兜底）
  const maxDisplacement = Math.max(draggedEl.size.width, draggedEl.size.height) + 1;
  const footprintMaxX = dragOriginalPos.x + draggedEl.size.width;
  const footprintMaxY = dragOriginalPos.y + draggedEl.size.height;
  const finalDraggedPos = result.get(draggedElementId);

  for (const [id, finalPos] of result) {
    if (id === draggedElementId) continue;
    const original = elements.find((e) => e.id === id);
    if (!original) continue;

    // 没动 → 跳过
    const moved = finalPos.x !== original.position.x || finalPos.y !== original.position.y;
    if (moved) {
      // 是否落在 dragged 原 footprint 内
      const inFootprint =
        finalPos.x >= dragOriginalPos.x &&
        finalPos.x + original.size.width <= footprintMaxX &&
        finalPos.y >= dragOriginalPos.y &&
        finalPos.y + original.size.height <= footprintMaxY;

      if (!inFootprint) {
        const distance =
          Math.abs(finalPos.x - original.position.x) + Math.abs(finalPos.y - original.position.y);
        if (distance > maxDisplacement) {
          return new Map(); // 拒绝 — 推到 footprint 外且距离过远
        }
      }
    }

    // 重叠兜底
    if (
      finalDraggedPos &&
      isOverlapping(finalDraggedPos, draggedEl.size, finalPos, original.size)
    ) {
      return new Map();
    }
  }

  return result;
};

/**
 * 拖拽状态接口
 */
export interface DragSystemState {
  isDragging: boolean;
  draggedElement: GridElement | null;
  displacedElements: Map<string, GridPosition>;
  dragStartMouse: { x: number; y: number };
  mouseOffset: { x: number; y: number };
  elementStartPos: GridPosition;
}

/**
 * 拖拽系统类
 * 提供完整的拖拽功能
 */
export class DragSystem {
  private containerRef: HTMLDivElement | null = null;

  // 拖拽状态
  private isDraggingSignal = createSignal(false);
  private draggedElementSignal = createSignal<GridElement | null>(null);
  private displacedElementsSignal = createSignal<Map<string, GridPosition>>(new Map());
  private dragStartMouseSignal = createSignal({ x: 0, y: 0 });
  private mouseOffsetSignal = createSignal({ x: 0, y: 0 });
  private elementStartPosSignal = createSignal<GridPosition>({ x: 0, y: 0 });
  private clickStartTimeSignal = createSignal(0);

  // Grid System 尺寸
  private gridSystemSizeSignal = createSignal<GridSystemSize>({ columns: 8, rows: 6 });

  // 当前元素列表
  private elementsSignal = createSignal<GridElement[]>([]);

  // 当前拖拽的元素引用
  private dragRef: HTMLDivElement | null = null;

  // 静态标记：追踪刚刚完成的拖拽（用于阻止点击事件）
  private static justFinishedDragging = false;
  private static justFinishedDraggingTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 检查是否刚刚完成了拖拽
   */
  static justFinishedDrag(): boolean {
    return DragSystem.justFinishedDragging;
  }

  constructor() {}

  /**
   * 设置容器引用
   */
  setContainer(ref: HTMLDivElement | null) {
    this.containerRef = ref;
  }

  /**
   * 设置 Grid System 尺寸
   */
  setGridSystemSize(size: GridSystemSize) {
    this.gridSystemSizeSignal[1](size);
  }

  /**
   * 设置当前元素列表
   */
  setElements(elements: GridElement[]) {
    this.elementsSignal[1](elements);
  }

  /**
   * 获取当前状态
   */
  getState(): DragSystemState {
    return {
      isDragging: this.isDraggingSignal[0](),
      draggedElement: this.draggedElementSignal[0](),
      displacedElements: this.displacedElementsSignal[0](),
      dragStartMouse: this.dragStartMouseSignal[0](),
      mouseOffset: this.mouseOffsetSignal[0](),
      elementStartPos: this.elementStartPosSignal[0](),
    };
  }

  /**
   * 获取响应式状态
   * - isDragging: 真正进入拖拽态的布尔（mousedown 后超过 DRAG_THRESHOLD 才为 true）
   * - draggedElement: 当前被拖拽的元素对象（mousedown 即可设置，但仅在 isDragging=true 时有视觉效果）
   * - displacedElements: BFS 推开后的新位置 map
   */
  getSignals() {
    return {
      isDragging: this.isDraggingSignal[0],
      draggedElement: this.draggedElementSignal[0],
      displacedElements: this.displacedElementsSignal[0],
    };
  }

  /**
   * 开始拖拽
   */
  startDrag(element: GridElement, event: MouseEvent, elementRef: HTMLDivElement): boolean {
    if (element.fixed === true) return false;

    this.clickStartTimeSignal[1](Date.now());

    // 获取元素的当前位置
    const elementRect = elementRef.getBoundingClientRect();

    // 记录鼠标相对于元素的偏移量
    const offset = {
      x: event.clientX - elementRect.left,
      y: event.clientY - elementRect.top,
    };
    this.mouseOffsetSignal[1](offset);

    // 记录初始状态
    this.dragStartMouseSignal[1]({ x: event.clientX, y: event.clientY });
    this.elementStartPosSignal[1](element.position);
    this.draggedElementSignal[1](element);

    this.dragRef = elementRef;
    this.dragRef.classList.add('grid-element--dragging');

    // 禁用文本选择
    document.body.classList.add('is-dragging');

    return true;
  }

  /**
   * 处理拖拽移动
   */
  handleMouseMove(
    event: MouseEvent,
  ): {
    shouldUpdate: boolean;
    visualPosition: { left: number; top: number; scale: string };
  } | null {
    if (!this.dragRef || !this.containerRef) {
      return null;
    }

    const startPos = this.dragStartMouseSignal[0]();
    const deltaX = event.clientX - startPos.x;
    const deltaY = event.clientY - startPos.y;
    const distance = Math.hypot(deltaX, deltaY);

    // 严格大于 DRAG_THRESHOLD 才开始拖拽，与 EventOrchestrator 保持一致
    if (!this.isDraggingSignal[0]() && distance <= DRAG_THRESHOLD) {
      return null;
    }

    if (!this.isDraggingSignal[0]()) {
      this.isDraggingSignal[1](true);
    }

    const element = this.draggedElementSignal[0]();
    if (!element) return null;

    const containerRect = this.containerRef.getBoundingClientRect();
    const gridSize = GRID_UNIT + GRID_GAP;
    const offset = this.mouseOffsetSignal[0]();

    // 获取元素尺寸
    const elementWidth = getElementWidthPx(element.size);
    const elementHeight = getElementHeightPx(element.size);
    const size = this.gridSystemSizeSignal[0]();

    // 计算元素左上角在容器内的位置（像素）
    const pixelX = event.clientX - containerRect.left - offset.x;
    const pixelY = event.clientY - containerRect.top - offset.y;

    // 转换为 Grid 坐标（使用基于中心点的对称判定）
    const gridPos = pixelToGridPositionCentered(pixelX, pixelY, element.size);
    const clampedGridPos = clampGridPosition(gridPos, element.size, size);

    if (!clampedGridPos) {
      this.displacedElementsSignal[1](new Map());
      return {
        shouldUpdate: true,
        visualPosition: this.calculateFreePixelVisualPosition(
          pixelX,
          pixelY,
          containerRect,
          element,
          size,
          elementWidth,
          elementHeight,
        ),
      };
    }

    // 检查是否与固定元素重叠
    const finalPos = clampPosition(
      clampedGridPos,
      element.size,
      this.elementsSignal[0](),
      this.gridSystemSizeSignal[0](),
      element.id,
    );

    if (!finalPos) {
      // 与固定元素重叠，不更新视觉位置（保持元素在原位）
      this.displacedElementsSignal[1](new Map());
      return null;
    }

    // 计算 BFS 推开布局（传入原位置用于换位检测和方向感知）
    const originalPos = this.elementStartPosSignal[0]();
    const newLayout = calculateNewLayout(
      this.elementsSignal[0](),
      element.id,
      finalPos,
      this.gridSystemSizeSignal[0](),
      originalPos,
    );
    this.displacedElementsSignal[1](newLayout);

    // 使用自由像素位置（跟随鼠标），而非网格吸附位置
    const visualPosition = this.calculateFreePixelVisualPosition(
      pixelX,
      pixelY,
      containerRect,
      element,
      size,
      elementWidth,
      elementHeight,
    );

    return {
      shouldUpdate: true,
      visualPosition,
    };
  }

  /**
   * 计算自由像素视觉位置（跟随鼠标，不吸附网格）
   */
  private calculateFreePixelVisualPosition(
    pixelX: number,
    pixelY: number,
    containerRect: DOMRect,
    element: GridElement,
    size: GridSystemSize,
    elementWidth: number,
    elementHeight: number,
  ): { left: number; top: number; scale: string } {
    const scale = 1.05;
    const scaleOffsetX = (elementWidth * (scale - 1)) / 2;
    const scaleOffsetY = (elementHeight * (scale - 1)) / 2;

    const gridSize = GRID_UNIT + GRID_GAP;
    const gridAreaWidth = size.columns * gridSize - GRID_GAP;
    const gridAreaHeight = size.rows * gridSize - GRID_GAP;
    const canScaleWidth = elementWidth * scale <= gridAreaWidth;
    const canScaleHeight = elementHeight * scale <= gridAreaHeight;
    const willScale = canScaleWidth && canScaleHeight;

    const actualScaleOffsetX = willScale ? scaleOffsetX : 0;
    const actualScaleOffsetY = willScale ? scaleOffsetY : 0;

    // 限制在容器边界内
    const clampedPixelX = Math.max(0, Math.min(pixelX, gridAreaWidth - elementWidth));
    const clampedPixelY = Math.max(0, Math.min(pixelY, gridAreaHeight - elementHeight));

    return {
      left: containerRect.left + clampedPixelX + actualScaleOffsetX,
      top: containerRect.top + clampedPixelY + actualScaleOffsetY,
      scale: willScale ? 'scale(1.05)' : 'scale(1)',
    };
  }

  /**
   * 根据位置计算视觉位置
   */
  private calculateVisualPositionForPosition(
    pixelPos: { left: number; top: number },
    containerRect: DOMRect,
    element: GridElement,
    size: GridSystemSize,
    elementWidth: number,
    elementHeight: number,
  ): { left: number; top: number; scale: string } {
    const scale = 1.05;
    const scaleOffsetX = (elementWidth * (scale - 1)) / 2;
    const scaleOffsetY = (elementHeight * (scale - 1)) / 2;

    const gridSize = GRID_UNIT + GRID_GAP;
    const gridAreaWidth = size.columns * gridSize - GRID_GAP;
    const gridAreaHeight = size.rows * gridSize - GRID_GAP;
    const canScaleWidth = elementWidth * scale <= gridAreaWidth;
    const canScaleHeight = elementHeight * scale <= gridAreaHeight;
    const willScale = canScaleWidth && canScaleHeight;

    const actualScale = willScale ? scale : 1;
    const actualScaleOffsetX = willScale ? scaleOffsetX : 0;
    const actualScaleOffsetY = willScale ? scaleOffsetY : 0;

    return {
      left: Math.ceil(containerRect.left + pixelPos.left + actualScaleOffsetX),
      top: Math.ceil(containerRect.top + pixelPos.top + actualScaleOffsetY),
      scale: willScale ? 'scale(1.05)' : 'scale(1)',
    };
  }

  /**
   * 更新拖拽元素的视觉位置
   */
  updateDragElementVisual(visualPosition: { left: number; top: number; scale: string }) {
    if (!this.dragRef) {
      return;
    }

    this.dragRef.style.position = 'fixed';
    this.dragRef.style.left = `${visualPosition.left}px`;
    this.dragRef.style.top = `${visualPosition.top}px`;
    this.dragRef.style.transform = visualPosition.scale;
    this.dragRef.style.zIndex = '1000';
  }

  /**
   * 结束拖拽
   */
  endDrag(event: MouseEvent): {
    wasDragging: boolean;
    clickDuration: number;
    newPosition?: GridPosition;
    finalLayout?: Map<string, GridPosition>;
  } | null {
    if (!this.dragRef) return null;

    const element = this.draggedElementSignal[0]();
    const wasDragging = this.isDraggingSignal[0]();
    const clickDuration = Date.now() - this.clickStartTimeSignal[0]();

    // 如果刚刚完成了拖拽，设置标记以阻止点击事件
    if (wasDragging) {
      DragSystem.justFinishedDragging = true;
      if (DragSystem.justFinishedDraggingTimer) {
        clearTimeout(DragSystem.justFinishedDraggingTimer);
      }
      DragSystem.justFinishedDraggingTimer = setTimeout(() => {
        DragSystem.justFinishedDragging = false;
      }, 300);
    }

    const currentDragRef = this.dragRef;
    currentDragRef.classList.remove('grid-element--dragging');
    this.dragRef = null;

    // 恢复文本选择
    document.body.classList.remove('is-dragging');

    // 重置状态
    this.isDraggingSignal[1](false);

    let result: {
      wasDragging: boolean;
      clickDuration: number;
      newPosition?: GridPosition;
      finalLayout?: Map<string, GridPosition>;
    } | null = {
      wasDragging,
      clickDuration,
    };

    // 如果是真正拖拽
    if (wasDragging && element) {
      const offset = this.mouseOffsetSignal[0]();
      const containerRect = this.containerRef?.getBoundingClientRect();
      if (!containerRect) {
        this.resetState();
        return result;
      }

      const size = this.gridSystemSizeSignal[0]();
      let pixelX = event.clientX - containerRect.left - offset.x;
      let pixelY = event.clientY - containerRect.top - offset.y;

      // 检查鼠标是否在容器外
      const isMouseOutsideContainer =
        event.clientX < containerRect.left ||
        event.clientX > containerRect.right ||
        event.clientY < containerRect.top ||
        event.clientY > containerRect.bottom;

      if (isMouseOutsideContainer) {
        const displacedPos = this.displacedElementsSignal[0]().get(element.id);
        if (displacedPos) {
          const pixelPos = gridToPixelPosition(displacedPos);
          pixelX = pixelPos.left;
          pixelY = pixelPos.top;
        } else {
          const currentPixelPos = gridToPixelPosition(element.position);
          pixelX = currentPixelPos.left;
          pixelY = currentPixelPos.top;
        }
      }

      // 使用基于中心点的对称判定计算落点
      const gridPos = pixelToGridPositionCentered(pixelX, pixelY, element.size);
      const clampedGridPos = clampGridPosition(gridPos, element.size, size);

      if (!clampedGridPos) {
        this.resetState();
        return result;
      }

      const clampedPos = clampPosition(
        clampedGridPos,
        element.size,
        this.elementsSignal[0](),
        this.gridSystemSizeSignal[0](),
        element.id,
      );

      if (!clampedPos) {
        this.resetState();
        return result;
      }

      // 计算最终布局（传入原位置用于换位检测和方向感知）
      const originalPos = this.elementStartPosSignal[0]();
      const finalLayout = calculateNewLayout(
        this.elementsSignal[0](),
        element.id,
        clampedPos,
        this.gridSystemSizeSignal[0](),
        originalPos,
      );

      result = {
        wasDragging,
        clickDuration,
        newPosition: clampedPos,
        finalLayout,
      };
    }

    this.resetState();
    return result;
  }

  /**
   * 重置拖拽状态
   */
  private resetState() {
    this.draggedElementSignal[1](null);
    this.displacedElementsSignal[1](new Map());
  }

  /**
   * 取消拖拽
   */
  cancelDrag() {
    if (this.dragRef) {
      this.dragRef.classList.remove('grid-element--dragging');
      this.dragRef.style.position = 'absolute';
      this.dragRef.style.transform = '';
      this.dragRef.style.zIndex = '';
      this.dragRef = null;
    }

    // 恢复文本选择
    document.body.classList.remove('is-dragging');

    this.isDraggingSignal[1](false);
    this.resetState();
  }

  /**
   * 获取元素的显示位置（考虑被推开的状态）
   */
  getElementDisplayPosition(element: GridElement): GridPosition {
    const displaced = this.displacedElementsSignal[0]();
    if (displaced.has(element.id)) {
      return displaced.get(element.id)!;
    }
    return element.position;
  }
}

/**
 * 创建拖拽系统实例
 */
export function createDragSystem(): DragSystem {
  return new DragSystem();
}
