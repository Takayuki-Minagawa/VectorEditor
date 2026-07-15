import { describe, expect, it, vi } from 'vitest';
import * as fabric from 'fabric';
import { getFabricMetadata, setFabricMetadataValues } from './fabricObjectMetadata';
import {
  createSemanticConnector,
  createSemanticDimension,
  updateLinkedSemanticObjects,
} from './semanticObjects';
import { getObjectSnapGeometry } from './cadSnapping';

describe('semantic dimensions and connectors', () => {
  it('stores associative dimension metadata and a generated label', () => {
    const dimension = createSemanticDimension(
      { start: { x: 0, y: 0 }, end: { x: 300, y: 400 }, precision: 1, unit: 'mm' },
      (distance) => `${distance} mm`,
    );

    expect(dimension).not.toBeNull();
    expect(getFabricMetadata(dimension!).dimensionData).toMatchObject({
      start: { x: 0, y: 0 },
      end: { x: 300, y: 400 },
      precision: 1,
      unit: 'mm',
    });
    const label = dimension!.getObjects().find((object) => object instanceof fabric.Text);
    expect((label as fabric.Text).text).toBe('500.0 mm');
  });

  it('supports straight and elbow connector route models', () => {
    const straight = createSemanticConnector({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 50 },
      route: 'straight',
    });
    const elbow = createSemanticConnector({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 50 },
      route: 'elbow',
    });

    expect(straight?.getObjects()).toHaveLength(1);
    expect(elbow?.getObjects()).toHaveLength(3);
    expect(getFabricMetadata(elbow!).connectorData?.route).toBe('elbow');
  });

  it('updates linked geometry when a referenced object moves', () => {
    const source = new fabric.Rect({ left: 50, top: 50, width: 20, height: 20 });
    setFabricMetadataValues(source, { id: 'source', objectKind: 'rect' });
    source.setCoords();
    const connector = createSemanticConnector({
      from: { x: 50, y: 50, objectId: 'source', anchor: 'center' },
      to: { x: 200, y: 50 },
      route: 'straight',
    })!;
    const requestRenderAll = vi.fn();
    const canvas = {
      getObjects: () => [source, connector],
      requestRenderAll,
    } as unknown as fabric.Canvas;

    source.set({ left: 80, top: 90 });
    source.setCoords();
    expect(updateLinkedSemanticObjects(canvas, String, 'source')).toBe(true);
    expect(getFabricMetadata(connector).connectorData?.from).toMatchObject({ x: 80, y: 90 });
    expect(requestRenderAll).toHaveBeenCalledOnce();
  });

  it('updates a semantic object nested in a transformed group', () => {
    const source = new fabric.Rect({ left: 40, top: 30, width: 20, height: 20 });
    setFabricMetadataValues(source, { id: 'source', objectKind: 'rect' });
    source.setCoords();
    const connector = createSemanticConnector({
      from: { ...source.getCenterPoint(), objectId: 'source', anchor: 'center' },
      to: { x: 180, y: 40 },
      route: 'straight',
    })!;
    const parent = new fabric.Group([connector], { angle: 12 });
    const requestRenderAll = vi.fn();
    const canvas = {
      getObjects: () => [source, parent],
      requestRenderAll,
    } as unknown as fabric.Canvas;

    source.set({ left: 110, top: 85 });
    source.setCoords();
    expect(updateLinkedSemanticObjects(canvas, String, 'source')).toBe(true);

    const expected = source.getCenterPoint();
    expect(getFabricMetadata(connector).connectorData?.from.x).toBeCloseTo(expected.x);
    expect(getFabricMetadata(connector).connectorData?.from.y).toBeCloseTo(expected.y);
    const line = connector.getObjects()[0] as fabric.Line;
    const renderedStart = getObjectSnapGeometry(line).candidates.find(
      (candidate) => candidate.anchor === 'start',
    )?.point;
    expect(renderedStart?.x).toBeCloseTo(expected.x);
    expect(renderedStart?.y).toBeCloseTo(expected.y);
  });

  it('refreshes child references when their containing group moves', () => {
    const source = new fabric.Rect({ left: 20, top: 20, width: 20, height: 20 });
    setFabricMetadataValues(source, { id: 'nested-source', objectKind: 'rect' });
    const parent = new fabric.Group([source]);
    setFabricMetadataValues(parent, { id: 'parent-group', objectKind: 'group' });
    const connector = createSemanticConnector({
      from: { ...source.getCenterPoint(), objectId: 'nested-source', anchor: 'center' },
      to: { x: 200, y: 30 },
      route: 'straight',
    })!;
    const requestRenderAll = vi.fn();
    const canvas = {
      getObjects: () => [parent, connector],
      requestRenderAll,
    } as unknown as fabric.Canvas;

    parent.set({ left: (parent.left ?? 0) + 50 });
    parent.setCoords();
    source.setCoords();

    expect(updateLinkedSemanticObjects(canvas, String, 'parent-group')).toBe(true);
    expect(getFabricMetadata(connector).connectorData?.from.x)
      .toBeCloseTo(source.getCenterPoint().x);
  });

  it('updates only semantic objects that reference the changed ID set', () => {
    const first = new fabric.Rect({ left: 20, top: 20, width: 20, height: 20 });
    const second = new fabric.Rect({ left: 120, top: 20, width: 20, height: 20 });
    setFabricMetadataValues(first, { id: 'first', objectKind: 'rect' });
    setFabricMetadataValues(second, { id: 'second', objectKind: 'rect' });
    const firstConnector = createSemanticConnector({
      from: { ...first.getCenterPoint(), objectId: 'first', anchor: 'center' },
      to: { x: 20, y: 100 },
      route: 'straight',
    })!;
    const secondConnector = createSemanticConnector({
      from: { ...second.getCenterPoint(), objectId: 'second', anchor: 'center' },
      to: { x: 120, y: 100 },
      route: 'straight',
    })!;
    const secondGeometryRead = vi.spyOn(second, 'getCoords');
    const canvas = {
      getObjects: () => [first, second, firstConnector, secondConnector],
      requestRenderAll: vi.fn(),
    } as unknown as fabric.Canvas;

    first.set({ left: 50, top: 45 });
    first.setCoords();
    expect(updateLinkedSemanticObjects(canvas, String, ['first'])).toBe(true);

    expect(getFabricMetadata(firstConnector).connectorData?.from)
      .toMatchObject({ x: 50, y: 45 });
    expect(getFabricMetadata(secondConnector).connectorData?.from)
      .toMatchObject({ x: 120, y: 20 });
    expect(secondGeometryRead).not.toHaveBeenCalled();
  });

  it('propagates a targeted update through linked semantic objects', () => {
    const source = new fabric.Rect({ left: 30, top: 40, width: 20, height: 20 });
    setFabricMetadataValues(source, { id: 'chain-source', objectKind: 'rect' });
    const dimension = createSemanticDimension({
      start: { ...source.getCenterPoint(), objectId: 'chain-source', anchor: 'center' },
      end: { x: 180, y: 40 },
    }, String)!;
    setFabricMetadataValues(dimension, { id: 'chain-dimension' });
    const connector = createSemanticConnector({
      from: {
        ...getFabricMetadata(dimension).dimensionData!.start,
        objectId: 'chain-dimension',
        anchor: 'start',
      },
      to: { x: 180, y: 120 },
      route: 'straight',
    })!;
    const canvas = {
      getObjects: () => [source, dimension, connector],
      requestRenderAll: vi.fn(),
    } as unknown as fabric.Canvas;

    source.set({ left: 75, top: 65 });
    source.setCoords();
    expect(updateLinkedSemanticObjects(canvas, String, 'chain-source')).toBe(true);

    expect(getFabricMetadata(dimension).dimensionData?.start)
      .toMatchObject({ x: 75, y: 65 });
    expect(getFabricMetadata(connector).connectorData?.from)
      .toMatchObject({ x: 75, y: 65 });
  });

  it('refreshes a full semantic chain in dependency order when roots are reversed', () => {
    const source = new fabric.Rect({ left: 25, top: 35, width: 20, height: 20 });
    setFabricMetadataValues(source, { id: 'full-source', objectKind: 'rect' });
    const dimension = createSemanticDimension({
      start: { ...source.getCenterPoint(), objectId: 'full-source', anchor: 'center' },
      end: { x: 180, y: 35 },
    }, String)!;
    setFabricMetadataValues(dimension, { id: 'full-dimension' });
    const connector = createSemanticConnector({
      from: {
        ...getFabricMetadata(dimension).dimensionData!.start,
        objectId: 'full-dimension',
        anchor: 'start',
      },
      to: { x: 180, y: 120 },
      route: 'straight',
    })!;
    setFabricMetadataValues(connector, { id: 'full-connector' });
    const canvas = {
      // The dependent intentionally precedes its semantic dependency.
      getObjects: () => [source, connector, dimension],
      requestRenderAll: vi.fn(),
    } as unknown as fabric.Canvas;

    source.set({ left: 90, top: 70 });
    source.setCoords();
    expect(updateLinkedSemanticObjects(canvas)).toBe(true);

    expect(getFabricMetadata(dimension).dimensionData?.start)
      .toMatchObject({ x: 90, y: 70 });
    expect(getFabricMetadata(connector).connectorData?.from)
      .toMatchObject({ x: 90, y: 70 });
  });

  it('orders a targeted chain independently of changed-ID order', () => {
    const source = new fabric.Rect({ left: 30, top: 45, width: 20, height: 20 });
    setFabricMetadataValues(source, { id: 'ordered-source', objectKind: 'rect' });
    const dimension = createSemanticDimension({
      start: { ...source.getCenterPoint(), objectId: 'ordered-source', anchor: 'center' },
      end: { x: 190, y: 45 },
    }, String)!;
    setFabricMetadataValues(dimension, { id: 'ordered-dimension' });
    const connector = createSemanticConnector({
      from: {
        ...getFabricMetadata(dimension).dimensionData!.start,
        objectId: 'ordered-dimension',
        anchor: 'start',
      },
      to: { x: 190, y: 130 },
      route: 'straight',
    })!;
    setFabricMetadataValues(connector, { id: 'ordered-connector' });
    const canvas = {
      getObjects: () => [source, connector, dimension],
      requestRenderAll: vi.fn(),
    } as unknown as fabric.Canvas;

    source.set({ left: 105, top: 80 });
    source.setCoords();
    expect(updateLinkedSemanticObjects(
      canvas,
      String,
      ['ordered-connector', 'ordered-source'],
    )).toBe(true);

    expect(getFabricMetadata(dimension).dimensionData?.start)
      .toMatchObject({ x: 105, y: 80 });
    expect(getFabricMetadata(connector).connectorData?.from)
      .toMatchObject({ x: 105, y: 80 });
  });

  it('bounds relaxation when semantic references form a cycle', () => {
    const first = createSemanticConnector({
      from: { x: 20, y: 20, objectId: 'cycle-second', anchor: 'start' },
      to: { x: 120, y: 20 },
      route: 'straight',
    })!;
    const second = createSemanticConnector({
      from: { x: 80, y: 80, objectId: 'cycle-first', anchor: 'start' },
      to: { x: 120, y: 80 },
      route: 'straight',
    })!;
    setFabricMetadataValues(first, { id: 'cycle-first' });
    setFabricMetadataValues(second, { id: 'cycle-second' });
    const firstReads = vi.spyOn(first, 'getObjects');
    const secondReads = vi.spyOn(second, 'getObjects');
    const canvas = {
      getObjects: () => [first, second],
      requestRenderAll: vi.fn(),
    } as unknown as fabric.Canvas;

    expect(updateLinkedSemanticObjects(canvas)).toBe(true);
    // Each cyclic component is relaxed a fixed number of times; this guards
    // against an accidental unbounded work queue for mutually linked objects.
    expect(firstReads.mock.calls.length + secondReads.mock.calls.length).toBeLessThan(30);
    expect(canvas.requestRenderAll).toHaveBeenCalledOnce();
  });

  it('indexes the Fabric tree once for a batch of semantic anchor resolutions', () => {
    const sentinel = new fabric.Rect({ width: 10, height: 10 });
    let sentinelIdReads = 0;
    Object.defineProperty(sentinel, 'id', {
      configurable: true,
      get: () => {
        sentinelIdReads += 1;
        return 'sentinel';
      },
    });
    const source = new fabric.Rect({ left: 50, top: 50, width: 20, height: 20 });
    setFabricMetadataValues(source, { id: 'indexed-source', objectKind: 'rect' });
    const connectors = Array.from({ length: 40 }, (_, index) => createSemanticConnector({
      from: { ...source.getCenterPoint(), objectId: 'indexed-source', anchor: 'center' },
      to: { x: 150 + index, y: 80 + index },
      route: 'straight',
    })!);
    const canvas = {
      getObjects: () => [sentinel, source, ...connectors],
      requestRenderAll: vi.fn(),
    } as unknown as fabric.Canvas;

    expect(updateLinkedSemanticObjects(canvas)).toBe(false);
    // This stays constant as connector count grows. A per-anchor tree scan
    // would read the sentinel ID once for every connector.
    expect(sentinelIdReads).toBe(1);
  });
});
