import { afterEach, describe, expect, it } from 'vitest';
import * as fabric from 'fabric';
import { getFabricMetadata } from '../../utils/fabricObjectMetadata';
import { useEditorStore } from '../../store/useEditorStore';
import type { TracedDrawing, TracedShape } from './tracedDrawing';
import { toFabricObjects } from './toFabricObjects';

const canvases = new Set<fabric.Canvas>();

function createCanvas(
  width = 800,
  height = 600,
  viewportTransform?: fabric.TMat2D,
): fabric.Canvas {
  const canvas = new fabric.Canvas(undefined, { width, height });
  if (viewportTransform) canvas.setViewportTransform(viewportTransform);
  canvases.add(canvas);
  return canvas;
}

function drawing(
  shapes: TracedShape[],
  sourceWidth = 200,
  sourceHeight = 120,
): TracedDrawing {
  const vertexCount = shapes.reduce((count, shape) => {
    if (shape.kind === 'polygon') {
      return count
        + shape.points.length
        + (shape.holes?.reduce((sum, hole) => sum + hole.length, 0) ?? 0);
    }
    if (shape.kind === 'polyline') {
      return count + shape.points.length;
    }
    return count + (shape.kind === 'line' ? 2 : 1);
  }, 0);
  return {
    version: 1,
    sourceWidth,
    sourceHeight,
    shapes,
    stats: {
      componentCount: shapes.length,
      vertexCount,
      droppedCount: 0,
    },
  };
}

function combinedCenter(objects: fabric.FabricObject[]): fabric.Point {
  const bounds = objects.map((object) => object.getBoundingRect());
  const left = Math.min(...bounds.map((bound) => bound.left));
  const top = Math.min(...bounds.map((bound) => bound.top));
  const right = Math.max(...bounds.map((bound) => bound.left + bound.width));
  const bottom = Math.max(...bounds.map((bound) => bound.top + bound.height));
  return new fabric.Point((left + right) / 2, (top + bottom) / 2);
}

afterEach(() => {
  useEditorStore.getState().cancelHistoryTransaction();
  useEditorStore.setState({
    canvas: null,
    history: [],
    historyIndex: -1,
    isRestoring: false,
    revision: 0,
    selectedObjectIds: [],
    _skipHistoryPush: false,
  });
  canvases.forEach((canvas) => canvas.dispose());
  canvases.clear();
});

