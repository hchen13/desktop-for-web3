/**
 * Grid System 工具函数
 * 基于 design/layout/grid-system-design.md 规范
 */

import type { GridPosition, GridSize, GridElement, GridSystemSize, AnchorRelativePosition } from './types';
import { GRID_UNIT, GRID_GAP, GRID_CONFIG } from './types';

/**
 * 根据 viewport 尺寸计算 Grid System 的列数和行数
 *
 * @param viewportWidth - 视口宽度
 * @param viewportHeight - 视口高度
 * @returns Grid System 尺寸（动态列数和行数）
 */
export const calculateGridSystemSize = (viewportWidth: number, viewportHeight: number): GridSystemSize => {
  // 计算可用宽度（减去左右 padding）
  const availableWidth = viewportWidth - GRID_CONFIG.paddingLeft - GRID_CONFIG.paddingRight;

  // 计算可用高度（减去顶部和底部 padding）
  const availableHeight = viewportHeight - GRID_CONFIG.paddingTop - GRID_CONFIG.paddingBottom;

  // 单个 Grid Cell 占用的空间（unit + gap）
  const cellSize = GRID_UNIT + GRID_GAP;

  // 计算列数和行数
  // 使用 Math.floor 确保不会超出可用空间
  let columns = Math.max(GRID_CONFIG.minWidth, Math.floor(availableWidth / cellSize));
  let rows = Math.max(GRID_CONFIG.minHeight, Math.floor(availableHeight / cellSize));

  // 验证计算出的列数对应的实际宽度不超过可用宽度
  // 实际宽度 = columns * GRID_UNIT + (columns - 1) * GRID_GAP
  const actualWidth = columns * GRID_UNIT + (columns - 1) * GRID_GAP;
  if (actualWidth > availableWidth && columns > GRID_CONFIG.minWidth) {
    columns = columns - 1;
  }

  // 验证计算出的行数对应的实际高度不超过可用高度
  // 实际高度 = rows * GRID_UNIT + (rows - 1) * GRID_GAP
  const actualHeight = rows * GRID_UNIT + (rows - 1) * GRID_GAP;
  if (actualHeight > availableHeight && rows > GRID_CONFIG.minHeight) {
    rows = rows - 1;
  }

  return { columns, rows };
};

/**
 * 计算锚点列索引
 * 锚点位于 Grid Area 第一行的中心列
 * 偶数列时取中间偏左的列
 *
 * @param columns - Grid System 总列数
 * @returns 锚点列索引
 */
export const getAnchorColumn = (columns: number): number => {
  return Math.floor(columns / 2);
};

/**
 * @deprecated 使用 getAnchorColumn 代替
 */
export const getCenterColumn = (columns: number): number => {
  return getAnchorColumn(columns);
};

/**
 * 锚点相对坐标 → 绝对坐标
 * 将相对于锚点的位置转换为 Grid System 中的实际位置
 *
 * @param relativePos - 相对于锚点的位置
 * @param anchorColumn - 锚点列索引
 * @returns 绝对位置
 */
export const anchorToAbsolute = (
  relativePos: AnchorRelativePosition,
  anchorColumn: number
): GridPosition => {
  return {
    x: anchorColumn + relativePos.x,
    y: relativePos.y,
  };
};

/**
 * 绝对坐标 → 锚点相对坐标
 * 将 Grid System 中的实际位置转换为相对于锚点的位置
 *
 * @param absolutePos - 绝对位置
 * @param anchorColumn - 锚点列索引
 * @returns 相对于锚点的位置
 */
export const absoluteToAnchor = (
  absolutePos: GridPosition,
  anchorColumn: number
): AnchorRelativePosition => {
  return {
    x: absolutePos.x - anchorColumn,
    y: absolutePos.y,
  };
};

/**
 * 根据中心列和元素尺寸计算元素位置（居中布局）
 * 确保位置不超出边界（x >= 0 且 x + elementWidth <= columns）
 *
 * @param columns - Grid System 总列数
 * @param elementWidth - 元素占用的列数
 * @returns 元素的左边界列索引
 */
export const getCenteredPosition = (columns: number, elementWidth: number): number => {
  // 计算居中位置：让元素两侧的列数尽可能相等
  const centered = Math.round((columns - elementWidth) / 2);

  // 确保位置不超出边界：
  // - 最左边不能小于 0
  // - 最右边不能超出 columns（x + elementWidth <= columns，即 x <= columns - elementWidth）
  const maxValidX = Math.max(0, columns - elementWidth);

  return Math.max(0, Math.min(centered, maxValidX));
};

/**
 * 计算元素的像素宽度（使用动态 grid unit）
 */
export const getElementWidth = (size: GridSize, gridUnit: number = GRID_UNIT): number => {
  return size.width * gridUnit + (size.width - 1) * GRID_GAP;
};

/**
 * 计算元素的像素高度（使用动态 grid unit）
 */
export const getElementHeight = (size: GridSize, gridUnit: number = GRID_UNIT): number => {
  return size.height * gridUnit + (size.height - 1) * GRID_GAP;
};

