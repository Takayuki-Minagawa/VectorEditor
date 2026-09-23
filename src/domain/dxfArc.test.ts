import { describe, expect, it } from 'vitest';
import { arcBoundsPoints, arcFromAngles, arcFromBulge, arcPoint } from './dxfArc';

describe('DXF arc geometry', () => {
  it('includes cardinal extrema across zero degrees', () => {
    const points = arcBoundsPoints(arcFromAngles({ x: 5, y: 7 }, 10, 300, 60));
    expect(Math.max(...points.map((p) => p.x))).toBeCloseTo(15);
    expect(Math.min(...points.map((p) => p.y))).toBeCloseTo(7 - 10 * Math.sqrt(3) / 2);
  });

  it('handles positive and negative bulges, including semicircles', () => {
    for (const bulge of [1, -1, .5, -.5]) {
      const arc = arcFromBulge({ x: 0, y: 0 }, { x: 10, y: 0 }, bulge)!;
      expect(arcPoint(arc, arc.startAngle).x).toBeCloseTo(0);
      expect(arcPoint(arc, arc.startAngle + arc.sweep).x).toBeCloseTo(10);
      expect(Math.sign(arc.sweep)).toBe(Math.sign(bulge));
    }
  });
});