describe('toFabricObjects', () => {
  it('converts every traced shape into its editable Fabric counterpart', () => {
    const canvas = createCanvas();
    const color = '#2563eb';
    const objects = toFabricObjects(drawing([
      {
        kind: 'polygon',
        points: [{ x: 5, y: 5 }, { x: 25, y: 5 }, { x: 15, y: 25 }],
        closed: true,
      },
      {
        kind: 'polyline',
        points: [{ x: 35, y: 10 }, { x: 45, y: 20 }, { x: 55, y: 10 }],
        strokeWidth: 0.1,
      },
      {
        kind: 'line',
        x1: 65,
        y1: 10,
        x2: 95,
        y2: 25,
        strokeWidth: 3,
      },
      {
        kind: 'rect',
        x: 105,
        y: 5,
        width: 30,
        height: 20,
        angle: 12,
      },
      { kind: 'circle', cx: 155, cy: 15, r: 10 },
      {
        kind: 'ellipse',
        cx: 180,
        cy: 18,
        rx: 14,
        ry: 8,
        angle: -8,
      },
    ]), { canvas, color });

    expect(objects).toHaveLength(6);
    expect(objects[0]).toBeInstanceOf(fabric.Polygon);
    expect(objects[1]).toBeInstanceOf(fabric.Polyline);
    expect(objects[2]).toBeInstanceOf(fabric.Line);
    expect(objects[3]).toBeInstanceOf(fabric.Rect);
    expect(objects[4]).toBeInstanceOf(fabric.Circle);
    expect(objects[5]).toBeInstanceOf(fabric.Ellipse);

    expect(objects[0]).toMatchObject({ fill: color, stroke: color, strokeWidth: 0 });
    expect(objects[1]).toMatchObject({
      fill: '',
      stroke: color,
      strokeWidth: 0.5,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
    });
    expect(objects[2]).toMatchObject({ stroke: color, strokeWidth: 3 });
    expect(objects[3]).toMatchObject({ width: 30, height: 20, angle: 12 });
    expect(objects[4]).toMatchObject({ radius: 10 });
    expect(objects[5]).toMatchObject({ rx: 14, ry: 8 });
    expect(objects[5].angle).toBeCloseTo(-8, 8);

    const ids = objects.map((object) => getFabricMetadata(object).id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(objects.length);
    const center = combinedCenter(objects);
    // Rotated stroked shapes can make the recomputed axis-aligned union differ
    // fractionally from Fabric's original ActiveSelection bounds.
    expect(center.x).toBeCloseTo(canvas.getVpCenter().x, 0);
    expect(center.y).toBeCloseTo(canvas.getVpCenter().y, 0);
  });

  it('fits at no more than 80% of the visible viewport and centres after pan/zoom', () => {
    const canvas = createCanvas(500, 400, [2, 0, 0, 2, -200, -100]);
    const expectedCenter = canvas.getVpCenter();
    const [object] = toFabricObjects(drawing([
      { kind: 'rect', x: 0, y: 0, width: 1_000, height: 500, angle: 0 },
    ], 1_000, 500), { canvas });

    // The visible scene is 250 × 200, so the source-width constraint is
    // 250 × 0.8 / 1000 = 0.2.
    expect(object.scaleX).toBeCloseTo(0.2, 8);
    expect(object.scaleY).toBeCloseTo(0.2, 8);
    expect(object.getCenterPoint().x).toBeCloseTo(expectedCenter.x, 8);
    expect(object.getCenterPoint().y).toBeCloseTo(expectedCenter.y, 8);

    const largeCanvas = createCanvas(1_000, 800);
    const [smallObject] = toFabricObjects(drawing([
      { kind: 'rect', x: 0, y: 0, width: 100, height: 50, angle: 0 },
    ], 100, 50), { canvas: largeCanvas });
    expect(smallObject.scaleX).toBe(1);
    expect(smallObject.scaleY).toBe(1);
  });

  it('preserves primitive anchors and scales traced stroke widths with the drawing', () => {
    const canvas = createCanvas(500, 400, [2, 0, 0, 2, -200, -100]);
    const objects = toFabricObjects(drawing([
      { kind: 'rect', x: 10, y: 20, width: 30, height: 10, angle: 0 },
      { kind: 'circle', cx: 80, cy: 25, r: 5 },
      {
        kind: 'line',
        x1: 0,
        y1: 50,
        x2: 1_000,
        y2: 50,
        strokeWidth: 10,
      },
    ], 1_000, 500), { canvas });
    const [rect, circle, line] = objects;

    // Fabric includes uniform primitive strokes in ActiveSelection bounds, so
    // allow the sub-pixel offset while preserving the source-space relation.
    expect(circle.getCenterPoint().x - rect.getCenterPoint().x).toBeCloseTo(11, 0);
    expect(circle.getCenterPoint().y - rect.getCenterPoint().y).toBeCloseTo(0, 0);
    expect(rect).toMatchObject({ originX: 'left', originY: 'top' });
    expect(circle).toMatchObject({ originX: 'center', originY: 'center' });
    expect(line).toMatchObject({ strokeWidth: 10, strokeUniform: false });
    expect(line.scaleX).toBeCloseTo(0.2, 8);
    expect(line.scaleY).toBeCloseTo(0.2, 8);
    expect((line.strokeWidth ?? 0) * (line.scaleY ?? 1)).toBeCloseTo(2, 8);
  });

  it('keeps interior polygon rings as an editable even-odd Fabric path', () => {
    const canvas = createCanvas();
    const [object] = toFabricObjects(drawing([
      {
        kind: 'polygon',
        points: [
          { x: 10, y: 10 },
          { x: 90, y: 10 },
          { x: 90, y: 90 },
          { x: 10, y: 90 },
        ],
        holes: [[
          { x: 35, y: 35 },
          { x: 65, y: 35 },
          { x: 65, y: 65 },
          { x: 35, y: 65 },
        ]],
        closed: true,
      },
    ], 100, 100), { canvas });

    expect(object).toBeInstanceOf(fabric.Path);
    expect(object).toMatchObject({
      fill: '#111827',
      fillRule: 'evenodd',
      strokeWidth: 0,
    });
    expect((object as fabric.Path).path.filter(([command]) => command === 'M')).toHaveLength(2);
  });

  it('can preserve individual roots or return one recursively identified group', () => {
    const shapes: TracedShape[] = [
      { kind: 'rect', x: 5, y: 5, width: 30, height: 20, angle: 0 },
      { kind: 'circle', cx: 65, cy: 20, r: 12 },
    ];
    const canvas = createCanvas();

    const separate = toFabricObjects(drawing(shapes), { canvas, group: false });
    const grouped = toFabricObjects(drawing(shapes), { canvas, group: true });

    expect(separate).toHaveLength(2);
    expect(separate.every((object) => !(object instanceof fabric.Group))).toBe(true);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toBeInstanceOf(fabric.Group);
    const group = grouped[0] as fabric.Group;
    expect(group.getObjects()).toHaveLength(2);
    expect([
      getFabricMetadata(group).id,
      ...group.getObjects().map((object) => getFabricMetadata(object).id),
    ].every(Boolean)).toBe(true);
    expect(group.getCenterPoint().x).toBeCloseTo(canvas.getVpCenter().x, 8);
    expect(group.getCenterPoint().y).toBeCloseTo(canvas.getVpCenter().y, 8);
  });

  it('returns no Fabric objects for an empty traced drawing', () => {
    const canvas = createCanvas();
    expect(toFabricObjects(drawing([]), { canvas })).toEqual([]);
  });
});

describe('editor trace insertion', () => {
  it('inserts multiple roots as one history entry, selects them, and removes all with one Undo', async () => {
    const canvas = createCanvas();
    useEditorStore.setState({
      canvas,
      canvasWidth: 800,
      canvasHeight: 600,
      history: [],
      historyIndex: -1,
      isRestoring: false,
      _skipHistoryPush: false,
    });
    const state = useEditorStore.getState();
    state.resetHistory();

    const inserted = state.insertTracedDrawing(drawing([
      {
        kind: 'polygon',
        points: [{ x: 5, y: 5 }, { x: 45, y: 5 }, { x: 25, y: 35 }],
        closed: true,
      },
      { kind: 'circle', cx: 90, cy: 25, r: 20 },
    ]));

    expect(canvas.getObjects()).toEqual(inserted);
    expect(canvas.getActiveObject()).toBeInstanceOf(fabric.ActiveSelection);
    expect(canvas.getActiveObjects()).toEqual(inserted);
    expect(useEditorStore.getState()).toMatchObject({
      historyIndex: 1,
    });
    expect(useEditorStore.getState().history).toHaveLength(2);

    await useEditorStore.getState().undo();

    expect(canvas.getObjects()).toHaveLength(0);
    expect(useEditorStore.getState().historyIndex).toBe(0);
    expect(useEditorStore.getState().history).toHaveLength(2);
  });
});
