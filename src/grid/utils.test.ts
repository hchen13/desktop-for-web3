import { describe, it, expect } from 'vitest';
import {
  calculateGridSystemSize,
  pixelToGridPosition,
  pixelToGridPositionCentered,
  gridToPixelPosition,
  clampGridPosition,
  isValidGridPosition,
  anchorToAbsolute,
  absoluteToAnchor,
  getAnchorColumn,
  isOverlapping,
  getCenteredPosition,
  findAvailablePosition,
} from './utils';
import { GRID_SIZES, GRID_UNIT, GRID_GAP, GRID_CONFIG } from './types';
import type { GridElement } from './types';

const CELL = GRID_UNIT + GRID_GAP; // 120

describe('calculateGridSystemSize', () => {
  it('returns minimum 6x6 for tiny viewport (375x600)', () => {
    const size = calculateGridSystemSize(375, 600);
    expect(size.columns).toBe(GRID_CONFIG.minWidth);
    expect(size.rows).toBe(GRID_CONFIG.minHeight);
  });

  it('returns expected size for 1200x800', () => {
    const size = calculateGridSystemSize(1200, 800);
    expect(size.columns).toBeGreaterThanOrEqual(6);
    expect(size.rows).toBeGreaterThanOrEqual(6);
    expect(size.columns).toBeLessThanOrEqual(10);
  });

  it('returns expected size for 1920x1080', () => {
    const size = calculateGridSystemSize(1920, 1080);
    expect(size.columns).toBeGreaterThan(8);
    expect(size.rows).toBeGreaterThan(6);
  });

  it('returns expected size for 2560x1440', () => {
    const size = calculateGridSystemSize(2560, 1440);
    expect(size.columns).toBeGreaterThan(12);
    expect(size.rows).toBeGreaterThan(8);
  });

  it('handles exactly-fitting viewport (cellSize multiples + padding)', () => {
    // Internal algorithm uses Math.floor(available / 120) where 120 = unit + gap
    // so an exact fit needs a viewport of cols*120 + padding (one trailing gap counted).
    const w = 8 * (GRID_UNIT + GRID_GAP) + GRID_CONFIG.paddingLeft + GRID_CONFIG.paddingRight;
    const h = 6 * (GRID_UNIT + GRID_GAP) + GRID_CONFIG.paddingTop + GRID_CONFIG.paddingBottom;
    const size = calculateGridSystemSize(w, h);
    expect(size.columns).toBe(8);
    expect(size.rows).toBe(6);
  });

  it('handles 0x0 with min fallback', () => {
    const size = calculateGridSystemSize(0, 0);
    expect(size.columns).toBe(GRID_CONFIG.minWidth);
    expect(size.rows).toBe(GRID_CONFIG.minHeight);
  });

  it('handles negative dimensions with min fallback', () => {
    const size = calculateGridSystemSize(-100, -100);
    expect(size.columns).toBe(GRID_CONFIG.minWidth);
    expect(size.rows).toBe(GRID_CONFIG.minHeight);
  });

  it('handles fractional viewport (1366.5x768)', () => {
    const size = calculateGridSystemSize(1366.5, 768);
    expect(size.columns).toBeGreaterThanOrEqual(6);
    expect(size.rows).toBeGreaterThanOrEqual(6);
  });
});

