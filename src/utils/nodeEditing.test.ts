import { describe, expect, it } from 'vitest';
import * as fabric from 'fabric';
import {
  convertLineToPolylineWithNode,
  deletePolylineNode,
  findNodeAtScenePoint,
  insertPathNode,
  insertPolylineNode,
  isNodeEditableObject,
  listNodesInScene,
  moveLineEndpoint,
  remapLineAnchorsToPolyline,
  retargetVertexAnchorsAfterDelete,
  shiftVertexAnchorsAfterInsert,
} from './nodeEditing';
import {
  getFabricMetadata,
  setFabricMetadataValues,
  type DimensionData,
} from './fabricObjectMetadata';

function scenePoints(object: fabric.Line | fabric.Polyline | fabric.Path): { x: number; y: number }[] {
  return listNodesInScene(object).map((node) => node.point);
}

describe('isNodeEditableObject', () => {
  it('accepts lines, polylines, polygons and paths but not other shapes', () => {
    expect(isNodeEditableObject(new fabric.Line([0, 0, 10, 10]))).toBe(true);
    expect(isNodeEditableObject(new fabric.Polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }]))).toBe(true);
    expect(isNodeEditableObject(new fabric.Polygon([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }]))).toBe(true);
    expect(isNodeEditableObject(new fabric.Path('M 0 0 L 10 10'))).toBe(true);
    expect(isNodeEditableObject(new fabric.Rect({ width: 10, height: 10 }))).toBe(false);
  });

  it('rejects locked objects and semantic dimension groups', () => {
    const locked = new fabric.Line([0, 0, 10, 10]);
    setFabricMetadataValues(locked, { locked: true });
    expect(isNodeEditableObject(locked)).toBe(false);

    const dimension = new fabric.Path('M 0 0 L 10 10');
    setFabricMetadataValues(dimension, { objectKind: 'dimension' });
    expect(isNodeEditableObject(dimension)).toBe(false);
  });

  it('rejects section profiles whose analysis metadata would desynchronise', () => {
    const section = new fabric.Path('M 0 0 L 10 0 L 10 10 L 0 10 Z');
    setFabricMetadataValues(section, { objectKind: 'sectionProfile' });
    expect(isNodeEditableObject(section)).toBe(false);
  });
});

describe('moveLineEndpoint', () => {
  it('moves one endpoint to the pointer and keeps the other endpoint fixed', () => {
    const line = new fabric.Line([10, 20, 110, 20], { strokeWidth: 0 });
    moveLineEndpoint(line, 'end', { x: 150, y: 80 });

    const [start, end] = scenePoints(line);
    expect(start.x).toBeCloseTo(10, 6);
    expect(start.y).toBeCloseTo(20, 6);
    expect(end.x).toBeCloseTo(150, 6);
    expect(end.y).toBeCloseTo(80, 6);
  });

  it('keeps the fixed endpoint stable after the line was translated', () => {
    const line = new fabric.Line([0, 0, 100, 0], { strokeWidth: 0 });
    line.set({ left: (line.left ?? 0) + 40, top: (line.top ?? 0) + 30 });
    line.setCoords();
    const [startBefore] = scenePoints(line);

    moveLineEndpoint(line, 'end', { x: 200, y: 90 });
    const [start, end] = scenePoints(line);
    expect(start.x).toBeCloseTo(startBefore.x, 6);
    expect(start.y).toBeCloseTo(startBefore.y, 6);
    expect(end.x).toBeCloseTo(200, 6);
    expect(end.y).toBeCloseTo(90, 6);
  });
});

