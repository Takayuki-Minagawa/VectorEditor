import { describe, expect, it } from 'vitest';
import { alignShapes, snapAngle } from './align';
import type { TracedShape } from './tracedDrawing';

function rectCenter(
  shape: Extract<TracedShape, { kind: 'rect' }>,
): { x: number; y: number } {
  const radians = shape.angle * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: shape.x + cos * shape.width / 2 - sin * shape.height / 2,
    y: shape.y + sin * shape.width / 2 + cos * shape.height / 2,
  };
}

describe('cleanup alignment', () => {
  it('snaps only angles inside the requested tolerance', () => {
    expect(snapAngle(43, 3)).toBe(45);
    expect(snapAngle(39, 3)).toBe(39);
    expect(snapAngle(-88, 3)).toBe(-90);
  });

  it('makes a nearly horizontal line exact while preserving center and length', () => {
    const radians = 3 * Math.PI / 180;
    const input: TracedShape[] = [{
      kind: 'line',
      x1: 0,
      y1: 0,
      x2: Math.cos(radians) * 10,
      y2: Math.sin(radians) * 10,
      strokeWidth: 1,
    }];
    const result = alignShapes(input, {
      angleToleranceDeg: 5,
      coordinateTolerance: 0,
    });
    expect(result[0].kind).toBe('line');
    if (result[0].kind === 'line') {
      expect(result[0].y1).toBeCloseTo(result[0].y2, 10);
      expect(Math.hypot(
        result[0].x2 - result[0].x1,
        result[0].y2 - result[0].y1,
      )).toBeCloseTo(10);
    }
    expect(input[0]).not.toBe(result[0]);
  });

  it('snaps primitive angles and clusters nearby peer coordinates', () => {
    const input: TracedShape[] = [
      { kind: 'line', x1: 10, y1: 0, x2: 10, y2: 20, strokeWidth: 1 },
      { kind: 'line', x1: 12, y1: 30, x2: 12, y2: 50, strokeWidth: 1 },
      { kind: 'rect', x: 40, y: 10, width: 10, height: 5, angle: 43 },
    ];
    const result = alignShapes(input, {
      angleSnapDeg: 4,
      coordinateSnap: 3,
    });
    expect(result[0].kind).toBe('line');
    expect(result[1].kind).toBe('line');
    if (result[0].kind === 'line' && result[1].kind === 'line') {
      expect(result[0].x1).toBe(11);
      expect(result[0].x2).toBe(11);
      expect(result[1].x1).toBe(11);
      expect(result[1].x2).toBe(11);
    }
    expect(result[2]).toEqual(expect.objectContaining({ kind: 'rect', angle: 45 }));
    expect(input[0]).toEqual({
      kind: 'line',
      x1: 10,
      y1: 0,
      x2: 10,
      y2: 20,
      strokeWidth: 1,
    });
  });

  it('preserves the geometric center of a large rotated rectangle when snapping', () => {
    const rectangle: Extract<TracedShape, { kind: 'rect' }> = {
      kind: 'rect',
      x: 125_000,
      y: 300_000,
      width: 250_000,
      height: 125_000,
      angle: 43,
      strokeWidth: 7.5,
    };
    const before = rectCenter(rectangle);
    const [result] = alignShapes([rectangle], {
      angleSnapDeg: 3,
      coordinateSnap: 0,
    });

    expect(result.kind).toBe('rect');
    if (result.kind === 'rect') {
      const after = rectCenter(result);
      expect(result.angle).toBe(45);
      expect(result.x).not.toBe(rectangle.x);
      expect(result.y).not.toBe(rectangle.y);
      expect(after.x).toBeCloseTo(before.x, 8);
      expect(after.y).toBeCloseTo(before.y, 8);
      expect(result.width).toBe(rectangle.width);
      expect(result.height).toBe(rectangle.height);
      expect(result.strokeWidth).toBe(7.5);
    }
  });

  it('keeps an ellipse center fixed while snapping only its angle', () => {
    const ellipse: Extract<TracedShape, { kind: 'ellipse' }> = {
      kind: 'ellipse',
      cx: 123_456,
      cy: 654_321,
      rx: 20_000,
      ry: 5_000,
      angle: 43,
    };
    const [result] = alignShapes([ellipse], {
      angleSnapDeg: 3,
      coordinateSnap: 0,
    });
    expect(result).toEqual({ ...ellipse, angle: 45 });
  });

  it('writes clustered coordinates back to explicit slices for mixed rectangles', () => {
    const input: TracedShape[] = [
      {
        kind: 'rect',
        x: 10,
        y: 10,
        width: 20,
        height: 20,
        angle: 0,
      },
      {
        kind: 'rect',
        x: 12,
        y: 50,
        width: 15,
        height: 8,
        angle: 45,
      },
      {
        kind: 'line',
        x1: 14,
        y1: 70,
        x2: 14,
        y2: 90,
        strokeWidth: 2,
      },
    ];

    const result = alignShapes(input, {
      angleSnapDeg: 0,
      coordinateSnap: 3,
    });
    expect(result[0]).toEqual({
      kind: 'rect',
      x: 11,
      y: 10,
      width: 19,
      height: 20,
      angle: 0,
    });
    expect(result[1]).toEqual({
      kind: 'rect',
      x: 11,
      y: 50,
      width: 15,
      height: 8,
      angle: 45,
    });
    expect(result[2]).toEqual({
      kind: 'line',
      x1: 14,
      y1: 70,
      x2: 14,
      y2: 90,
      strokeWidth: 2,
    });
    expect(input[0]).toEqual({
      kind: 'rect',
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      angle: 0,
    });
  });

  it('keeps free-form polygon and polyline vertices out of peer snapping', () => {
    const input: TracedShape[] = [{
      kind: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 9, y: 1 },
        { x: 5, y: 9 },
      ],
      holes: [[
        { x: 3, y: 3 },
        { x: 5, y: 3 },
        { x: 4, y: 5 },
      ]],
      closed: true,
    }, {
      kind: 'polyline',
      points: [
        { x: 1, y: 1 },
        { x: 4, y: 8 },
        { x: 8, y: 2 },
      ],
      strokeWidth: 1,
    }];

    const result = alignShapes(input, { coordinateSnap: 10 });

    expect(result).toEqual(input);
    expect(result[0]).not.toBe(input[0]);
    expect(result[1]).not.toBe(input[1]);
    if (result[0].kind === 'polygon' && input[0].kind === 'polygon') {
      expect(result[0].points).not.toBe(input[0].points);
      expect(result[0].holes).not.toBe(input[0].holes);
      expect(result[0].holes?.[0]).not.toBe(input[0].holes?.[0]);
    }
    if (result[1].kind === 'polyline' && input[1].kind === 'polyline') {
      expect(result[1].points).not.toBe(input[1].points);
    }
  });

  it('limits every coordinate cluster to the requested full span', () => {
    const input: TracedShape[] = Array.from({ length: 6 }, (_, index) => ({
      kind: 'circle',
      cx: index,
      cy: index * 100,
      r: 1,
    }));

    const result = alignShapes(input, { coordinateSnap: 3 });

    expect(result.map((shape) => (
      shape.kind === 'circle' ? shape.cx : Number.NaN
    ))).toEqual([1.5, 1.5, 1.5, 1.5, 4.5, 4.5]);
  });

  it('does not collapse short lines or two-point polylines into a point', () => {
    const input: TracedShape[] = [{
      kind: 'line',
      x1: 0,
      y1: 0,
      x2: 2,
      y2: 2,
      strokeWidth: 1,
    }, {
      kind: 'polyline',
      points: [
        { x: 20, y: 20 },
        { x: 22, y: 22 },
      ],
      strokeWidth: 1,
    }];

    const result = alignShapes(input, {
      angleSnapDeg: 0,
      coordinateSnap: 3,
    });

    expect(result).toEqual(input);
    expect(result[0]).not.toBe(input[0]);
    expect(result[1]).not.toBe(input[1]);
    if (result[1].kind === 'polyline' && input[1].kind === 'polyline') {
      expect(result[1].points).not.toBe(input[1].points);
    }
  });

  it('preserves compound polygon holes without clustering them into the outer ring', () => {
    const input: TracedShape[] = [{
      kind: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ],
      holes: [[
        { x: 1, y: 1 },
        { x: 19, y: 1 },
        { x: 19, y: 19 },
        { x: 1, y: 19 },
      ]],
      closed: true,
    }, {
      kind: 'line',
      x1: 1,
      y1: 30,
      x2: 1,
      y2: 40,
      strokeWidth: 1,
    }];

    const result = alignShapes(input, { coordinateSnap: 2 });
    const polygon = result[0];
    expect(polygon.kind).toBe('polygon');
    if (polygon.kind === 'polygon') {
      expect(polygon.holes).toEqual(input[0].kind === 'polygon'
        ? input[0].holes
        : undefined);
      expect(polygon.holes).not.toBe(
        input[0].kind === 'polygon' ? input[0].holes : undefined,
      );
      expect(polygon.holes?.[0]).not.toBe(
        input[0].kind === 'polygon' ? input[0].holes?.[0] : undefined,
      );
    }
  });
});
