import * as fabric from 'fabric';
import { describe, expect, it } from 'vitest';
import { signedSectionRingArea } from '../domain/section';
import { calculateSectionProperties } from './sectionProperties';
import {
  fabricObjectsToSectionProfile,
  readSectionProfileInDocumentCoordinates,
  readSectionProfileRingsInDocumentCoordinates,
  sectionProfileFromFabricObject,
  SectionGeometryError,
} from './sectionGeometry';
import { createSectionPath } from './sectionShapeFactory';
import { cubicPointAt } from './pathCommands';

function profileArea(profile: ReturnType<typeof fabricObjectsToSectionProfile>): number {
  return profile.rings.reduce(
    (sum, ring) => sum + signedSectionRingArea(ring.points),
    0,
  );
}

function bounds(points: readonly { x: number; y: number }[]) {
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

describe('sectionGeometry', () => {
  it('converts a transformed Fabric rectangle to document-mm x-right/y-up coordinates', () => {
    const rectangle = new fabric.Rect({
      left: 10,
      top: 20,
      width: 100,
      height: 40,
      scaleX: 2,
      scaleY: 0.5,
      strokeWidth: 0,
    });

    const profile = sectionProfileFromFabricObject(rectangle);

    expect(profile.approximate).toBe(false);
    expect(profile.rings).toHaveLength(1);
    expect(profileArea(profile)).toBeCloseTo(4_000, 8);
    expect(bounds(profile.rings[0].points)).toEqual({
      minX: -90,
      maxX: 110,
      minY: -30,
      maxY: -10,
    });
  });

  it('bakes nested group transforms into supported child geometry', () => {
    const child = new fabric.Polygon(
      [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 10 }],
      { strokeWidth: 0 },
    );
    const group = new fabric.Group([child], {
      left: 100,
      top: 50,
      angle: 90,
      scaleX: 2,
      scaleY: 3,
    });

    const profile = sectionProfileFromFabricObject(group);

    expect(profileArea(profile)).toBeCloseTo(600, 8);
    const centroid = profile.rings[0].points.reduce(
      (sum, point) => ({ x: sum.x + point.x / 3, y: sum.y + point.y / 3 }),
      { x: 0, y: 0 },
    );
    expect(centroid.x).toBeCloseTo(105, 8);
    expect(centroid.y).toBeCloseTo(-43.3333333333, 8);
  });

  it('adaptively tessellates circles and marks the result approximate', () => {
    const circle = new fabric.Circle({ radius: 50, left: 25, top: 80, strokeWidth: 0 });

    const coarse = sectionProfileFromFabricObject(circle, 1);
    const fine = sectionProfileFromFabricObject(circle, 0.001);

    expect(coarse.approximate).toBe(true);
    expect(fine.approximate).toBe(true);
    expect(fine.rings[0].points.length).toBeGreaterThan(coarse.rings[0].points.length);
    expect(profileArea(fine)).toBeCloseTo(Math.PI * 50 ** 2, 1);
  });

  it('meets the published area and inertia accuracy at the default curve tolerance', () => {
    const radius = 50;
    const circle = new fabric.Circle({ radius, strokeWidth: 0 });
    const properties = calculateSectionProperties(sectionProfileFromFabricObject(circle));
    const exactArea = Math.PI * radius ** 2;
    const exactInertia = Math.PI * radius ** 4 / 4;

    expect(Math.abs(properties.area - exactArea) / exactArea).toBeLessThanOrEqual(1e-5);
    expect(Math.abs(properties.ix - exactInertia) / exactInertia).toBeLessThanOrEqual(5e-5);
    expect(Math.abs(properties.iy - exactInertia) / exactInertia).toBeLessThanOrEqual(5e-5);
  });

  it('includes rounded rectangle radii in the converted boundary', () => {
    const rounded = new fabric.Rect({
      width: 100,
      height: 60,
      rx: 10,
      ry: 10,
      strokeWidth: 0,
    });

    const profile = sectionProfileFromFabricObject(rounded, 0.0005);
    const expectedArea = 100 * 60 - (4 - Math.PI) * 10 ** 2;

    expect(profile.approximate).toBe(true);
    expect(profile.rings[0].points.length).toBeGreaterThan(8);
    expect(profileArea(profile)).toBeCloseTo(expectedArea, 2);
  });

  it('reuses local section metadata and applies later Fabric transforms', () => {
    const original = {
      version: 1 as const,
      rings: [{
        role: 'outer' as const,
        points: [
          { x: 20, y: -50 },
          { x: 60, y: -50 },
          { x: 60, y: -20 },
          { x: 20, y: -20 },
        ],
      }],
      analysisToleranceMm: 0.01,
      approximate: false,
    };
    const path = createSectionPath(original, { strokeWidth: 0 });
    path.set({ left: 100, top: 200, angle: 90, scaleX: 2, scaleY: 3 });

    const read = readSectionProfileInDocumentCoordinates(path);
    const viaGeneralConverter = sectionProfileFromFabricObject(path);

    expect(profileArea(read)).toBeCloseTo(40 * 30 * 6, 8);
    expect(viaGeneralConverter.rings).toEqual(read.rings);
    expect(read.analysisToleranceMm).toBeCloseTo(0.03, 12);
    expect(viaGeneralConverter.analysisToleranceMm).toBeCloseTo(0.03, 12);
  });

  it('preserves point identity for reflected snap rings while analysis stays canonical', () => {
    const path = createSectionPath({
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
    }, { strokeWidth: 0 });
    path.set({ flipX: true });

    const orderedRings = readSectionProfileRingsInDocumentCoordinates(path);
    const analysisProfile = readSectionProfileInDocumentCoordinates(path);

    expect(signedSectionRingArea(orderedRings[0].points)).toBeLessThan(0);
    expect(signedSectionRingArea(analysisProfile.rings[0].points)).toBeGreaterThan(0);
    expect(analysisProfile.rings[0].points).toEqual([...orderedRings[0].points].reverse());
  });

  it.each([
    ['open polyline', new fabric.Polyline([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }])],
    ['line', new fabric.Line([0, 0, 20, 20])],
    ['open path', new fabric.Path('M 0 0 L 10 0 L 0 10')],
  ])('rejects unsupported %s geometry', (_label, object) => {
    expect(() => sectionProfileFromFabricObject(object)).toThrowError(SectionGeometryError);
    try {
      sectionProfileFromFabricObject(object);
    } catch (error) {
      expect((error as SectionGeometryError).code).toBe('unsupported-object');
    }
  });

  it('converts a closed path into a section profile', () => {
    const path = new fabric.Path('M 0 0 L 10 0 L 0 10 Z', { strokeWidth: 0 });
    const profile = sectionProfileFromFabricObject(path);
    expect(profile.rings).toHaveLength(1);
    expect(profile.rings[0].role).toBe('outer');
    expect(Math.abs(signedSectionRingArea(profile.rings[0].points))).toBeCloseTo(50, 9);
  });

  it('converts a Fabric triangle into a section profile', () => {
    const triangle = new fabric.Triangle({
      left: 10,
      top: 20,
      width: 40,
      height: 30,
      strokeWidth: 0,
    });
    const profile = sectionProfileFromFabricObject(triangle);
    expect(profile.approximate).toBe(false);
    expect(profile.rings).toHaveLength(1);
    expect(profileArea(profile)).toBeCloseTo(600, 8);
  });

  // Same subpaths, opposite fill rules: nested same-direction rings.
  const NESTED_SAME_DIRECTION = 'M 0 0 L 100 0 L 100 100 L 0 100 Z M 20 20 L 80 20 L 80 80 L 20 80 Z';

  it('keeps nested same-direction subpaths filled under the nonzero fill rule', () => {
    // Fabric's default fillRule is 'nonzero': the inner ring winds the same
    // way as the outer one, so the whole square renders filled.
    const path = new fabric.Path(NESTED_SAME_DIRECTION, { strokeWidth: 0 });
    const profile = sectionProfileFromFabricObject(path);
    expect(profile.rings.every((ring) => ring.role === 'outer')).toBe(true);
    expect(profileArea(profile)).toBeCloseTo(10_000, 6);
  });

  it('carves a hole from nested same-direction subpaths under the evenodd fill rule', () => {
    const path = new fabric.Path(NESTED_SAME_DIRECTION, { strokeWidth: 0, fillRule: 'evenodd' });
    const profile = sectionProfileFromFabricObject(path);
    expect(profile.rings.map((ring) => ring.role).sort()).toEqual(['hole', 'outer']);
    expect(profileArea(profile)).toBeCloseTo(10_000 - 3_600, 6);
  });

  it('carves a hole from an opposite-direction subpath under the nonzero fill rule', () => {
    const path = new fabric.Path(
      'M 0 0 L 100 0 L 100 100 L 0 100 Z M 20 80 L 80 80 L 80 20 L 20 20 Z',
      { strokeWidth: 0 },
    );
    const profile = sectionProfileFromFabricObject(path);
    expect(profile.rings.map((ring) => ring.role).sort()).toEqual(['hole', 'outer']);
    expect(profileArea(profile)).toBeCloseTo(10_000 - 3_600, 6);
  });

  it('flattens inflected Bézier segments instead of collapsing them to the chord', () => {
    // At t = 0.5 this S-curve passes exactly through the chord midpoint, so a
    // midpoint-only subdivision test would never split it and the two lobes
    // would collapse into a zero-area line.
    const start = { x: 0, y: 0 };
    const control1 = { x: 0, y: 100 };
    const control2 = { x: 10, y: -100 };
    const end = { x: 10, y: 0 };
    const path = new fabric.Path('M 0 0 C 0 100 10 -100 10 0 Z', { strokeWidth: 0 });

    const profile = sectionProfileFromFabricObject(path);

    // Reference: densely sample one lobe (t in [0, 0.5] plus the chord back
    // to the start) and double it — the lobes are point-symmetric.
    const samples: { x: number; y: number }[] = [];
    for (let index = 0; index <= 2_000; index += 1) {
      samples.push(cubicPointAt(start, control1, control2, end, index / 4_000));
    }
    let doubled = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const a = samples[index];
      const b = samples[(index + 1) % samples.length];
      doubled += a.x * b.y - b.x * a.y;
    }
    const referenceArea = Math.abs(doubled);

    const area = profile.rings.reduce(
      (sum, ring) => sum + Math.abs(signedSectionRingArea(ring.points)),
      0,
    );
    expect(area).toBeGreaterThan(1);
    expect(area).toBeCloseTo(referenceArea, 1);
  });

  it('rejects self-intersecting polygons before analysis', () => {
    const selfIntersecting = new fabric.Polygon([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 5, y: 30 },
      { x: 35, y: 30 },
      { x: 20, y: -10 },
    ]);

    expect(() => sectionProfileFromFabricObject(selfIntersecting)).toThrowError(SectionGeometryError);
  });

  it('keeps a small rectangle valid near the CAD coordinate limit', () => {
    const offset = 1_000_000_000;
    const rectangle = new fabric.Rect({
      left: offset,
      top: offset,
      width: 100,
      height: 50,
      strokeWidth: 0,
    });

    const profile = sectionProfileFromFabricObject(rectangle);

    expect(profile.rings[0].points).toHaveLength(4);
    expect(profileArea(profile)).toBeCloseTo(5_000, 8);
    expect(bounds(profile.rings[0].points)).toEqual({
      minX: offset - 50,
      maxX: offset + 50,
      minY: -offset - 25,
      maxY: -offset + 25,
    });
  });

  it('still identifies self-intersection near the CAD coordinate limit', () => {
    const offset = 1_000_000_000;
    const selfIntersecting = new fabric.Polygon([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 5, y: 30 },
      { x: 35, y: 30 },
      { x: 20, y: -10 },
    ], {
      left: offset,
      top: offset,
      strokeWidth: 0,
    });

    expect(() => sectionProfileFromFabricObject(selfIntersecting)).toThrowError(
      expect.objectContaining({ code: 'self-intersection' }),
    );
  });

  it('rejects singular transforms and empty selections', () => {
    const flattened = new fabric.Rect({ width: 20, height: 10, scaleX: 1e-20 });

    expect(() => sectionProfileFromFabricObject(flattened)).toThrowError(
      expect.objectContaining({ code: 'singular-transform' }),
    );
    expect(() => fabricObjectsToSectionProfile([])).toThrowError(
      expect.objectContaining({ code: 'empty-selection' }),
    );
  });
});
