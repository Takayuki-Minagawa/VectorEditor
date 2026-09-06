import * as fabric from 'fabric';
import { describe, expect, it, vi } from 'vitest';
import { calibrationFactor, calibrateSelection } from './calibration';
import { getFabricMetadata, setFabricMetadataValues } from './fabricObjectMetadata';
import { createSemanticDimension } from './semanticObjects';
import { measureClosedShape } from './geometryMeasurements';

function context(target: fabric.FabricObject, objects = [target]) {
  return { getActiveObject: () => target, getObjects: () => objects,
    discardActiveObject: vi.fn(() => { if (target instanceof fabric.ActiveSelection) target.remove(...target.getObjects()); }),
    requestRenderAll: vi.fn() } as unknown as fabric.Canvas;
}
describe('calibration', () => {
  it.each([['mm', 1000], ['cm', 100], ['m', 1]] as const)('interprets equivalent lengths in %s', (unit, length) => {
    expect(calibrationFactor({ x: 10, y: 20 }, { x: 210, y: 20 }, length, unit)).toBe(5);
  });
  it('scales a rotated object about the first point and commits once', () => {
    const rect = new fabric.Rect({ left: 10, top: 20, width: 200, height: 100, angle: 37, strokeWidth: 0 });
    const a = rect.getCoords()[0]; const b = rect.getCoords()[1];
    const push = vi.fn(); calibrateSelection(context(rect), rect, a, b, 1000, 'mm', push);
    const coords = rect.getCoords();
    expect(coords[0].x).toBeCloseTo(a.x); expect(coords[0].y).toBeCloseTo(a.y);
    expect(measureClosedShape(rect).area).toBeCloseTo(500000);
    expect(push).toHaveBeenCalledTimes(1);
  });
  it('scales a multi-selection in world coordinates and keeps spacing', () => {
    const first = new fabric.Rect({ left: 0, top: 0, width: 100, height: 100, originX: 'left', originY: 'top', strokeWidth: 0 });
    const second = new fabric.Rect({ left: 200, top: 0, width: 100, height: 100, originX: 'left', originY: 'top', strokeWidth: 0 });
    const selection = new fabric.ActiveSelection([first, second]);
    const push = vi.fn(); calibrateSelection(context(selection, [first, second]), selection, { x: 0, y: 0 }, { x: 100, y: 0 }, 500, 'mm', push);
    expect(first.getCoords()[0].x).toBeCloseTo(0);
    expect(second.getCoords()[0].x).toBeCloseTo(1000);
    expect(measureClosedShape(first).area).toBeCloseTo(250000);
    expect(push).toHaveBeenCalledTimes(1);
  });
  it('refreshes dimensions linked from outside the selection', () => {
    const rect = new fabric.Rect({ left: 0, top: 0, width: 200, height: 100, strokeWidth: 0 });
    setFabricMetadataValues(rect, { id: 'rect-1' });
    const dimension = createSemanticDimension({ start: { x: 0, y: 0, objectId: 'rect-1', anchor: 'topLeft' }, end: { x: 200, y: 0, objectId: 'rect-1', anchor: 'topRight' } }, String)!;
    calibrateSelection(context(rect, [rect, dimension]), rect, { x: 0, y: 0 }, { x: 200, y: 0 }, 1000, 'mm', vi.fn());
    const d = getFabricMetadata(dimension).dimensionData!;
    expect(d.start.objectId).toBe('rect-1');
    expect(Math.hypot(d.end.x - d.start.x, d.end.y - d.start.y)).toBeCloseTo(1000);
  });
  it('rebuilds selected dimension labels even when their transformed anchors already match', () => {
    const rect = new fabric.Rect({ left: 0, top: 0, width: 200, height: 100, originX: 'left', originY: 'top', strokeWidth: 0 });
    setFabricMetadataValues(rect, { id: 'rect-1' });
    const dimension = createSemanticDimension({ start: { x: 0, y: 0, objectId: 'rect-1', anchor: 'topLeft' }, end: { x: 200, y: 0, objectId: 'rect-1', anchor: 'topRight' } }, String)!;
    const selection = new fabric.ActiveSelection([rect, dimension]);
    calibrateSelection(context(selection, [rect, dimension]), selection, { x: 0, y: 0 }, { x: 200, y: 0 }, 1000, 'mm', vi.fn());
    const text = dimension.getObjects().find((o) => o instanceof fabric.Text) as fabric.Text;
    expect(text.text).toBe('1000');
  });
  it('rejects invalid or locked input before changing geometry', () => {
    const rect = new fabric.Rect({ width: 100, height: 100 }); const canvas = context(rect); const push = vi.fn();
    const before = rect.toObject();
    expect(() => calibrateSelection(canvas, rect, { x: 0, y: 0 }, { x: 0, y: 0 }, 1, 'mm', push)).toThrow();
    expect(rect.toObject()).toEqual(before);
    setFabricMetadataValues(rect, { locked: true });
    expect(() => calibrateSelection(canvas, rect, { x: 0, y: 0 }, { x: 100, y: 0 }, 200, 'mm', push)).toThrow();
    expect(push).not.toHaveBeenCalled();
  });
});
