import { describe, expect, it } from 'vitest';
import {
  estimateStrokeWidth,
  extractCenterlines,
  zhangSuenThinning,
} from './thinning';
import type { BinaryImage } from './tracedDrawing';

function image(rows: readonly (readonly number[])[]): BinaryImage {
  return {
    width: rows[0].length,
    height: rows.length,
    data: Uint8Array.from(rows.flat()),
  };
}

describe('Zhang-Suen thinning and centerlines', () => {
  it('reduces a thick stroke to a connected one-pixel skeleton', () => {
    const source = image([
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 1, 1, 0, 0],
      [0, 0, 1, 1, 1, 0, 0],
      [0, 0, 1, 1, 1, 0, 0],
      [0, 0, 1, 1, 1, 0, 0],
      [0, 0, 1, 1, 1, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
    ]);
    const skeleton = zhangSuenThinning(source);
    const foreground = [...skeleton.data].filter(Boolean).length;
    expect(foreground).toBeGreaterThan(1);
    expect(foreground).toBeLessThan(15);
    for (let y = 0; y < skeleton.height; y += 1) {
      const row = skeleton.data.slice(y * skeleton.width, (y + 1) * skeleton.width);
      expect([...row].filter(Boolean).length).toBeLessThanOrEqual(1);
    }
  });

  it('turns a straight skeleton into one maximal polyline', () => {
    const skeleton = image([
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 1, 1, 1, 1, 1, 0],
      [0, 0, 0, 0, 0, 0, 0],
    ]);
    const lines = extractCenterlines(skeleton);
    expect(lines).toHaveLength(1);
    expect(lines[0].closed).toBe(false);
    expect(lines[0].points).toHaveLength(5);
    expect(lines[0].points[0]).toEqual({ x: 1.5, y: 2.5 });
    expect(lines[0].points.at(-1)).toEqual({ x: 5.5, y: 2.5 });
  });

  it('splits branch arms into separately editable paths', () => {
    const skeleton = image([
      [0, 0, 1, 0, 0],
      [0, 0, 1, 0, 0],
      [1, 1, 1, 1, 1],
      [0, 0, 1, 0, 0],
      [0, 0, 1, 0, 0],
    ]);
    const lines = extractCenterlines(skeleton);
    expect(lines).toHaveLength(4);
    expect(lines.every((line) => line.points.length === 3)).toBe(true);
  });

  it('preserves a pure skeleton loop as a closed centerline', () => {
    const skeleton = image([
      [0, 0, 0, 0, 0],
      [0, 1, 1, 1, 0],
      [0, 1, 0, 1, 0],
      [0, 1, 1, 1, 0],
      [0, 0, 0, 0, 0],
    ]);
    const lines = extractCenterlines(skeleton);
    expect(lines).toHaveLength(1);
    expect(lines[0].closed).toBe(true);
    expect(lines[0].points).toHaveLength(8);
  });

  it('estimates the original width from foreground distance', () => {
    const source = image([
      [0, 0, 0, 0, 0, 0, 0],
      [0, 1, 1, 1, 1, 1, 0],
      [0, 1, 1, 1, 1, 1, 0],
      [0, 1, 1, 1, 1, 1, 0],
      [0, 0, 0, 0, 0, 0, 0],
    ]);
    const skeleton = image([
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 1, 1, 1, 1, 1, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
    ]);
    const line = extractCenterlines(skeleton, source)[0];
    expect(line.strokeWidth).toBeCloseTo(3, 5);
    expect(estimateStrokeWidth(source, line.points)).toBeCloseTo(3, 5);
  });
});
