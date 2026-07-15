import { describe, expect, it } from 'vitest';
import type { SectionProfileData } from '../domain/section';
import { calculateSectionProperties } from './sectionProperties';
import {
  filletSectionProfileConvexCorners,
  getMaximumSectionFilletRadius,
  listSectionProfileConvexCorners,
  SectionFilletError,
} from './sectionFillet';

function rectangle(width: number, height: number): SectionProfileData {
  return {
    version: 1,
    analysisToleranceMm: 0.001,
    approximate: false,
    rings: [{
      role: 'outer',
      points: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }],
    }],
  };
}

describe('filletSectionProfileConvexCorners', () => {
  it('lists convex corners with stable references and individual radius limits', () => {
    const profile = rectangle(100, 50);
    const corners = listSectionProfileConvexCorners(profile);

    expect(corners.map(({ ringIndex, vertexIndex }) => ({ ringIndex, vertexIndex }))).toEqual([
      { ringIndex: 0, vertexIndex: 0 },
      { ringIndex: 0, vertexIndex: 1 },
      { ringIndex: 0, vertexIndex: 2 },
      { ringIndex: 0, vertexIndex: 3 },
    ]);
    corners.forEach((corner) => {
      expect(corner.interiorAngleRad).toBeCloseTo(Math.PI / 2, 12);
      expect(corner.maxRadiusMm).toBeCloseTo(49.999, 10);
    });
    expect(getMaximumSectionFilletRadius(profile)).toBeCloseTo(24.9995, 10);
    expect(getMaximumSectionFilletRadius(profile, [{ ringIndex: 0, vertexIndex: 0 }]))
      .toBeCloseTo(49.999, 10);
  });

  it('omits concave vertices and every hole vertex from the selectable corner list', () => {
    const profile: SectionProfileData = {
      version: 1,
      analysisToleranceMm: 0.001,
      approximate: false,
      rings: [{
        role: 'outer',
        points: [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
          { x: 40, y: 10 },
          { x: 10, y: 10 },
          { x: 10, y: 40 },
          { x: 0, y: 40 },
        ],
      }, {
        role: 'hole',
        points: [{ x: 2, y: 2 }, { x: 2, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 2 }],
      }],
    };

    expect(listSectionProfileConvexCorners(profile).map((corner) => [
      corner.ringIndex,
      corner.vertexIndex,
    ])).toEqual([[0, 0], [0, 1], [0, 2], [0, 4], [0, 5]]);
  });

  it('applies a radius to every convex rectangle corner', () => {
    const rounded = filletSectionProfileConvexCorners(rectangle(100, 50), 5);
    const properties = calculateSectionProperties(rounded);

    expect(rounded.approximate).toBe(true);
    expect(rounded.rings[0].points.length).toBeGreaterThan(8);
    const exactArea = 100 * 50 - (4 - Math.PI) * 25;
    expect(Math.abs(properties.area - exactArea) / exactArea).toBeLessThan(1e-5);
    expect(properties.centroid.x).toBeCloseTo(50, 6);
    expect(properties.centroid.y).toBeCloseTo(25, 6);
  });

  it('applies a radius only to explicitly selected convex corners', () => {
    const rounded = filletSectionProfileConvexCorners(
      rectangle(100, 50),
      5,
      [{ ringIndex: 0, vertexIndex: 0 }],
    );
    const properties = calculateSectionProperties(rounded);
    const exactArea = 100 * 50 - (1 - Math.PI / 4) * 25;

    expect(Math.abs(properties.area - exactArea) / exactArea).toBeLessThan(1e-5);
    expect(rounded.rings[0].points).not.toContainEqual({ x: 0, y: 0 });
    expect(rounded.rings[0].points).toContainEqual({ x: 100, y: 0 });
    expect(rounded.rings[0].points).toContainEqual({ x: 100, y: 50 });
    expect(rounded.rings[0].points).toContainEqual({ x: 0, y: 50 });
  });

  it('preserves holes while rounding material outer corners', () => {
    const profile = rectangle(100, 100);
    profile.rings.push({
      role: 'hole',
      points: [{ x: 40, y: 40 }, { x: 40, y: 60 }, { x: 60, y: 60 }, { x: 60, y: 40 }],
    });
    const originalHole = structuredClone(profile.rings[1].points);
    const rounded = filletSectionProfileConvexCorners(
      profile,
      5,
      [{ ringIndex: 0, vertexIndex: 2 }],
    );

    expect(rounded.rings.find((ring) => ring.role === 'hole')?.points).toEqual(originalHole);
  });

  it('rejects radii that overlap along an edge', () => {
    expect(() => filletSectionProfileConvexCorners(rectangle(10, 10), 5))
      .toThrow(SectionFilletError);

    expect(() => filletSectionProfileConvexCorners(
      rectangle(10, 10),
      5,
      [
        { ringIndex: 0, vertexIndex: 0 },
        { ringIndex: 0, vertexIndex: 1 },
      ],
    )).toThrow(/maximum.*adjacent edges/);

    expect(() => filletSectionProfileConvexCorners(
      rectangle(10, 10),
      5,
      [{ ringIndex: 0, vertexIndex: 0 }],
    )).not.toThrow();
  });

  it('rejects an empty, out-of-range, or hole-corner selection', () => {
    const profile = rectangle(100, 100);
    profile.rings.push({
      role: 'hole',
      points: [{ x: 40, y: 40 }, { x: 40, y: 60 }, { x: 60, y: 60 }, { x: 60, y: 40 }],
    });

    expect(() => filletSectionProfileConvexCorners(profile, 5, []))
      .toThrow(/No eligible/);
    expect(() => filletSectionProfileConvexCorners(
      profile,
      5,
      [{ ringIndex: 0, vertexIndex: 99 }],
    )).toThrow(/not an eligible/);
    expect(() => filletSectionProfileConvexCorners(
      profile,
      5,
      [{ ringIndex: 1, vertexIndex: 0 }],
    )).toThrow(/not an eligible/);
  });

  it('rejects a selected fillet that invalidates hole containment', () => {
    const profile = rectangle(100, 100);
    profile.rings.push({
      role: 'hole',
      points: [{ x: 1, y: 1 }, { x: 1, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 1 }],
    });

    expect(() => filletSectionProfileConvexCorners(
      profile,
      10,
      [{ ringIndex: 0, vertexIndex: 0 }],
    )).toThrow(/invalid section topology/);
  });

  it('rejects approximate curves consistently from list, maximum, and apply entry points', () => {
    const approximateProfile = { ...rectangle(100, 50), approximate: true };
    const calls = [
      () => listSectionProfileConvexCorners(approximateProfile),
      () => getMaximumSectionFilletRadius(approximateProfile),
      () => filletSectionProfileConvexCorners(approximateProfile, 5),
    ];

    calls.forEach((call) => {
      expect(call).toThrow(SectionFilletError);
      expect(call).toThrow(
        'Convex line-line fillets require an exact straight-boundary section. Curves, existing fillets, and curve-derived Boolean results are not supported.',
      );
    });
  });

  it('does not allow a second fillet after the first fillet polygonizes an arc', () => {
    const rounded = filletSectionProfileConvexCorners(
      rectangle(100, 50),
      5,
      [{ ringIndex: 0, vertexIndex: 0 }],
    );

    expect(() => listSectionProfileConvexCorners(rounded)).toThrow(/existing fillets/);
    expect(() => getMaximumSectionFilletRadius(rounded)).toThrow(/existing fillets/);
    expect(() => filletSectionProfileConvexCorners(
      rounded,
      5,
      [{ ringIndex: 0, vertexIndex: 1 }],
    )).toThrow(/existing fillets/);
  });
});
