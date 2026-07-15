import { describe, expect, it } from 'vitest';
import type { SectionPoint, SectionProfileData, SectionRing, SectionRingRole } from '../domain/section';
import { calculateSectionProperties } from './sectionProperties';

function profile(rings: SectionRing[], approximate = false): SectionProfileData {
  return {
    version: 1,
    rings,
    analysisToleranceMm: 0.001,
    approximate,
  };
}

function rectangle(
  x: number,
  y: number,
  width: number,
  height: number,
  role: SectionRingRole = 'outer',
): SectionRing {
  return {
    role,
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
  };
}

function circle(
  centerX: number,
  centerY: number,
  radius: number,
  role: SectionRingRole,
  segments = 4096,
): SectionRing {
  return {
    role,
    points: Array.from({ length: segments }, (_, index) => {
      const angle = index * 2 * Math.PI / segments;
      return {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      };
    }),
  };
}

function mapRing(ring: SectionRing, transform: (point: SectionPoint) => SectionPoint): SectionRing {
  return { role: ring.role, points: ring.points.map(transform) };
}

function expectRelative(actual: number, expected: number, relativeTolerance = 1e-10): void {
  const scale = Math.max(1, Math.abs(expected));
  expect(Math.abs(actual - expected) / scale).toBeLessThanOrEqual(relativeTolerance);
}

const tRing: SectionRing = {
  role: 'outer',
  points: [
    { x: 40, y: 0 },
    { x: 60, y: 0 },
    { x: 60, y: 80 },
    { x: 100, y: 80 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
    { x: 0, y: 80 },
    { x: 40, y: 80 },
  ],
};

const lRing: SectionRing = {
  role: 'outer',
  points: [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 20 },
    { x: 20, y: 20 },
    { x: 20, y: 60 },
    { x: 0, y: 60 },
  ],
};

