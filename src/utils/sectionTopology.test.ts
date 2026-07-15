import { describe, expect, it } from 'vitest';
import type { SectionProfileData, SectionRing, SectionRingRole } from '../domain/section';
import {
  assertValidSectionProfileTopology,
  SectionTopologyError,
} from './sectionTopology';

function rectangle(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  role: SectionRingRole = 'outer',
): SectionRing {
  return {
    role,
    points: [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ],
  };
}

function profile(rings: SectionRing[]): SectionProfileData {
  return {
    version: 1,
    rings,
    analysisToleranceMm: 0.01,
    approximate: false,
  };
}

describe('section topology validation', () => {
  it('accepts valid holes, disconnected material, and zero-area outer contact', () => {
    expect(() => assertValidSectionProfileTopology(profile([
      rectangle(0, 0, 20, 20),
      rectangle(5, 5, 10, 10, 'hole'),
      rectangle(20, 20, 30, 30),
    ]))).not.toThrow();
  });

  it('rejects a self-intersecting ring with nonzero signed area', () => {
    const selfIntersecting: SectionRing = {
      role: 'outer',
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 5, y: 30 },
        { x: 35, y: 30 },
        { x: 20, y: -10 },
      ],
    };

    expect(() => assertValidSectionProfileTopology(profile([selfIntersecting])))
      .toThrowError(SectionTopologyError);
  });

  it('rejects holes outside or crossing an outer boundary', () => {
    expect(() => assertValidSectionProfileTopology(profile([
      rectangle(0, 0, 10, 10),
      rectangle(20, 20, 25, 25, 'hole'),
    ]))).toThrow(/contained/);

    expect(() => assertValidSectionProfileTopology(profile([
      rectangle(0, 0, 10, 10),
      rectangle(8, 2, 12, 8, 'hole'),
    ]))).toThrow(/cross or touch/);
  });

  it('rejects overlapping holes and overlapping material outers', () => {
    expect(() => assertValidSectionProfileTopology(profile([
      rectangle(0, 0, 20, 20),
      rectangle(2, 2, 10, 10, 'hole'),
      rectangle(8, 2, 16, 10, 'hole'),
    ]))).toThrow(/overlap/);

    expect(() => assertValidSectionProfileTopology(profile([
      rectangle(0, 0, 10, 10),
      rectangle(5, 0, 15, 10),
    ]))).toThrow(/overlap/);
  });
});
