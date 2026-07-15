import { describe, expect, it, vi } from 'vitest';
import type { SectionProfileData } from '../domain/section';

vi.mock('polygon-clipping', async (importOriginal) => {
  const actual = await importOriginal<typeof import('polygon-clipping')>();
  const implementation = (actual as unknown as { default: typeof actual }).default;
  return {
    ...actual,
    default: {
      ...implementation,
      difference: vi.fn(() => [[[
        [0, 0], [20, 0], [20, 10], [0, 10], [0, 0],
      ]]]),
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

describe('section Boolean validation', () => {
  it('reports a non-physical difference area increase separately from no intersection', () => {
    expect(() => differenceSectionProfiles(
      rectangle(0, 0, 10, 10),
      rectangle(2, 2, 8, 8),
    )).toThrowError(expect.objectContaining<Partial<SectionBooleanError>>({
      code: 'numerical-instability',
    }));
  });
});
