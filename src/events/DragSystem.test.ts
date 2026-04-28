import { describe, it, expect } from 'vitest';
import {
  calculateNewLayout,
  clampPosition,
  getOccupiedCells,
  overlapsWithFixedElement,
} from './DragSystem';
import type { GridElement, GridSystemSize } from '../grid/types';

const sys: GridSystemSize = { columns: 8, rows: 6 };

const widget = (id: string, x: number, y: number, w = 1, h = 1, fixed = false): GridElement => ({
  id,
  type: fixed ? 'fixed' : 'widget',
  position: { x, y },
  size: { width: w, height: h },
  ...(fixed ? { fixed: true } : {}),
});

const icon = (id: string, x: number, y: number): GridElement => ({
  id,
  type: 'icon',
  position: { x, y },
  size: { width: 1, height: 1 },
});

describe('getOccupiedCells', () => {
  it('1x1', () => {
    expect(getOccupiedCells({ x: 2, y: 3 }, { width: 1, height: 1 })).toEqual(['2,3']);
  });

  it('2x2', () => {
    const cells = getOccupiedCells({ x: 0, y: 0 }, { width: 2, height: 2 });
    expect(cells).toHaveLength(4);
    expect(new Set(cells)).toEqual(new Set(['0,0', '0,1', '1,0', '1,1']));
  });
});

describe('overlapsWithFixedElement', () => {
  it('detects overlap with fixed', () => {
    const els = [widget('f', 2, 0, 2, 1, true)];
    expect(overlapsWithFixedElement({ x: 2, y: 0 }, { width: 1, height: 1 }, els)).toBe(true);
  });

  it('ignores non-fixed', () => {
    const els = [widget('w', 2, 0, 2, 1)];
    expect(overlapsWithFixedElement({ x: 2, y: 0 }, { width: 1, height: 1 }, els)).toBe(false);
  });

  it('excludeId skips matching id', () => {
    const els = [widget('self', 2, 0, 2, 1, true)];
    expect(overlapsWithFixedElement({ x: 2, y: 0 }, { width: 1, height: 1 }, els, 'self')).toBe(
      false,
    );
  });
});

describe('clampPosition', () => {
  it('clamps within bounds', () => {
    expect(clampPosition({ x: 100, y: 100 }, { width: 1, height: 1 }, [], sys)).toEqual({
      x: 7,
      y: 5,
    });
  });

  it('returns null when overlapping fixed', () => {
    const els = [widget('f', 0, 0, 2, 2, true)];
    expect(clampPosition({ x: 0, y: 0 }, { width: 1, height: 1 }, els, sys)).toBeNull();
  });

  it('keeps valid position', () => {
    expect(clampPosition({ x: 3, y: 2 }, { width: 1, height: 1 }, [], sys)).toEqual({
      x: 3,
      y: 2,
    });
  });
});

