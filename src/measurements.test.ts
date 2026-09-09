import { describe, expect, it } from 'vitest';

import { distancesBetween, rulerMarkup } from './measurements';

describe('visible edge-to-edge measurements', () => {
  it('measures horizontal spacing instead of the overlapping vertical axis', () => {
    expect(
      distancesBetween(
        { x: 10, y: 20, width: 80, height: 30 },
        { x: 102, y: 20, width: 80, height: 30 },
      ),
    ).toEqual([{ x1: 90, y1: 35, x2: 102, y2: 35, value: 12 }]);
  });

  it('measures vertical spacing in either selection order', () => {
    const top = { x: 10, y: 20, width: 80, height: 30 };
    const bottom = { x: 10, y: 66, width: 80, height: 30 };
    expect(distancesBetween(bottom, top)).toEqual([
      { x1: 50, y1: 50, x2: 50, y2: 66, value: 16 },
    ]);
  });

  it('does not invent a gap for overlapping rectangles', () => {
    expect(
      distancesBetween(
        { x: 10, y: 10, width: 80, height: 80 },
        { x: 30, y: 30, width: 80, height: 80 },
      ),
    ).toEqual([]);
  });

  it('limits ruler ticks to the viewport', () => {
    const markup = rulerMarkup(120, 80);
    expect(markup).toContain('M100 20v-8');
    expect(markup).not.toContain('M150 20v-8');
    expect(markup).toContain('M20 50h-8');
  });
});
