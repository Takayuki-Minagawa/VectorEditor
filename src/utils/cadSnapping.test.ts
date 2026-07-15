import { describe, expect, it } from 'vitest';
import * as fabric from 'fabric';
import {
  findCadSnap,
  getObjectSnapGeometry,
  resolveSemanticAnchor,
  snapCandidateToAnchor,
} from './cadSnapping';
import { setFabricMetadataValues } from './fabricObjectMetadata';

describe('CAD object snapping', () => {
  it('finds line endpoints and midpoints in document coordinates', () => {
    const line = new fabric.Line([10, 20, 110, 20]);
    setFabricMetadataValues(line, { id: 'line-1', objectKind: 'line' });

    expect(findCadSnap([line], { x: 11, y: 20 }, 2)).toMatchObject({
      point: { x: 10, y: 20 },
      kind: 'endpoint',
      objectId: 'line-1',
      anchor: 'start',
    });
    expect(findCadSnap([line], { x: 60, y: 21 }, 2)).toMatchObject({
      point: { x: 60, y: 20 },
      kind: 'midpoint',
      anchor: 'midpoint',
    });
  });

  it('finds centers and intersections without snapping outside the threshold', () => {
    const circle = new fabric.Circle({ left: 25, top: 30, radius: 10 });
    const horizontal = new fabric.Line([0, 50, 100, 50]);
    const vertical = new fabric.Line([50, 0, 50, 100]);

    expect(findCadSnap([circle], { x: 25, y: 30 }, 1)?.kind).toBe('center');
    expect(findCadSnap([horizontal, vertical], { x: 50.5, y: 50.5 }, 2)).toMatchObject({
      point: { x: 50, y: 50 },
      kind: 'intersection',
    });
    expect(findCadSnap([horizontal], { x: 50, y: 60 }, 2)).toBeNull();
  });

  it('resolves a stored anchor after its referenced shape moves', () => {
    const rect = new fabric.Rect({ left: 100, top: 100, width: 40, height: 20 });
    setFabricMetadataValues(rect, { id: 'rect-1', objectKind: 'rect' });
    rect.setCoords();
    const topLeft = getObjectSnapGeometry(rect).candidates.find(
      (candidate) => candidate.anchor === 'topLeft',
    );
    expect(topLeft).toBeDefined();
    const anchor = snapCandidateToAnchor(topLeft!);

    rect.set({ left: 150, top: 130 });
    rect.setCoords();
    expect(resolveSemanticAnchor(anchor, [rect])).toEqual({ x: 129.5, y: 119.5 });
  });

  it('resolves a referenced child through a transformed group', () => {
    const child = new fabric.Rect({ left: 20, top: 30, width: 40, height: 20 });
    setFabricMetadataValues(child, { id: 'nested-rect', objectKind: 'rect' });
    const group = new fabric.Group([child], { left: 100, top: 80 });
    const anchor = { x: 0, y: 0, objectId: 'nested-rect', anchor: 'center' } as const;

    group.set({ left: 180, top: 120, angle: 15 });
    group.setCoords();
    child.setCoords();

    const resolved = resolveSemanticAnchor(anchor, [group]);
    const expected = child.getCenterPoint();
    expect(resolved.x).toBeCloseTo(expected.x);
    expect(resolved.y).toBeCloseTo(expected.y);
  });
});
