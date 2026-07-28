import { describe, expect, it, vi } from 'vitest';
import * as fabric from 'fabric';
import {
  applyBooleanOperationToSelection,
  isBooleanSourceObject,
  ShapeBooleanError,
} from './shapeBoolean';
import { sectionProfileFromFabricObject, isClosedFabricPath } from './sectionGeometry';
import { calculateSectionProperties } from './sectionProperties';
import { getFabricMetadata } from './fabricObjectMetadata';

function select(canvas: fabric.Canvas, objects: fabric.FabricObject[]): void {
  objects.forEach((object) => canvas.add(object));
  canvas.setActiveObject(objects.length === 1
    ? objects[0]
    : new fabric.ActiveSelection(objects, { canvas }));
}

function areaOf(object: fabric.FabricObject): number {
  return calculateSectionProperties(sectionProfileFromFabricObject(object)).area;
}

describe('applyBooleanOperationToSelection', () => {
  it('unites two overlapping rectangles into one path', () => {
    const canvas = new fabric.Canvas();
    const back = new fabric.Rect({ left: 0, top: 0, width: 100, height: 100, strokeWidth: 0 });
    const front = new fabric.Rect({ left: 50, top: 0, width: 100, height: 100, strokeWidth: 0 });
    select(canvas, [back, front]);
    const history = vi.fn();

    const result = applyBooleanOperationToSelection(canvas, history, 'union');

    expect(canvas.getObjects()).toEqual([result]);
    expect(canvas.getActiveObject()).toBe(result);
    expect(result.fillRule).toBe('evenodd');
    expect(getFabricMetadata(result).objectKind).toBe('path');
    expect(areaOf(result)).toBeCloseTo(15_000, 6);
    expect(history).toHaveBeenCalledTimes(1);
    canvas.dispose();
  });

  it('subtracts the front shapes from the back-most shape', () => {
    const canvas = new fabric.Canvas();
    const back = new fabric.Rect({ left: 0, top: 0, width: 100, height: 100, strokeWidth: 0 });
    const front = new fabric.Rect({ left: 50, top: 0, width: 100, height: 100, strokeWidth: 0 });
    select(canvas, [back, front]);

    const result = applyBooleanOperationToSelection(canvas, vi.fn(), 'subtract');
    expect(areaOf(result)).toBeCloseTo(5_000, 6);
    canvas.dispose();
  });

  it('produces a hole when the cutter is fully inside the subject', () => {
    const canvas = new fabric.Canvas();
    // Fabric v7 uses a center origin: both rectangles share the same centre.
    const back = new fabric.Rect({ left: 0, top: 0, width: 100, height: 100, strokeWidth: 0 });
    const inner = new fabric.Rect({ left: 0, top: 0, width: 20, height: 20, strokeWidth: 0 });
    select(canvas, [back, inner]);

    const result = applyBooleanOperationToSelection(canvas, vi.fn(), 'subtract');
    const profile = sectionProfileFromFabricObject(result);
    expect(profile.rings.map((ring) => ring.role).sort()).toEqual(['hole', 'outer']);
    expect(areaOf(result)).toBeCloseTo(10_000 - 400, 6);
    canvas.dispose();
  });

  it('intersects and excludes with the expected areas', () => {
    const intersectCanvas = new fabric.Canvas();
    select(intersectCanvas, [
      new fabric.Rect({ left: 0, top: 0, width: 100, height: 100, strokeWidth: 0 }),
      new fabric.Rect({ left: 50, top: 0, width: 100, height: 100, strokeWidth: 0 }),
    ]);
    const intersected = applyBooleanOperationToSelection(intersectCanvas, vi.fn(), 'intersect');
    expect(areaOf(intersected)).toBeCloseTo(5_000, 6);
    intersectCanvas.dispose();

    const excludeCanvas = new fabric.Canvas();
    select(excludeCanvas, [
      new fabric.Rect({ left: 0, top: 0, width: 100, height: 100, strokeWidth: 0 }),
      new fabric.Rect({ left: 50, top: 0, width: 100, height: 100, strokeWidth: 0 }),
    ]);
    const excluded = applyBooleanOperationToSelection(excludeCanvas, vi.fn(), 'exclude');
    expect(areaOf(excluded)).toBeCloseTo(10_000, 6);
    excludeCanvas.dispose();
  });

  it('supports curved shapes and Boolean-result paths as inputs', () => {
    const canvas = new fabric.Canvas();
    // Center origin: the rect spans x/y in [-50, 50], the circle is centred on
    // the rect's right edge so half of it protrudes.
    const rect = new fabric.Rect({ left: 0, top: 0, width: 100, height: 100, strokeWidth: 0 });
    const circle = new fabric.Circle({ left: 50, top: 0, radius: 25, strokeWidth: 0 });
    select(canvas, [rect, circle]);
    const union = applyBooleanOperationToSelection(canvas, vi.fn(), 'union');
    // Rectangle plus the protruding half of the circle.
    expect(areaOf(union)).toBeCloseTo(10_000 + (Math.PI * 25 * 25) / 2, 0);

    // The result path can be used as an input again: cut away the left half of
    // the original rectangle area (x in [-50, 0]).
    const cutter = new fabric.Rect({ left: -25, top: 0, width: 50, height: 100, strokeWidth: 0 });
    canvas.add(cutter);
    canvas.setActiveObject(new fabric.ActiveSelection([union, cutter], { canvas }));
    const second = applyBooleanOperationToSelection(canvas, vi.fn(), 'subtract');
    expect(areaOf(second)).toBeCloseTo(5_000 + (Math.PI * 25 * 25) / 2, 0);
    canvas.dispose();
  });

  it('keeps the result at the stacking position of the back-most source', () => {
    const canvas = new fabric.Canvas();
    const bottom = new fabric.Rect({ left: 0, top: 0, width: 10, height: 10, strokeWidth: 0 });
    canvas.add(bottom);
    const first = new fabric.Rect({ left: 20, top: 0, width: 100, height: 100, strokeWidth: 0 });
    const second = new fabric.Rect({ left: 70, top: 0, width: 100, height: 100, strokeWidth: 0 });
    const top = new fabric.Rect({ left: 200, top: 0, width: 10, height: 10, strokeWidth: 0 });
    select(canvas, [first, second]);
    canvas.add(top);

    const result = applyBooleanOperationToSelection(canvas, vi.fn(), 'union');
    expect(canvas.getObjects()).toEqual([bottom, result, top]);
    canvas.dispose();
  });

  it('rejects selections that are too small or contain open shapes', () => {
    const canvas = new fabric.Canvas();
    const rect = new fabric.Rect({ left: 0, top: 0, width: 100, height: 100, strokeWidth: 0 });
    select(canvas, [rect]);
    expect(() => applyBooleanOperationToSelection(canvas, vi.fn(), 'union'))
      .toThrow(ShapeBooleanError);

    const line = new fabric.Line([0, 0, 50, 50], { strokeWidth: 1 });
    canvas.add(line);
    canvas.setActiveObject(new fabric.ActiveSelection([rect, line], { canvas }));
    expect(() => applyBooleanOperationToSelection(canvas, vi.fn(), 'union'))
      .toThrow(ShapeBooleanError);
    expect(canvas.getObjects()).toHaveLength(2);
    canvas.dispose();
  });

  it('throws a no-intersection error for disjoint intersect inputs', () => {
    const canvas = new fabric.Canvas();
    select(canvas, [
      new fabric.Rect({ left: 0, top: 0, width: 10, height: 10, strokeWidth: 0 }),
      new fabric.Rect({ left: 100, top: 100, width: 10, height: 10, strokeWidth: 0 }),
    ]);
    expect(() => applyBooleanOperationToSelection(canvas, vi.fn(), 'intersect'))
      .toThrow(/overlap/i);
    canvas.dispose();
  });
});

describe('isBooleanSourceObject / isClosedFabricPath', () => {
  it('accepts closed shapes and closed paths, rejects open geometry', () => {
    expect(isBooleanSourceObject(new fabric.Rect({ width: 10, height: 10 }))).toBe(true);
    expect(isBooleanSourceObject(new fabric.Circle({ radius: 5 }))).toBe(true);
    expect(isBooleanSourceObject(new fabric.Line([0, 0, 10, 10]))).toBe(false);
    expect(isBooleanSourceObject(new fabric.Polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }]))).toBe(false);

    expect(isClosedFabricPath(new fabric.Path('M 0 0 L 10 0 L 10 10 Z'))).toBe(true);
    expect(isClosedFabricPath(new fabric.Path('M 0 0 L 10 0 L 10 10 L 0 0'))).toBe(true);
    expect(isClosedFabricPath(new fabric.Path('M 0 0 L 10 0 L 10 10'))).toBe(false);
    expect(isBooleanSourceObject(new fabric.Path('M 0 0 C 5 5 10 5 10 0'))).toBe(false);
  });
});
