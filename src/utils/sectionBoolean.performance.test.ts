import { describe, expect, it } from 'vitest';
import type { SectionProfileData } from '../domain/section';
import { signedSectionRingArea } from '../domain/section';
import { unionSectionProfiles } from './sectionBoolean';

function regularPolygon(
  pointCount: number,
  centerX: number,
  centerY: number,
  radius: number,
): SectionProfileData {
  return {
    version: 1,
    analysisToleranceMm: 0.01,
    approximate: false,
    rings: [{
      role: 'outer',
      points: Array.from({ length: pointCount }, (_, index) => {
        const angle = index * Math.PI * 2 / pointCount;
        return {
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        };
      }),
    }],
  };
}

describe('section Boolean performance', () => {
  it('unions 10,000 input boundary points within the spike budget', () => {
    const profiles = [
      regularPolygon(5_000, -250, 0, 1_000),
      regularPolygon(5_000, 250, 0, 1_000),
    ];

    const startedAt = performance.now();
    const result = unionSectionProfiles(profiles);
    const elapsedMs = performance.now() - startedAt;
    const area = result.rings.reduce(
      (total, ring) => total + signedSectionRingArea(ring.points),
      0,
    );

    expect(result.rings.some((ring) => ring.role === 'outer')).toBe(true);
    expect(area).toBeGreaterThan(Math.PI * 1_000 ** 2);
    expect(area).toBeLessThan(2 * Math.PI * 1_000 ** 2);
    expect(elapsedMs).toBeLessThan(5_000);
  });
});
