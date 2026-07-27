import { describe, expect, it } from 'vitest';
import {
  classifyShape,
  computeShapeFeatures,
  minimumAreaBounds,
} from './classify';
import type { TracedPoint } from './tracedDrawing';

function ellipsePoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  angleDeg: number,
  count = 32,
): TracedPoint[] {
  const angle = angleDeg * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return Array.from({ length: count }, (_, index) => {
    const parameter = index * Math.PI * 2 / count;
    const x = Math.cos(parameter) * rx;
    const y = Math.sin(parameter) * ry;
    return {
      x: cx + x * cos - y * sin,
      y: cy + x * sin + y * cos,
    };
  });
}

describe('cleanup geometry classification', () => {
  it('recognizes a hand-drawn rectangular outline', () => {
    const result = classifyShape([
      { x: 0, y: 0.2 },
      { x: 10, y: 0 },
      { x: 20, y: 0.3 },
      { x: 20.2, y: 5 },
      { x: 20, y: 10 },
      { x: 10, y: 9.8 },
      { x: -0.1, y: 10 },
      { x: 0, y: 5 },
    ]);
    expect(result.kind).toBe('rect');
    if (result.kind === 'rect') {
      expect(result.width * result.height).toBeGreaterThan(190);
      expect(result.strokeWidth).toBe(2);
    }
  });

  it('recognizes a slightly irregular circle', () => {
    const points = ellipsePoints(20, 20, 10, 10, 0, 32).map((point, index) => {
      const scale = index % 2 === 0 ? 1.01 : 0.99;
      return {
        x: 20 + (point.x - 20) * scale,
        y: 20 + (point.y - 20) * scale,
      };
    });
    const result = classifyShape(points, { strokeWidth: 5.25 });
    expect(result.kind).toBe('circle');
    if (result.kind === 'circle') {
      expect(result.cx).toBeCloseTo(20, 1);
      expect(result.r).toBeCloseTo(10, 0);
      expect(result.strokeWidth).toBe(5.25);
    }
  });

  it('recognizes a rotated ellipse and retains its orientation', () => {
    const result = classifyShape(
      ellipsePoints(30, 20, 12, 5, 30),
      { strokeWidth: 3.5 },
    );
    expect(result.kind).toBe('ellipse');
    if (result.kind === 'ellipse') {
      expect(Math.max(result.rx, result.ry)).toBeCloseTo(12, 0);
      expect(Math.min(result.rx, result.ry)).toBeCloseTo(5, 0);
      expect(Math.abs(result.angle)).toBeGreaterThan(20);
      expect(result.strokeWidth).toBe(3.5);
    }
  });

  it('turns straight open paths and slender closed marks into lines', () => {
    expect(classifyShape([
      { x: 0, y: 0 },
      { x: 5, y: 0.2 },
      { x: 10, y: 0.1 },
    ], { closed: false, strokeWidth: 2 }).kind).toBe('line');

    const slender = classifyShape([
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 2 },
      { x: 0, y: 2 },
    ]);
    expect(slender.kind).toBe('line');
    if (slender.kind === 'line') expect(slender.strokeWidth).toBeCloseTo(2);
  });

  it('falls back to a faithful polygon for an ambiguous concave shape', () => {
    const result = classifyShape([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 3 },
      { x: 4, y: 3 },
      { x: 4, y: 10 },
      { x: 0, y: 10 },
    ]);
    expect(result.kind).toBe('polygon');
  });

  it('rejects invalid classification stroke widths', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(() => classifyShape(points, { strokeWidth: 0 })).toThrow(RangeError);
    expect(() => classifyShape(points, { strokeWidth: Number.NaN }))
      .toThrow(RangeError);
  });

  it('computes stable geometric features and rotated bounds', () => {
    const points = ellipsePoints(100, 50, 20, 8, -25);
    const features = computeShapeFeatures(points);
    const bounds = minimumAreaBounds(points);
    expect(features.circularity).toBeGreaterThan(0.6);
    expect(features.convexity).toBeCloseTo(1);
    expect(bounds.center.x).toBeCloseTo(100, 5);
    expect(bounds.center.y).toBeCloseTo(50, 5);
  });
});
