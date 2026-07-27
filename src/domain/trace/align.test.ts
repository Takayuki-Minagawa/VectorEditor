import { describe, expect, it } from 'vitest';
import { alignShapes, snapAngle } from './align';
import type { TracedShape } from './tracedDrawing';

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