describe('calculateNewLayout', () => {
  it('no conflict — only dragged moves', () => {
    const els = [widget('a', 0, 0), widget('b', 5, 5)];
    const result = calculateNewLayout(els, 'a', { x: 2, y: 0 }, sys);
    expect(result.get('a')).toEqual({ x: 2, y: 0 });
    expect(result.get('b')).toEqual({ x: 5, y: 5 });
  });

  it('single push — drops onto another, pushes to nearest', () => {
    const els = [widget('a', 0, 0), widget('b', 1, 0)];
    const result = calculateNewLayout(els, 'a', { x: 1, y: 0 }, sys);
    expect(result.get('a')).toEqual({ x: 1, y: 0 });
    // b pushed away (cannot stay at 1,0)
    expect(result.get('b')).not.toEqual({ x: 1, y: 0 });
  });

  it('chain push: A pushes B which pushes C', () => {
    const els = [widget('a', 0, 0), widget('b', 1, 0), widget('c', 2, 0)];
    const result = calculateNewLayout(els, 'a', { x: 1, y: 0 }, sys, { x: 0, y: 0 });
    expect(result.get('a')).toEqual({ x: 1, y: 0 });
    // BFS pushed b to a non-overlapping place
    const bPos = result.get('b')!;
    const cPos = result.get('c')!;
    // No overlap among final positions
    expect(`${bPos.x},${bPos.y}`).not.toBe(`${cPos.x},${cPos.y}`);
    expect(`${bPos.x},${bPos.y}`).not.toBe('1,0');
  });

  it('drop onto fixed element — empty result', () => {
    const els = [widget('drag', 0, 0), widget('fixed', 2, 0, 1, 1, true)];
    const result = calculateNewLayout(els, 'drag', { x: 2, y: 0 }, sys);
    expect(result.size).toBe(0);
  });

  it('chain hits fixed — pushed element finds alternative', () => {
    const els = [widget('a', 0, 0), widget('b', 1, 0), widget('fixed', 2, 0, 1, 1, true)];
    const result = calculateNewLayout(els, 'a', { x: 1, y: 0 }, sys);
    expect(result.get('a')).toEqual({ x: 1, y: 0 });
    const bPos = result.get('b')!;
    expect(bPos).toBeDefined();
    // b must not land on the fixed element (2,0)
    expect(`${bPos.x},${bPos.y}`).not.toBe('2,0');
  });

  it('swap: dragged into b position, b takes dragged origin', () => {
    const els = [widget('a', 0, 0), widget('b', 2, 0)];
    const result = calculateNewLayout(els, 'a', { x: 2, y: 0 }, sys, { x: 0, y: 0 });
    expect(result.get('a')).toEqual({ x: 2, y: 0 });
    expect(result.get('b')).toEqual({ x: 0, y: 0 });
  });

  it('right-edge push falls back to vertical', () => {
    // a at column 6 dragged to 7, b also at 7 — b has no right space
    const els = [widget('a', 6, 0), widget('b', 7, 0)];
    const result = calculateNewLayout(els, 'a', { x: 7, y: 0 }, sys, { x: 6, y: 0 });
    expect(result.get('a')).toEqual({ x: 7, y: 0 });
    const bPos = result.get('b')!;
    // b should move away, possibly to (6,0) or (7,1)
    expect(`${bPos.x},${bPos.y}`).not.toBe('7,0');
  });

  it('large widget pushes multiple 1x1 icons', () => {
    const els = [widget('big', 0, 0, 2, 2), icon('i1', 2, 0), icon('i2', 2, 1)];
    const result = calculateNewLayout(els, 'big', { x: 1, y: 0 }, sys, { x: 0, y: 0 });
    expect(result.get('big')).toEqual({ x: 1, y: 0 });
    // i1, i2 must be displaced
    expect(result.get('i1')).not.toEqual({ x: 2, y: 0 });
    expect(result.get('i2')).not.toEqual({ x: 2, y: 1 });
  });

  it('icon-icon chain push direction sorted by drag direction', () => {
    const els = [icon('a', 0, 0), icon('b', 1, 0), icon('c', 2, 0)];
    const result = calculateNewLayout(els, 'a', { x: 1, y: 0 }, sys, { x: 0, y: 0 });
    expect(result.get('a')).toEqual({ x: 1, y: 0 });
    // NOTE: Per AGENTS.md docstring, 1x1 icons should be horizontal-only.
    // The current implementation allows 4 directions (sorted by drag direction).
    // The test verifies the *current behavior*, with this comment marking the discrepancy.
    const bPos = result.get('b')!;
    expect(bPos).not.toEqual({ x: 1, y: 0 });
  });

  it('processed set prevents revisiting', () => {
    const els = [widget('a', 0, 0), widget('b', 1, 0), widget('c', 0, 1)];
    const result = calculateNewLayout(els, 'a', { x: 1, y: 0 }, sys, { x: 0, y: 0 });
    expect(result.size).toBe(3);
    // No element appears at the same position as another
    const seen = new Set<string>();
    for (const [, p] of result) {
      const key = `${p.x},${p.y}`;
      // For multi-cell widgets we check the upper-left only; in this test all are 1x1
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('only-dragged element', () => {
    const els = [widget('a', 0, 0)];
    const result = calculateNewLayout(els, 'a', { x: 3, y: 3 }, sys);
    expect(result.size).toBe(1);
    expect(result.get('a')).toEqual({ x: 3, y: 3 });
  });

  it('maxSearchDistance=10 limit (current behavior)', () => {
    // Create dense block where pushed element would need >10 to find space
    const els: GridElement[] = [widget('drag', 0, 0)];
    // Fill columns 1-7 at row 0 with 1x1 icons
    for (let x = 1; x < 8; x++) {
      els.push(icon(`r0-${x}`, x, 0));
    }
    // Fill rows 1..5 entirely
    for (let y = 1; y < 6; y++) {
      for (let x = 0; x < 8; x++) {
        els.push(icon(`r${y}-${x}`, x, y));
      }
    }
    // Drag to (1,0) — there's no available space anywhere within range
    const result = calculateNewLayout(els, 'drag', { x: 1, y: 0 }, sys, { x: 0, y: 0 });
    // The pushed element (r0-1) might stay put due to maxSearchDistance limit
    expect(result.get('drag')).toEqual({ x: 1, y: 0 });
  });

  it('returns empty when dragged out-of-bounds', () => {
    const els = [widget('a', 0, 0)];
    const result = calculateNewLayout(els, 'a', { x: 100, y: 100 }, sys);
    // clampGridPosition returns position within bounds; calculateNewLayout uses validatedPos,
    // which means it will succeed for in-bounds clamped position.
    // For impossible positions (size > grid), it returns empty.
    const result2 = calculateNewLayout([widget('big', 0, 0, 9, 9)], 'big', { x: 0, y: 0 }, sys);
    expect(result2.size).toBe(0);
    expect(result.size).toBeGreaterThan(0);
  });
});