describe('pixelToGridPosition', () => {
  it('(0,0) -> (0,0)', () => {
    expect(pixelToGridPosition(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('(99,99) -> (0,0) (cell 0)', () => {
    expect(pixelToGridPosition(99, 99)).toEqual({ x: 0, y: 0 });
  });

  it('(100,100) -> (0,0) (gap region maps to previous cell via floor)', () => {
    // 100 / 120 = 0.833 -> floor 0
    expect(pixelToGridPosition(100, 100)).toEqual({ x: 0, y: 0 });
  });

  it('(120,120) -> (1,1)', () => {
    expect(pixelToGridPosition(120, 120)).toEqual({ x: 1, y: 1 });
  });

  it('negative input clamped to 0', () => {
    expect(pixelToGridPosition(-50, -50)).toEqual({ x: 0, y: 0 });
  });

  it('large positive values', () => {
    expect(pixelToGridPosition(1000, 600)).toEqual({
      x: Math.floor(1000 / CELL),
      y: Math.floor(600 / CELL),
    });
  });
});

describe('pixelToGridPositionCentered', () => {
  it('(59,59) -> (0,0) (closer to grid 0)', () => {
    expect(pixelToGridPositionCentered(59, 59, GRID_SIZES.ICON)).toEqual({ x: 0, y: 0 });
  });

  it('(60,60) -> (1,1) (crosses midline -> next grid)', () => {
    expect(pixelToGridPositionCentered(60, 60, GRID_SIZES.ICON)).toEqual({ x: 1, y: 1 });
  });

  it('differs from pixelToGridPosition near midline', () => {
    // Plain floor: 60/120 = 0
    expect(pixelToGridPosition(60, 60)).toEqual({ x: 0, y: 0 });
    // Centered: 60+60 = 120 / 120 = 1
    expect(pixelToGridPositionCentered(60, 60, GRID_SIZES.ICON)).toEqual({ x: 1, y: 1 });
  });
});

describe('gridToPixelPosition', () => {
  it('(0,0) -> (0,0)', () => {
    expect(gridToPixelPosition({ x: 0, y: 0 })).toEqual({ left: 0, top: 0 });
  });

  it('(2,3) -> formula', () => {
    expect(gridToPixelPosition({ x: 2, y: 3 })).toEqual({ left: 2 * CELL, top: 3 * CELL });
  });
});

describe('clampGridPosition', () => {
  const sys = { columns: 8, rows: 6 };

  it('returns null when element too large', () => {
    expect(clampGridPosition({ x: 0, y: 0 }, { width: 9, height: 6 }, sys)).toBeNull();
  });

  it('clamps right-down out-of-bounds', () => {
    const result = clampGridPosition({ x: 100, y: 100 }, { width: 2, height: 2 }, sys);
    expect(result).toEqual({ x: 6, y: 4 });
  });

  it('clamps top-left negative', () => {
    const result = clampGridPosition({ x: -5, y: -5 }, { width: 2, height: 2 }, sys);
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it('keeps valid position unchanged', () => {
    expect(clampGridPosition({ x: 3, y: 2 }, { width: 2, height: 2 }, sys)).toEqual({ x: 3, y: 2 });
  });

  it('clamps to flush right edge', () => {
    const result = clampGridPosition({ x: 7, y: 0 }, { width: 2, height: 1 }, sys);
    expect(result).toEqual({ x: 6, y: 0 });
  });
});

describe('isValidGridPosition', () => {
  const sys = { columns: 8, rows: 6 };
  it('valid mid-grid', () => {
    expect(isValidGridPosition({ x: 2, y: 2 }, { width: 2, height: 2 }, sys)).toBe(true);
  });
  it('rejects negative', () => {
    expect(isValidGridPosition({ x: -1, y: 0 }, { width: 1, height: 1 }, sys)).toBe(false);
  });
  it('rejects oversize', () => {
    expect(isValidGridPosition({ x: 7, y: 0 }, { width: 2, height: 1 }, sys)).toBe(false);
  });
});

describe('anchorToAbsolute / absoluteToAnchor', () => {
  it('round-trip preserves value (positive x)', () => {
    const anchor = 4;
    const orig = { x: 2, y: 3 };
    const abs = anchorToAbsolute(orig, anchor);
    const back = absoluteToAnchor(abs, anchor);
    expect(back).toEqual(orig);
  });

  it('round-trip preserves value (negative x)', () => {
    const anchor = 4;
    const orig = { x: -3, y: 0 };
    const abs = anchorToAbsolute(orig, anchor);
    expect(abs).toEqual({ x: 1, y: 0 });
    const back = absoluteToAnchor(abs, anchor);
    expect(back).toEqual(orig);
  });

  it('handles anchor column 0 edge', () => {
    expect(anchorToAbsolute({ x: 5, y: 1 }, 0)).toEqual({ x: 5, y: 1 });
    expect(absoluteToAnchor({ x: 5, y: 1 }, 0)).toEqual({ x: 5, y: 1 });
  });

  it('crosses x=0 boundary', () => {
    const anchor = 3;
    expect(anchorToAbsolute({ x: -3, y: 0 }, anchor)).toEqual({ x: 0, y: 0 });
    expect(anchorToAbsolute({ x: 0, y: 0 }, anchor)).toEqual({ x: 3, y: 0 });
  });
});

describe('getAnchorColumn', () => {
  it('even columns: 8 -> 4', () => {
    expect(getAnchorColumn(8)).toBe(4);
  });
  it('odd columns: 7 -> 3', () => {
    expect(getAnchorColumn(7)).toBe(3);
  });
  it('minWidth 6 -> 3', () => {
    expect(getAnchorColumn(6)).toBe(3);
  });
});

describe('isOverlapping', () => {
  const s = { width: 1, height: 1 };
  it('exact overlap', () => {
    expect(isOverlapping({ x: 0, y: 0 }, s, { x: 0, y: 0 }, s)).toBe(true);
  });

  it('adjacent (right) — not overlapping', () => {
    expect(isOverlapping({ x: 0, y: 0 }, s, { x: 1, y: 0 }, s)).toBe(false);
  });

  it('adjacent (down) — not overlapping', () => {
    expect(isOverlapping({ x: 0, y: 0 }, s, { x: 0, y: 1 }, s)).toBe(false);
  });

  it('contained (one inside other)', () => {
    expect(isOverlapping({ x: 0, y: 0 }, { width: 4, height: 4 }, { x: 1, y: 1 }, s)).toBe(true);
  });

  it('diagonal touching — not overlapping', () => {
    expect(isOverlapping({ x: 0, y: 0 }, s, { x: 1, y: 1 }, s)).toBe(false);
  });

  it('partial overlap', () => {
    expect(
      isOverlapping(
        { x: 0, y: 0 },
        { width: 2, height: 2 },
        { x: 1, y: 1 },
        { width: 2, height: 2 },
      ),
    ).toBe(true);
  });
});

describe('getCenteredPosition', () => {
  it('standard centering 8 cols, width 2', () => {
    expect(getCenteredPosition(8, 2)).toBe(3);
  });

  it('elementWidth > columns -> 0', () => {
    expect(getCenteredPosition(4, 6)).toBe(0);
  });

  it('single column', () => {
    expect(getCenteredPosition(1, 1)).toBe(0);
  });

  it('width equals columns -> 0', () => {
    expect(getCenteredPosition(8, 8)).toBe(0);
  });
});

describe('findAvailablePosition', () => {
  it('empty grid returns first slot', () => {
    const pos = findAvailablePosition({ width: 1, height: 1 }, 8, 0, []);
    expect(pos).toEqual({ x: 0, y: 0 });
  });

  it('jumps to next row when row full', () => {
    const elements: GridElement[] = [];
    for (let x = 0; x < 8; x++) {
      elements.push({
        id: `e-${x}`,
        type: 'icon',
        position: { x, y: 0 },
        size: { width: 1, height: 1 },
      });
    }
    const pos = findAvailablePosition({ width: 1, height: 1 }, 8, 0, elements);
    expect(pos?.y).toBeGreaterThanOrEqual(1);
  });

  it('returns null when no space within search range', () => {
    const elements: GridElement[] = [];
    // Fill everything within search range (20 rows) with 1×1 elements
    for (let y = 0; y < 21; y++) {
      for (let x = 0; x < 4; x++) {
        elements.push({
          id: `e-${x}-${y}`,
          type: 'icon',
          position: { x, y },
          size: { width: 1, height: 1 },
        });
      }
    }
    const pos = findAvailablePosition({ width: 4, height: 1 }, 4, 0, elements);
    expect(pos).toBeNull();
  });
});
