import * as fabric from 'fabric';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ToolType } from '../types';
import { createShapeOnDrag } from './shapeFactory';
import { loadCurrentEditorStyle, saveCurrentEditorStyle } from './stylePresets';

const DRAG_DIRECTIONS = [
  { name: 'down-right', start: [300, 300], end: [550, 480] },
  { name: 'up-left', start: [550, 480], end: [300, 300] },
  { name: 'up-right', start: [300, 480], end: [550, 300] },
  { name: 'down-left', start: [550, 300], end: [300, 480] },
] as const;

function draw(tool: ToolType, start: readonly number[], end: readonly number[]): fabric.FabricObject {
  const shape = createShapeOnDrag(tool, start[0], start[1], end[0], end[1], String);
  if (!shape) throw new Error(`Expected ${tool} to create a shape`);
  shape.setCoords();
  return shape;
}

function lineEndpoints(line: fabric.Line): fabric.Point[] {
  const { x1, y1, x2, y2 } = line.calcLinePoints();
  const matrix = line.calcTransformMatrix();
  return [new fabric.Point(x1, y1).transform(matrix), new fabric.Point(x2, y2).transform(matrix)];
}

describe('createShapeOnDrag placement', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const kind of ['shape', 'line'] as const) {
      saveCurrentEditorStyle({ ...loadCurrentEditorStyle(kind), strokeWidth: 0 }, kind);
    }
  });

  for (const tool of ['rect', 'roundedRect', 'ellipse', 'triangle', 'diamond', 'wall'] as const) {
    it.each(DRAG_DIRECTIONS)(`${tool} follows the $name drag bounds`, ({ start, end }) => {
      const shape = draw(tool, start, end);

      expect(shape.getBoundingRect()).toEqual({ left: 300, top: 300, width: 250, height: 180 });
      expect(shape.toObject()).toMatchObject({ originX: 'left', originY: 'top' });
    });
  }

  it.each(DRAG_DIRECTIONS)('circle grows from the start corner for a $name drag', ({ start, end }) => {
    const circle = draw('circle', start, end);

    expect(circle.getBoundingRect()).toEqual({
      left: end[0] >= start[0] ? start[0] : start[0] - 250,
      top: end[1] >= start[1] ? start[1] : start[1] - 250,
      width: 250,
      height: 250,
    });
  });

  it.each([
    { end: [550, 300], expected: { left: 300, top: 300, width: 250, height: 250 } },
    { end: [300, 480], expected: { left: 300, top: 300, width: 180, height: 180 } },
  ])('anchors an axis-aligned circle drag at the start corner', ({ end, expected }) => {
    expect(draw('circle', [300, 300], end).getBoundingRect()).toEqual(expected);
  });

  it.each([
    { end: [550, 300], expected: { left: 300, top: 300, width: 250, height: 4 } },
    { end: [300, 480], expected: { left: 300, top: 300, width: 4, height: 180 } },
    { end: [299, 480], expected: { left: 299, top: 300, width: 4, height: 180 } },
  ])('preserves the wall minimum thickness at the drag bounds', ({ end, expected }) => {
    expect(draw('wall', [300, 300], end).getBoundingRect()).toEqual(expected);
  });

  it('keeps stroke expansion separate from the drag geometry', () => {
    saveCurrentEditorStyle({ ...loadCurrentEditorStyle('shape'), strokeWidth: 6 }, 'shape');
    const rect = draw('rect', [300, 300], [550, 480]);

    expect(rect.width).toBe(250);
    expect(rect.height).toBe(180);
    // Fabric's left/top origin locates the outer stroke edge; its bounds add
    // the stroke width without a half-shape translation.
    expect(rect.getBoundingRect()).toEqual({ left: 300, top: 300, width: 256, height: 186 });
  });

  it.each(DRAG_DIRECTIONS)('preserves line and arrow endpoints for a $name drag', ({ start, end }) => {
    const line = draw('line', start, end) as fabric.Line;
    const arrow = draw('arrow', start, end) as fabric.Group;
    const shaft = arrow.getObjects()[0] as fabric.Line;
    const head = arrow.getObjects()[1] as fabric.Polygon;

    for (const candidate of [line, shaft]) {
      const points = lineEndpoints(candidate);
      expect(points[0].x).toBeCloseTo(start[0]);
      expect(points[0].y).toBeCloseTo(start[1]);
      expect(points[1].x).toBeCloseTo(end[0]);
      expect(points[1].y).toBeCloseTo(end[1]);
    }
    const tip = new fabric.Point(head.points[0]).subtract(head.pathOffset).transform(head.calcTransformMatrix());
    expect(tip.x).toBeCloseTo(end[0]);
    expect(tip.y).toBeCloseTo(end[1]);
  });

  it('retains drag placement when the saved object is restored', async () => {
    const shape = draw('rect', [550, 480], [300, 300]);
    const [restored] = await fabric.util.enlivenObjects<fabric.FabricObject>([shape.toObject()]);
    restored.setCoords();

    expect(restored.getBoundingRect()).toEqual({ left: 300, top: 300, width: 250, height: 180 });
  });

  it('does not create geometry for a click without a drag', () => {
    expect(createShapeOnDrag('rect', 300, 300, 301, 301, String)).toBeNull();
  });
});
