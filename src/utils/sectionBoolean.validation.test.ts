import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SectionProfileData } from '../domain/section';

const clippingSpies = vi.hoisted(() => ({
  difference: vi.fn(),
}));

vi.mock('polygon-clipping', async (importOriginal) => {
  const actual = await importOriginal<typeof import('polygon-clipping')>();
  const implementation = (actual as unknown as { default: typeof actual }).default;
  return {
    ...actual,
    default: {
      ...implementation,
      difference: clippingSpies.difference,
    },
  };
});

import { differenceSectionProfiles, SectionBooleanError } from './sectionBoolean';

function rectangle(minX: number, minY: number, maxX: number, maxY: number): SectionProfileData {
  return {
    version: 1,
    rings: [{
      role: 'outer',
      points: [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
      ],
    }],
    analysisToleranceMm: 0.01,
    approximate: false,
  };
}

function resultRectangle(width: number) {
  return [[[
    [0, 0], [width, 0], [width, 10], [0, 10], [0, 0],
  ]]];
}

describe('section Boolean validation', () => {
  beforeEach(() => {
    clippingSpies.difference.mockReset();
  });

  it('reports a non-physical difference area increase separately from no intersection', () => {
    clippingSpies.difference.mockReturnValue(resultRectangle(20));

    expect(() => differenceSectionProfiles(
      rectangle(0, 0, 10, 10),
      rectangle(2, 2, 8, 8),
    )).toThrowError(expect.objectContaining<Partial<SectionBooleanError>>({
      code: 'numerical-instability',
    }));
  });

  it('treats an area increase within floating-point tolerance as no intersection', () => {
    clippingSpies.difference.mockReturnValue(resultRectangle(10.0000000000002));

    expect(() => differenceSectionProfiles(
      rectangle(0, 0, 10, 10),
      rectangle(2, 2, 8, 8),
    )).toThrowError(expect.objectContaining<Partial<SectionBooleanError>>({
      code: 'no-intersection',
    }));
  });
});
