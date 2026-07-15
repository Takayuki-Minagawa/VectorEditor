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
});
