import { describe, expect, it } from 'vitest';
import * as fabric from 'fabric';
import {
  findCadSnap,
  getObjectSnapGeometry,
  resolveSemanticAnchor,
  snapCandidateToAnchor,
} from './cadSnapping';
import { setFabricMetadataValues } from './fabricObjectMetadata';
import { createSectionPath } from './sectionShapeFactory';

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

  it('snaps to the actual vertices and edges of a non-rectangular section profile', () => {
    const section = createSectionPath({
      version: 1,
      rings: [{
        role: 'outer',
        points: [
          { x: 10, y: -10 },
          { x: 10, y: -50 },
          { x: 30, y: -50 },
          { x: 30, y: -30 },
          { x: 50, y: -30 },
          { x: 50, y: -10 },
        ],
      }, {
        role: 'hole',
        points: [
          { x: 15, y: -15 },
          { x: 25, y: -15 },
          { x: 25, y: -25 },
          { x: 15, y: -25 },
        ],
      }],
      analysisToleranceMm: 0.01,
      approximate: false,
    }, { id: 'l-section', strokeWidth: 0 });

    const geometry = getObjectSnapGeometry(section);

    expect(geometry.segments).toHaveLength(10);
    expect(geometry.candidates).toContainEqual(expect.objectContaining({
      point: { x: 30, y: 30 },
      kind: 'endpoint',
      objectId: 'l-section',
      anchor: 'vertex',
      vertexIndex: 3,
    }));
    expect(geometry.candidates).toContainEqual(expect.objectContaining({
      point: { x: 15, y: 15 },
      kind: 'endpoint',
      anchor: 'vertex',
      vertexIndex: 6,
    }));
    expect(geometry.candidates).toContainEqual(expect.objectContaining({
      point: { x: 40, y: 30 },
      kind: 'midpoint',
    }));
    expect(findCadSnap([section], { x: 30.4, y: 30.4 }, 1)).toMatchObject({
      point: { x: 30, y: 30 },
      kind: 'endpoint',
      objectId: 'l-section',
    });

    const anchor = snapCandidateToAnchor(
      geometry.candidates.find((candidate) => candidate.vertexIndex === 3)!,
    );
    section.set({ left: section.left + 100, top: section.top + 50 });
    section.setCoords();

    expect(resolveSemanticAnchor(anchor, [section])).toEqual({ x: 130, y: 80 });
  });

  it('falls back for an invalid section transform without stopping other object snaps', () => {
    const invalidSection = createSectionPath({
      version: 1,
      rings: [{
        role: 'outer',
        points: [
          { x: 300, y: -300 },
          { x: 300, y: -340 },
          { x: 340, y: -340 },
          { x: 340, y: -300 },
        ],
      }],
      analysisToleranceMm: 0.01,
      approximate: false,
    }, { strokeWidth: 0 });
    invalidSection.set({ scaleX: 1e-20 });
    invalidSection.setCoords();
    const line = new fabric.Line([10, 20, 110, 20]);
    setFabricMetadataValues(line, { id: 'valid-line', objectKind: 'line' });

    expect(findCadSnap(
      [invalidSection, line],
      { x: 10.5, y: 20 },
      1,
    )).toMatchObject({
      point: { x: 10, y: 20 },
      kind: 'endpoint',
      objectId: 'valid-line',
    });
  });

  it.each(['flipX', 'flipY'] as const)(
    'keeps a saved section vertex anchor on the same physical point after %s',
    (flip) => {
      const section = createSectionPath({
        version: 1,
        rings: [{
          role: 'outer',
          points: [
            { x: 10, y: -10 },
            { x: 10, y: -50 },
            { x: 30, y: -60 },
            { x: 60, y: -35 },
            { x: 50, y: -10 },
          ],
        }],
        analysisToleranceMm: 0.01,
        approximate: false,
      }, { id: 'flipped-section', strokeWidth: 0 });
      const original = getObjectSnapGeometry(section).candidates.find(
        (candidate) => candidate.anchor === 'vertex' && candidate.vertexIndex === 0,
      )!;
      const anchor = snapCandidateToAnchor(original);
      const center = section.getCenterPoint();
      const expected = flip === 'flipX'
        ? { x: 2 * center.x - original.point.x, y: original.point.y }
        : { x: original.point.x, y: 2 * center.y - original.point.y };

      section.set(flip === 'flipX' ? { flipX: true } : { flipY: true });
      section.setCoords();

      const resolved = resolveSemanticAnchor(anchor, [section]);
      expect(resolved.x).toBeCloseTo(expected.x);
      expect(resolved.y).toBeCloseTo(expected.y);
    },
  );

  it('does not hide unexpected section geometry failures', () => {
    const section = createSectionPath({
      version: 1,
      rings: [{
        role: 'outer',
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 20 },
          { x: 20, y: 20 },
          { x: 20, y: 0 },
        ],
      }],
      analysisToleranceMm: 0.01,
      approximate: false,
    });
    section.calcTransformMatrix = () => {
      throw new Error('unexpected transform failure');
    };

    expect(() => getObjectSnapGeometry(section)).toThrow('unexpected transform failure');
  });
});
