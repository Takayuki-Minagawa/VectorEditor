import * as fabric from 'fabric';
import { describe, expect, it } from 'vitest';
import { measureClosedShape, measurementValue, pointAngle, pointDistance } from './geometryMeasurements';
import { createSectionPath } from './sectionShapeFactory';

describe('geometry measurement', () => {
  it('measures a rotated and non-uniformly scaled rectangle without stroke area', () => {
    const rect = new fabric.Rect({ width: 100, height: 200, strokeWidth: 8, angle: 33 });
    expect(measureClosedShape(rect).area).toBeCloseTo(20000);
    expect(measureClosedShape(rect).outerPerimeter).toBeCloseTo(600);
    rect.set({ scaleX: 2, scaleY: 3 });
    expect(measureClosedShape(rect).area).toBeCloseTo(120000);
    expect(measureClosedShape(rect).outerPerimeter).toBeCloseTo(1600);
  });
  it('subtracts holes and reports each perimeter separately', () => {
    const shape = createSectionPath({ version: 1, analysisToleranceMm: 0.01, approximate: false, rings: [
      { role: 'outer', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }, { x: 0, y: 200 }] },
      { role: 'hole', points: [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }] },
    ] });
    expect(measureClosedShape(shape)).toMatchObject({ area: 19600, outerPerimeter: 600, holePerimeter: 80 });
  });
  it('measures distances and unsigned angles; rejects degenerate input', () => {
    expect(pointDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(pointAngle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: -1 })).toBe(90);
    expect(() => pointAngle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toThrow();
    expect(() => measureClosedShape(new fabric.Line([0, 0, 10, 20]))).toThrow();
  });
  it('scales area units quadratically', () => {
    expect(measurementValue(20000, 'cm', 2)).toBe('200 cm²');
    expect(measurementValue(20000, 'm', 2)).toBe('0.02 m²');
    expect(measurementValue(600, 'cm')).toBe('60 cm');
  });
});
