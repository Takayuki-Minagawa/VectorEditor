import { describe, expect, it } from 'vitest';
import {
  CompensatedSum,
  SectionValidationError,
  assertValidSectionProfileData,
  normalizeSectionProfileData,
  sectionBoundsCentre,
  sectionProfileBounds,
  signedSectionRingArea,
  validateSectionProfileData,
  type SectionProfileData,
} from './section';

const validProfile: SectionProfileData = {
  version: 1,
  rings: [{
    role: 'outer',
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ],
  }],
  analysisToleranceMm: 0.01,
  approximate: false,
};

describe('section domain validation', () => {
  it('accepts a finite nondegenerate profile', () => {
    expect(validateSectionProfileData(validProfile)).toEqual({ valid: true, issues: [] });
    expect(() => assertValidSectionProfileData(validProfile)).not.toThrow();
  });

  it('rejects non-finite, underspecified, and degenerate rings', () => {
    const invalid = {
      version: 1,
      rings: [
        { role: 'outer', points: [{ x: 0, y: 0 }, { x: Number.NaN, y: 1 }, { x: 1, y: 0 }] },
        { role: 'hole', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
        { role: 'outer', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }] },
      ],
      analysisToleranceMm: 0,
      approximate: 'false',
    };

    const result = validateSectionProfileData(invalid);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'invalid-tolerance',
      'invalid-approximate-flag',
      'non-finite-point',
      'too-few-points',
      'degenerate-ring',
    ]));
    expect(() => assertValidSectionProfileData(invalid)).toThrow(SectionValidationError);
  });

  it('requires an explicitly identified material outer ring', () => {
    const result = validateSectionProfileData({
      ...validProfile,
      rings: [{ role: 'hole', points: validProfile.rings[0].points }],
    });
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'missing-outer-ring' }));
  });

  it('canonicalises explicit closure, adjacent duplicates, and winding without mutating input', () => {
    const profile: SectionProfileData = {
      ...validProfile,
      rings: [
        {
          role: 'outer',
          // Clockwise, explicitly closed, with an adjacent duplicate.
          points: [
            { x: 0, y: 0 },
            { x: 0, y: 5 },
            { x: 10, y: 5 },
            { x: 10, y: 5 },
            { x: 10, y: 0 },
            { x: 0, y: 0 },
          ],
        },
        {
          role: 'hole',
          // Counter-clockwise; a hole is canonicalised clockwise.
          points: [
            { x: 2, y: 1 },
            { x: 4, y: 1 },
            { x: 4, y: 3 },
            { x: 2, y: 3 },
          ],
        },
      ],
    };

    const normalized = normalizeSectionProfileData(profile);
    expect(normalized.rings[0].points).toHaveLength(4);
    expect(signedSectionRingArea(normalized.rings[0].points)).toBeGreaterThan(0);
    expect(signedSectionRingArea(normalized.rings[1].points)).toBeLessThan(0);
    expect(profile.rings[0].points).toHaveLength(6);
  });

  it('retains small valid dimensions at large document offsets', () => {
    const offset = 1_000_000_000;
    const profile: SectionProfileData = {
      ...validProfile,
      rings: [{
        role: 'outer',
        points: [
          { x: offset, y: offset },
          { x: offset + 1, y: offset },
          { x: offset + 1, y: offset + 0.25 },
          { x: offset, y: offset + 0.25 },
        ],
      }],
    };
    expect(validateSectionProfileData(profile).valid).toBe(true);
  });

  it('computes shared single/multi-profile bounds with an outer-role filter', () => {
    const hole = {
      role: 'hole' as const,
      points: [
        { x: -100, y: -100 },
        { x: -90, y: -100 },
        { x: -90, y: -90 },
      ],
    };
    const second: SectionProfileData = {
      ...validProfile,
      rings: [{
        role: 'outer',
        points: [
          { x: 20, y: 10 },
          { x: 30, y: 10 },
          { x: 30, y: 15 },
        ],
      }],
    };

    expect(sectionProfileBounds({ ...validProfile, rings: [...validProfile.rings, hole] }, 'outer'))
      .toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 5 });
    const combined = sectionProfileBounds([validProfile, second]);
    expect(combined).toEqual({ minX: 0, minY: 0, maxX: 30, maxY: 15 });
    expect(sectionBoundsCentre(combined)).toEqual({ x: 15, y: 7.5 });
  });

  it('exposes compensated summation for shared area and inertia aggregation', () => {
    const sum = new CompensatedSum();
    sum.add(1e16);
    sum.add(1);
    sum.add(-1e16);
    expect(sum.value()).toBe(1);
  });
});