/**
 * 计算元素在Grid中的像素位置（使用动态 grid unit）
 * 水平和垂直都使用像素
 * 精确对齐：像素位置 = grid 坐标 × (GRID_UNIT + GRID_GAP)
 * 由于 gridSize 是整数，position 是整数，结果必然是整数，不需要舍入
 */
export const getElementPosition = (
  position: GridPosition,
  gridUnit: number = GRID_UNIT
): { left: number; top: number } => {
  const gridSize = gridUnit + GRID_GAP;

  // 精确计算，不使用舍入（因为 gridSize 和 position 都是整数）
  return {
    left: position.x * gridSize,
    top: position.y * gridSize,
  };
};

/**
 * 计算元素宽度像素（使用动态 grid unit）
 * 确保返回整数像素值
 */
export const getElementWidthPx = (size: GridSize, gridUnit: number = GRID_UNIT): number => {
  return Math.round(size.width * gridUnit + (size.width - 1) * GRID_GAP);
};

/**
 * 计算元素高度像素（使用动态 grid unit）
 * 确保返回整数像素值
 */
export const getElementHeightPx = (size: GridSize, gridUnit: number = GRID_UNIT): number => {
  return Math.round(size.height * gridUnit + (size.height - 1) * GRID_GAP);
};

/**
 * 检查两个位置是否相同
 */
export const isSamePosition = (pos1: GridPosition, pos2: GridPosition): boolean => {
  return pos1.x === pos2.x && pos1.y === pos2.y;
};

/**
 * 检查两个Grid区域是否重叠
 */
export const isOverlapping = (
  pos1: GridPosition,
  size1: GridSize,
  pos2: GridPosition,
  size2: GridSize
): boolean => {
  const pos1Right = pos1.x + size1.width;
  const pos1Bottom = pos1.y + size1.height;
  const pos2Right = pos2.x + size2.width;
  const pos2Bottom = pos2.y + size2.height;

  return !(
    pos1Right <= pos2.x ||
    pos2Right <= pos1.x ||
    pos1Bottom <= pos2.y ||
    pos2Bottom <= pos1.y
  );
};

/**
 * 检查元素是否与任何其他元素冲突
 */
export const hasConflict = (
  element: GridElement,
  otherElements: GridElement[]
): boolean => {
  for (const other of otherElements) {
    if (other.id === element.id) continue;
    if (
      isOverlapping(
        element.position,
        element.size,
        other.position,
        other.size
      )
    ) {
      return true;
    }
  }
  return false;
};

/**
 * 检查位置是否有效（不超出边界且不冲突）
 */
export const isValidPosition = (
  position: GridPosition,
  size: GridSize,
  columns: number,
  maxRows: number,
  otherElements: GridElement[]
): boolean => {
  // 检查是否超出边界
  if (position.x < 0 || position.y < 0) return false;
  if (position.x + size.width > columns) return false;
  if (position.y + size.height > maxRows) return false;

  // 检查是否与其他元素冲突
  const tempElement: GridElement = {
    ...otherElements[0],
    id: 'temp',
    type: 'widget',
    position,
    size,
  };

  return !hasConflict(tempElement, otherElements);
};

/**
 * 寻找第一个可用的空闲位置
 */
export const findAvailablePosition = (
  size: GridSize,
  columns: number,
  startRow: number,
  otherElements: GridElement[]
): GridPosition | null => {
  let row = startRow;
  let col = 0;

  // 最多搜索20行
  const maxRows = startRow + 20;

  while (row < maxRows) {
    const position = { x: col, y: row };

    if (
      isValidPosition(position, size, columns, maxRows, otherElements)
    ) {
      return position;
    }

    col += size.width;
    if (col + size.width > columns) {
      col = 0;
      row++;
    }
  }

  return null;
};

/**
 * 将像素坐标转换为Grid位置
 * @deprecated 使用 pixelToGridPosition 代替
 */
export const pixelToGrid = (pixelX: number, pixelY: number): GridPosition => {
  return pixelToGridPosition(pixelX, pixelY);
};

/**
 * 像素位置 → Grid 坐标（吸附到最近的 grid）
 * 这是统一的位置转换函数，确保所有像素到 grid 的转换都使用相同的逻辑
 * 如果像素位置为负数，会被限制为 0
 *
 * Grid 布局: [100px cell][20px gap][100px cell][20px gap]...
 * 0-99px → grid 0, 100-119px → gap, 120-219px → grid 1, ...
 */
export const pixelToGridPosition = (pixelX: number, pixelY: number): GridPosition => {
  const gridSize = GRID_UNIT + GRID_GAP;

  // 确保像素位置不为负数（如果为负数，限制为 0）
  const clampedPixelX = Math.max(0, pixelX);
  const clampedPixelY = Math.max(0, pixelY);

  // 使用 Math.floor 而不是 Math.round，因为 gap 区域应该算作下一个 grid
  // 例如：0-119px 应该映射到 grid 0，120-239px 应该映射到 grid 1
  return {
    x: Math.max(0, Math.floor(clampedPixelX / gridSize)),
    y: Math.max(0, Math.floor(clampedPixelY / gridSize)),
  };
};

