import { describe, expect, it, vi } from 'vitest';
import type { SectionProfileData } from '../domain/section';

const validationSpies = vi.hoisted(() => ({
  normalizeCalls: 0,
  topologyUnionCalls: 0,
}));

vi.mock('../domain/section', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/section')>();
  return {
    ...actual,
    normalizeSectionProfileData(value: SectionProfileData) {
      validationSpies.normalizeCalls += 1;
      return actual.normalizeSectionProfileData(value);
    },
  };
});

vi.mock('polygon-clipping', async (importOriginal) => {
  const actual = await importOriginal<typeof import('polygon-clipping')>();
  const implementation = actual;
  return {
    ...actual,
    default: {
      ...implementation,
      union(...args: Parameters<typeof implementation.union>) {
        validationSpies.topologyUnionCalls += 1;
        return implementation.union(...args);
      },
    },
  };
});

import { calculateSectionProperties } from './sectionProperties';

function rectangleProfile(): SectionProfileData {
  return {
    version: 1,
    analysisToleranceMm: 0.01,
    approximate: false,
    rings: [{
      role: 'outer',
      points: [
        // Clockwise and explicitly closed to exercise normalization.
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 20, y: 10 },
        { x: 20, y: 0 },
        { x: 0, y: 0 },
      ],
    }],
  };
}

describe('section property validation reuse', () => {
  it('normalizes once per calculation and caches topology by immutable content', () => {
    const first = rectangleProfile();
    expect(calculateSectionProperties(first).area).toBeCloseTo(200, 10);
    expect(validationSpies.normalizeCalls).toBe(1);
    expect(validationSpies.topologyUnionCalls).toBe(1);

    // A different object with identical content is a safe cache hit.
    expect(calculateSectionProperties(rectangleProfile()).area).toBeCloseTo(200, 10);
    expect(validationSpies.normalizeCalls).toBe(2);
    expect(validationSpies.topologyUnionCalls).toBe(1);

    // In-place mutation changes the full content key and must revalidate.
    first.rings[0].points[2].x = 25;
    expect(calculateSectionProperties(first).area).toBeCloseTo(225, 10);
    expect(validationSpies.normalizeCalls).toBe(3);
    expect(validationSpies.topologyUnionCalls).toBe(2);
  });
});