describe('calculateSectionProperties', () => {
  it('matches the exact 200 x 100 mm rectangle fixture', () => {
    const result = calculateSectionProperties(profile([rectangle(0, 0, 200, 100)]));

    expect(result.area).toBeCloseTo(20_000, 10);
    expect(result.centroid).toEqual({ x: 100, y: 50 });
    expectRelative(result.ix, 200 * 100 ** 3 / 12);
    expectRelative(result.iy, 100 * 200 ** 3 / 12);
    expect(result.ixy).toBe(0);
    expect(result.principalMax).toBeCloseTo(result.iy, 8);
    expect(result.principalMin).toBeCloseTo(result.ix, 8);
    expect(result.principalAngleDeg).toBe(-90);
    expect(result.cTop).toBe(50);
    expect(result.cBottom).toBe(50);
    expect(result.cLeft).toBe(100);
    expect(result.cRight).toBe(100);
    expectRelative(result.zxTop, 333_333.3333333333);
    expectRelative(result.zxBottom, 333_333.3333333333);
    expectRelative(result.zyLeft, 666_666.6666666666);
    expectRelative(result.zyRight, 666_666.6666666666);
  });

  it('converges to the analytic circle and concentric annulus fixtures', () => {
    const radius = 50;
    const disk = calculateSectionProperties(profile([circle(0, 0, radius, 'outer')], true));
    expectRelative(disk.area, Math.PI * radius ** 2, 1e-6);
    expectRelative(disk.ix, Math.PI * radius ** 4 / 4, 2e-6);
    expectRelative(disk.iy, Math.PI * radius ** 4 / 4, 2e-6);

    const innerRadius = 30;
    const annulus = calculateSectionProperties(profile([
      circle(10, -15, radius, 'outer'),
      circle(10, -15, innerRadius, 'hole'),
    ], true));
    expectRelative(annulus.area, Math.PI * (radius ** 2 - innerRadius ** 2), 1e-6);
    expect(annulus.centroid.x).toBeCloseTo(10, 8);
    expect(annulus.centroid.y).toBeCloseTo(-15, 8);
    expectRelative(annulus.ix, Math.PI * (radius ** 4 - innerRadius ** 4) / 4, 2e-6);
    expectRelative(annulus.iy, Math.PI * (radius ** 4 - innerRadius ** 4) / 4, 2e-6);
  });

  it('matches independent rectangle-composition results for T and L sections', () => {
    const tee = calculateSectionProperties(profile([tRing]));
    expect(tee.area).toBeCloseTo(3_600, 10);
    expect(tee.centroid.x).toBeCloseTo(50, 10);
    expect(tee.centroid.y).toBeCloseTo(67.77777777777777, 10);
    expectRelative(tee.ix, 3_142_222.222222222);
    expectRelative(tee.iy, 1_720_000);
    expect(tee.ixy).toBe(0);

    const angle = calculateSectionProperties(profile([lRing]));
    expect(angle.area).toBeCloseTo(1_600, 10);
    expect(angle.centroid).toEqual({ x: 15, y: 25 });
    expectRelative(angle.ix, 493_333.3333333333);
    expectRelative(angle.iy, 173_333.33333333334);
    expectRelative(angle.ixy, -120_000);
  });

  it('subtracts an eccentric rectangular hole with the correct centroid and Ixy sign', () => {
    const result = calculateSectionProperties(profile([
      rectangle(0, 0, 100, 80),
      rectangle(60, 50, 20, 10, 'hole'),
    ]));

    expect(result.area).toBeCloseTo(7_800, 10);
    expect(result.centroid.x).toBeCloseTo(49.48717948717949, 10);
    expect(result.centroid.y).toBeCloseTo(39.61538461538461, 10);
    expectRelative(result.ixy, -61_538.46153846154);
    expect(result.cTop).toBeCloseTo(40.38461538461539, 10);
    expect(result.cRight).toBeCloseTo(50.51282051282051, 10);
  });

  it('is stable after a large translation', () => {
    const baseline = calculateSectionProperties(profile([lRing]));
    const dx = 1_000_000_000;
    const dy = -2_000_000_000;
    const translated = calculateSectionProperties(profile([
      mapRing(lRing, ({ x, y }) => ({ x: x + dx, y: y + dy })),
    ]));

    expect(translated.centroid.x).toBeCloseTo(baseline.centroid.x + dx, 6);
    expect(translated.centroid.y).toBeCloseTo(baseline.centroid.y + dy, 6);
    expectRelative(translated.area, baseline.area);
    expectRelative(translated.ix, baseline.ix);
    expectRelative(translated.iy, baseline.iy);
    expectRelative(translated.ixy, baseline.ixy);
  });

  it('accepts small disconnected regions separated by a large document distance', () => {
    const offset = 1_000_000_000;
    const result = calculateSectionProperties(profile([
      rectangle(0, 0, 1, 1),
      rectangle(offset, offset, 1, 1),
    ]));

    expect(result.area).toBeCloseTo(2, 10);
    expect(result.centroid.x).toBeCloseTo(offset / 2 + 0.5, 6);
    expect(result.centroid.y).toBeCloseTo(offset / 2 + 0.5, 6);
    expect(result.ix).toBeGreaterThan(0);
    expect(result.iy).toBeGreaterThan(0);
    expect(result.principalMin).toBeCloseTo(1 / 6, 10);
  });

  it('preserves principal properties under rotation and reports the principal axis', () => {
    const source = rectangle(-100, -50, 200, 100);
    const baseline = calculateSectionProperties(profile([source]));
    const radians = 30 * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const rotated = calculateSectionProperties(profile([
      mapRing(source, ({ x, y }) => ({
        x: cosine * x - sine * y,
        y: sine * x + cosine * y,
      })),
    ]));

    expectRelative(rotated.area, baseline.area);
    expectRelative(rotated.principalMax, baseline.principalMax);
    expectRelative(rotated.principalMin, baseline.principalMin);
    expect(rotated.principalAngleDeg).toBeCloseTo(-60, 10);
  });

  it('obeys uniform-scale and mirror invariants', () => {
    const baseline = calculateSectionProperties(profile([lRing]));
    const scale = 3.5;
    const scaled = calculateSectionProperties(profile([
      mapRing(lRing, ({ x, y }) => ({ x: x * scale, y: y * scale })),
    ]));
    expectRelative(scaled.area, baseline.area * scale ** 2);
    expectRelative(scaled.ix, baseline.ix * scale ** 4);
    expectRelative(scaled.iy, baseline.iy * scale ** 4);
    expectRelative(scaled.ixy, baseline.ixy * scale ** 4);
    expectRelative(scaled.cTop, baseline.cTop * scale);
    expectRelative(scaled.zxTop, baseline.zxTop * scale ** 3);

    const mirrored = calculateSectionProperties(profile([
      mapRing(lRing, ({ x, y }) => ({ x: -x, y })),
    ]));
    expectRelative(mirrored.ix, baseline.ix);
    expectRelative(mirrored.iy, baseline.iy);
    expectRelative(mirrored.ixy, -baseline.ixy);
    expect(mirrored.centroid.x).toBe(-baseline.centroid.x);
    expect(mirrored.centroid.y).toBe(baseline.centroid.y);
  });

  it('uses explicit ring roles rather than caller winding', () => {
    const forward = calculateSectionProperties(profile([
      rectangle(0, 0, 100, 80),
      rectangle(10, 10, 20, 20, 'hole'),
    ]));
    const reversed = calculateSectionProperties(profile([
      { ...rectangle(0, 0, 100, 80), points: rectangle(0, 0, 100, 80).points.reverse() },
      { ...rectangle(10, 10, 20, 20, 'hole'), points: rectangle(10, 10, 20, 20, 'hole').points.reverse() },
    ]));
    expect(reversed).toEqual(forward);
  });

  it('rejects profiles whose holes remove all material', () => {
    expect(() => calculateSectionProperties(profile([
      rectangle(0, 0, 10, 10),
      rectangle(0, 0, 10, 10, 'hole'),
    ]))).toThrow(/cross or touch|positive and nondegenerate/);
  });
});