describe('insertPolylineNode / deletePolylineNode', () => {
  it('inserts a vertex on the nearest segment without moving other vertices', () => {
    const poly = new fabric.Polyline(
      [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
      { strokeWidth: 0 },
    );
    const before = scenePoints(poly);

    const inserted = insertPolylineNode(poly, { x: 52, y: 6 }, 10);
    expect(inserted).toBe(1);
    const after = scenePoints(poly);
    expect(after).toHaveLength(4);
    expect(after[1].x).toBeCloseTo(52, 6);
    expect(after[1].y).toBeCloseTo(0, 6);
    expect(after[0].x).toBeCloseTo(before[0].x, 6);
    expect(after[0].y).toBeCloseTo(before[0].y, 6);
    expect(after[3].x).toBeCloseTo(before[2].x, 6);
    expect(after[3].y).toBeCloseTo(before[2].y, 6);
  });

  it('keeps document positions stable on a scaled and moved polyline', () => {
    const poly = new fabric.Polyline(
      [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
      { strokeWidth: 0, scaleX: 2, scaleY: 0.5 },
    );
    poly.set({ left: (poly.left ?? 0) + 25, top: (poly.top ?? 0) + 35 });
    poly.setCoords();
    const before = scenePoints(poly);
    const target = {
      x: (before[0].x + before[1].x) / 2,
      y: (before[0].y + before[1].y) / 2,
    };

    const inserted = insertPolylineNode(poly, target, 10);
    expect(inserted).toBe(1);
    const after = scenePoints(poly);
    expect(after[0].x).toBeCloseTo(before[0].x, 6);
    expect(after[0].y).toBeCloseTo(before[0].y, 6);
    expect(after[1].x).toBeCloseTo(target.x, 6);
    expect(after[1].y).toBeCloseTo(target.y, 6);
    expect(after[2].x).toBeCloseTo(before[1].x, 6);
    expect(after[2].y).toBeCloseTo(before[1].y, 6);
    expect(after[3].x).toBeCloseTo(before[2].x, 6);
    expect(after[3].y).toBeCloseTo(before[2].y, 6);
  });

  it('returns null when the pointer is not near any segment', () => {
    const poly = new fabric.Polyline([{ x: 0, y: 0 }, { x: 100, y: 0 }], { strokeWidth: 0 });
    expect(insertPolylineNode(poly, { x: 50, y: 60 }, 10)).toBeNull();
  });

  it('deletes vertices down to the minimum count', () => {
    const polygon = new fabric.Polygon(
      [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
      { strokeWidth: 0 },
    );
    const before = scenePoints(polygon);
    expect(deletePolylineNode(polygon, 1)).toBe(true);
    const after = scenePoints(polygon);
    expect(after).toHaveLength(3);
    expect(after[0].x).toBeCloseTo(before[0].x, 6);
    expect(after[0].y).toBeCloseTo(before[0].y, 6);
    // A triangle may not lose another vertex.
    expect(deletePolylineNode(polygon, 0)).toBe(false);

    const polyline = new fabric.Polyline([{ x: 0, y: 0 }, { x: 100, y: 0 }], { strokeWidth: 0 });
    expect(deletePolylineNode(polyline, 0)).toBe(false);
  });
});

describe('insertPathNode', () => {
  it('splits a curve segment while keeping anchors in place', () => {
    const path = new fabric.Path('M 0 0 C 30 90 80 -40 120 20', { strokeWidth: 0 });
    const before = scenePoints(path);

    const target = {
      x: (before[0].x + before[1].x) / 2,
      y: (before[0].y + before[1].y) / 2,
    };
    const inserted = insertPathNode(path, target, 1_000);
    expect(inserted).not.toBeNull();

    const after = scenePoints(path);
    expect(after).toHaveLength(3);
    expect(after[0].x).toBeCloseTo(before[0].x, 6);
    expect(after[0].y).toBeCloseTo(before[0].y, 6);
    expect(after[2].x).toBeCloseTo(before[1].x, 6);
    expect(after[2].y).toBeCloseTo(before[1].y, 6);
  });

  it('picks the segment nearest on screen under a non-uniform scale', () => {
    // Raw-local distances: 60 to the vertical segment, 80 to the horizontal
    // one. With scaleY = 0.1 the on-screen distances become 60 vs 8, so the
    // horizontal segment must win.
    const path = new fabric.Path('M 0 200 L 0 0 L 200 0', { strokeWidth: 0, scaleY: 0.1 });
    const offset = path.pathOffset;
    const scenePoint = fabric.util.transformPoint(
      new fabric.Point(60 - offset.x, 80 - offset.y),
      path.calcTransformMatrix(),
    );

    const inserted = insertPathNode(path, { x: scenePoint.x, y: scenePoint.y }, 100);

    expect(inserted).not.toBeNull();
    const commands = path.path as unknown as [string, ...number[]][];
    expect(commands).toHaveLength(4);
    // The new anchor sits on the horizontal segment at the pointer's x.
    expect(commands[2][0]).toBe('L');
    expect(commands[2][1]).toBeCloseTo(60, 6);
    expect(commands[2][2]).toBeCloseTo(0, 6);
  });
});

describe('findNodeAtScenePoint', () => {
  it('finds the nearest node within tolerance', () => {
    const poly = new fabric.Polyline(
      [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
      { strokeWidth: 0 },
    );
    const nodes = scenePoints(poly);
    const hit = findNodeAtScenePoint(poly, { x: nodes[1].x + 3, y: nodes[1].y - 2 }, 8);
    expect(hit).toEqual({ type: 'poly', index: 1 });
    expect(findNodeAtScenePoint(poly, { x: 50, y: 50 }, 8)).toBeNull();
  });
});

describe('convertLineToPolylineWithNode', () => {
  it('replaces a line with an equivalent three-point polyline keeping id and style', () => {
    const line = new fabric.Line([0, 0, 100, 0], {
      stroke: '#123456',
      strokeWidth: 3,
      strokeDashArray: [4, 2],
    });
    setFabricMetadataValues(line, { id: 'line_test_1', objectKind: 'line', name: 'edge' });

    const polyline = convertLineToPolylineWithNode(line, { x: 40, y: 1 }, 10)!;
    expect(polyline).not.toBeNull();
    expect(getFabricMetadata(polyline)).toMatchObject({
      id: 'line_test_1',
      objectKind: 'polyline',
      name: 'edge',
    });
    expect(polyline.stroke).toBe('#123456');
    expect(polyline.strokeWidth).toBe(3);
    expect(polyline.strokeDashArray).toEqual([4, 2]);

    const nodes = scenePoints(polyline);
    expect(nodes).toHaveLength(3);
    expect(nodes[0].x).toBeCloseTo(0, 6);
    expect(nodes[0].y).toBeCloseTo(0, 6);
    expect(nodes[1].x).toBeCloseTo(40, 6);
    expect(nodes[1].y).toBeCloseTo(0, 6);
    expect(nodes[2].x).toBeCloseTo(100, 6);
    expect(nodes[2].y).toBeCloseTo(0, 6);
  });

  it('returns null for pointers beyond the tolerance or outside the segment', () => {
    const line = new fabric.Line([0, 0, 100, 0], { strokeWidth: 0 });
    expect(convertLineToPolylineWithNode(line, { x: 50, y: 40 }, 10)).toBeNull();
    expect(convertLineToPolylineWithNode(line, { x: -20, y: 0 }, 10)).toBeNull();
  });

  it('preserves the source transform and stroke rendering attributes', () => {
    const line = new fabric.Line([0, 0, 100, 0], {
      stroke: '#123456',
      strokeWidth: 4,
      strokeUniform: false,
      strokeDashOffset: 5,
      scaleX: 2,
      scaleY: 3,
      angle: 30,
    });
    const [startBefore, endBefore] = scenePoints(line);
    const middle = {
      x: (startBefore.x + endBefore.x) / 2,
      y: (startBefore.y + endBefore.y) / 2,
    };

    const polyline = convertLineToPolylineWithNode(line, middle, 10)!;
    expect(polyline).not.toBeNull();
    // The transform is carried over instead of being baked into the points,
    // so non-uniform stroke scaling keeps rendering exactly as before.
    expect(polyline.strokeUniform).toBe(false);
    expect(polyline.strokeDashOffset).toBe(5);
    expect(polyline.scaleX).toBeCloseTo(2, 9);
    expect(polyline.scaleY).toBeCloseTo(3, 9);
    expect(polyline.angle).toBeCloseTo(30, 9);

    const nodes = scenePoints(polyline);
    expect(nodes).toHaveLength(3);
    expect(nodes[0].x).toBeCloseTo(startBefore.x, 6);
    expect(nodes[0].y).toBeCloseTo(startBefore.y, 6);
    expect(nodes[1].x).toBeCloseTo(middle.x, 6);
    expect(nodes[1].y).toBeCloseTo(middle.y, 6);
    expect(nodes[2].x).toBeCloseTo(endBefore.x, 6);
    expect(nodes[2].y).toBeCloseTo(endBefore.y, 6);
  });
});

describe('semantic anchor maintenance', () => {
  function dimensionWith(anchors: Partial<DimensionData>): fabric.Group {
    const group = new fabric.Group([new fabric.Line([0, 0, 10, 0])]);
    setFabricMetadataValues(group, {
      objectKind: 'dimension',
      dimensionData: {
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 },
        ...anchors,
      },
    });
    return group;
  }

  it('shifts vertex references at or after an inserted node', () => {
    const canvas = new fabric.Canvas();
    const dimension = dimensionWith({
      start: { x: 0, y: 0, objectId: 'poly_1', anchor: 'vertex', vertexIndex: 1 },
      end: { x: 10, y: 0, objectId: 'poly_1', anchor: 'vertex', vertexIndex: 3 },
    });
    canvas.add(dimension);

    shiftVertexAnchorsAfterInsert(canvas, 'poly_1', 2);
    const data = getFabricMetadata(dimension).dimensionData!;
    expect(data.start.vertexIndex).toBe(1);
    expect(data.end.vertexIndex).toBe(4);
    canvas.dispose();
  });

  it('detaches references to a deleted vertex and shifts later ones', () => {
    const canvas = new fabric.Canvas();
    const dimension = dimensionWith({
      start: { x: 0, y: 0, objectId: 'poly_1', anchor: 'vertex', vertexIndex: 2 },
      end: { x: 10, y: 0, objectId: 'poly_1', anchor: 'vertex', vertexIndex: 3 },
    });
    canvas.add(dimension);

    retargetVertexAnchorsAfterDelete(canvas, 'poly_1', 2);
    const data = getFabricMetadata(dimension).dimensionData!;
    expect(data.start.objectId).toBeUndefined();
    expect(data.start.anchor).toBeUndefined();
    expect(data.start).toMatchObject({ x: 0, y: 0 });
    expect(data.end.vertexIndex).toBe(2);
    canvas.dispose();
  });

  it('detaches the split segment midpoint and shifts later midpoints on insert', () => {
    const canvas = new fabric.Canvas();
    const dimension = dimensionWith({
      start: { x: 5, y: 0, objectId: 'poly_1', anchor: 'midpoint', vertexIndex: 1 },
      end: { x: 10, y: 0, objectId: 'poly_1', anchor: 'midpoint', vertexIndex: 2 },
    });
    canvas.add(dimension);

    // Inserting at index 2 splits the segment starting at vertex 1: its old
    // midpoint no longer exists.
    shiftVertexAnchorsAfterInsert(canvas, 'poly_1', 2);
    const data = getFabricMetadata(dimension).dimensionData!;
    expect(data.start.objectId).toBeUndefined();
    expect(data.start).toMatchObject({ x: 5, y: 0 });
    expect(data.end).toMatchObject({ anchor: 'midpoint', vertexIndex: 3 });
    canvas.dispose();
  });

  it('detaches midpoints of both segments adjacent to a deleted vertex', () => {
    const canvas = new fabric.Canvas();
    const dimension = dimensionWith({
      start: { x: 5, y: 0, objectId: 'poly_1', anchor: 'midpoint', vertexIndex: 1 },
      end: { x: 10, y: 0, objectId: 'poly_1', anchor: 'midpoint', vertexIndex: 3 },
    });
    canvas.add(dimension);

    // Deleting vertex 2 merges segments (1,2) and (2,3): the midpoint of the
    // preceding segment detaches, later midpoints shift down.
    retargetVertexAnchorsAfterDelete(canvas, 'poly_1', 2, {
      closed: false,
      pointCountBefore: 5,
    });
    const data = getFabricMetadata(dimension).dimensionData!;
    expect(data.start.objectId).toBeUndefined();
    expect(data.start).toMatchObject({ x: 5, y: 0 });
    expect(data.end).toMatchObject({ anchor: 'midpoint', vertexIndex: 2 });
    canvas.dispose();
  });

  it('detaches the wrap-around midpoint when a polygon loses its first vertex', () => {
    const canvas = new fabric.Canvas();
    const dimension = dimensionWith({
      start: { x: 5, y: 0, objectId: 'poly_1', anchor: 'midpoint', vertexIndex: 3 },
      end: { x: 10, y: 0, objectId: 'poly_1', anchor: 'midpoint', vertexIndex: 1 },
    });
    canvas.add(dimension);

    // Deleting vertex 0 of a closed square merges the closing segment (3,0)
    // with segment (0,1); the closing segment's midpoint detaches.
    retargetVertexAnchorsAfterDelete(canvas, 'poly_1', 0, {
      closed: true,
      pointCountBefore: 4,
    });
    const data = getFabricMetadata(dimension).dimensionData!;
    expect(data.start.objectId).toBeUndefined();
    expect(data.start).toMatchObject({ x: 5, y: 0 });
    expect(data.end).toMatchObject({ anchor: 'midpoint', vertexIndex: 0 });
    canvas.dispose();
  });

  it('rebinds line start/end anchors onto polyline vertices', () => {
    const canvas = new fabric.Canvas();
    const dimension = dimensionWith({
      start: { x: 0, y: 0, objectId: 'line_1', anchor: 'start' },
      end: { x: 10, y: 0, objectId: 'line_1', anchor: 'end' },
    });
    canvas.add(dimension);

    remapLineAnchorsToPolyline(canvas, 'line_1', 2);
    const data = getFabricMetadata(dimension).dimensionData!;
    expect(data.start).toMatchObject({ anchor: 'vertex', vertexIndex: 0 });
    expect(data.end).toMatchObject({ anchor: 'vertex', vertexIndex: 2 });
    canvas.dispose();
  });
});
