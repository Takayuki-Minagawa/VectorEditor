import { describe, expect, it } from 'vitest';
import type { SectionProfileData } from '../domain/section';
import { calculateSectionProperties } from './sectionProperties';

describe('section analysis performance envelope', () => {
  it('analyses a 10,000-vertex boundary within the worker job budget', () => {
    const radius = 1_000;
    const vertexCount = 10_000;
    const profile: SectionProfileData = {
      version: 1,
      analysisToleranceMm: 0.001,
      approximate: true,
      rings: [{
        role: 'outer',
        points: Array.from({ length: vertexCount }, (_, index) => {
          const angle = index * Math.PI * 2 / vertexCount;
          return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
        }),
      }],
    };

    const startedAt = performance.now();
    const properties = calculateSectionProperties(profile);
    const elapsedMs = performance.now() - startedAt;

    expect(properties.area).toBeCloseTo(Math.PI * radius ** 2, -1);
    // This is deliberately generous for shared CI runners. UI execution uses
    // a Worker above the large-profile threshold, so this guards against an
    // accidental superlinear regression rather than setting a frame budget.
    expect(elapsedMs).toBeLessThan(2_000);
  });
});