/**
 * 对称的像素到网格位置转换（用于拖拽落点判定）
 * 使用半格偏移实现对称判定：元素越过格子中线才切换到下一格
 * 
 * 原理：加上半格偏移后用 floor，等效于四舍五入
 * - 0-59px → grid 0（距离 grid 0 更近）
 * - 60-119px → grid 1（距离 grid 1 更近）
 * 
 * @param pixelX - 元素左上角像素 X 坐标
 * @param pixelY - 元素左上角像素 Y 坐标
 * @param _elementSize - 元素尺寸（保留参数以兼容调用）
 */
export const pixelToGridPositionCentered = (
  pixelX: number,
  pixelY: number,
  _elementSize: GridSize
): GridPosition => {
  const gridSize = GRID_UNIT + GRID_GAP;
  const halfGrid = gridSize / 2;
  
  // 确保像素位置不为负数
  const clampedPixelX = Math.max(0, pixelX);
  const clampedPixelY = Math.max(0, pixelY);
  
  // 加上半格偏移后用 floor，实现对称的四舍五入效果
  return {
    x: Math.max(0, Math.floor((clampedPixelX + halfGrid) / gridSize)),
    y: Math.max(0, Math.floor((clampedPixelY + halfGrid) / gridSize)),
  };
};

/**
 * Grid 坐标 → 像素位置（精确对齐）
 * 这是 getElementPosition 的别名，提供统一的命名
 */
export const gridToPixelPosition = (
  gridPos: GridPosition,
  gridUnit: number = GRID_UNIT
): { left: number; top: number } => {
  return getElementPosition(gridPos, gridUnit);
};

/**
 * 验证 Grid 位置是否在边界内
 * 检查位置和尺寸是否完全在 Grid System 边界内
 */
export const isValidGridPosition = (
  pos: GridPosition,
  size: GridSize,
  gridSystemSize: GridSystemSize
): boolean => {
  const { columns, rows } = gridSystemSize;
  
  // 检查左上角是否在边界内
  if (pos.x < 0 || pos.y < 0) {
    return false;
  }
  
  // 检查右下角是否在边界内
  if (pos.x + size.width > columns) {
    return false;
  }
  if (pos.y + size.height > rows) {
    return false;
  }
  
  return true;
};

/**
 * 限制 Grid 位置到边界内
 * 如果位置超出边界，将其限制到有效范围内
 * 如果无法限制（元素太大），返回 null
 */
export const clampGridPosition = (
  pos: GridPosition,
  size: GridSize,
  gridSystemSize: GridSystemSize
): GridPosition | null => {
  const { columns, rows } = gridSystemSize;
  
  // 如果元素太大，无法放入 grid system
  if (size.width > columns || size.height > rows) {
    return null;
  }
  
  // 限制 x 坐标：确保 x + width <= columns，即 x <= columns - width
  const clampedX = Math.max(0, Math.min(pos.x, columns - size.width));
  
  // 限制 y 坐标：确保 y + height <= rows，即 y <= rows - height
  const clampedY = Math.max(0, Math.min(pos.y, rows - size.height));
  
  const clamped = {
    x: clampedX,
    y: clampedY,
  };
  
  if (clampedX !== pos.x || clampedY !== pos.y) {
  }
  
  return clamped;
};

/**
 * 验证并限制 Grid 位置
 * 结合验证和限制功能，如果位置无效则返回 null
 */
export const validateAndClampPosition = (
  pos: GridPosition,
  size: GridSize,
  gridSystemSize: GridSystemSize
): GridPosition | null => {
  // 先尝试限制位置
  const clamped = clampGridPosition(pos, size, gridSystemSize);
  
  // 如果限制失败，返回 null
  if (!clamped) return null;
  
  // 再次验证限制后的位置（双重保险）
  if (!isValidGridPosition(clamped, size, gridSystemSize)) {
    return null;
  }
  
  return clamped;
};

/**
 * 计算Grid所需的总行数
 */
export const calculateRequiredRows = (elements: GridElement[]): number => {
  let maxRow = 0;
  for (const element of elements) {
    const elementBottom = element.position.y + element.size.height;
    if (elementBottom > maxRow) {
      maxRow = elementBottom;
    }
  }
  return Math.max(maxRow, 6); // 至少6行
};

/**
 * 计算Grid所需的总列数
 */
export const calculateRequiredColumns = (elements: GridElement[]): number => {
  let maxCol = 0;
  for (const element of elements) {
    const elementRight = element.position.x + element.size.width;
    if (elementRight > maxCol) {
      maxCol = elementRight;
    }
  }
  return Math.max(maxCol, 8); // 至少8列
};

/**
 * 计算grid容器的总像素宽度
 */
export const getGridContainerWidth = (columns: number): number => {
  return columns * GRID_UNIT + (columns - 1) * GRID_GAP;
};

/**
 * 计算grid容器的总像素高度
 */
export const getGridContainerHeight = (rows: number): number => {
  return rows * GRID_UNIT + (rows - 1) * GRID_GAP;
};
