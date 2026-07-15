import { describe, expect, it } from 'vitest';
import { signedSectionRingArea, type SectionProfileData } from '../domain/section';
import {
  differenceSectionProfiles,
  SectionBooleanError,
  unionSectionProfiles,
} from './sectionBoolean';

function rectangle(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  approximate = false,
): SectionProfileData {
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
    approximate,
  };
}

function area(profile: SectionProfileData): number {
  return profile.rings.reduce(
    (sum, ring) => sum + signedSectionRingArea(ring.points),
    0,
  );
}

describe('section Boolean operations', () => {
  it('unions overlapping material without double-counting overlap', () => {
    const result = unionSectionProfiles([
      rectangle(0, 0, 100, 50),
      rectangle(50, 0, 150, 50),
    ]);

    expect(result.rings).toHaveLength(1);
    expect(result.rings[0].role).toBe('outer');
    expect(signedSectionRingArea(result.rings[0].points)).toBeGreaterThan(0);
    expect(area(result)).toBeCloseTo(7_500, 8);
  });

  it('retains disconnected regions as multiple outer rings', () => {
    const result = unionSectionProfiles(
      rectangle(0, 0, 10, 10),
      rectangle(20, 0, 30, 10, true),
    );

    expect(result.rings).toHaveLength(2);
    expect(result.rings.every((ring) => ring.role === 'outer')).toBe(true);
    expect(result.approximate).toBe(true);
    expect(area(result)).toBeCloseTo(200, 10);
  });

  it('normalizes overlaps already present inside a single converted profile', () => {
    const first = rectangle(0, 0, 100, 50);
    const second = rectangle(50, 0, 150, 50);
    const groupedProfile: SectionProfileData = {
      ...first,
      rings: [...first.rings, ...second.rings],
    };

    const result = unionSectionProfiles([groupedProfile]);

    expect(result.rings).toHaveLength(1);
    expect(area(result)).toBeCloseTo(7_500, 8);
  });

  it('represents a fully enclosed difference as a clockwise hole', () => {
    const result = differenceSectionProfiles(
      rectangle(0, 0, 100, 80),
      rectangle(20, 10, 60, 50),
    );

    expect(result.rings).toHaveLength(2);
    expect(result.rings.map((ring) => ring.role)).toEqual(['outer', 'hole']);
    expect(signedSectionRingArea(result.rings[0].points)).toBeGreaterThan(0);
    expect(signedSectionRingArea(result.rings[1].points)).toBeLessThan(0);
    expect(area(result)).toBeCloseTo(6_400, 8);
  });

  it('creates a notch rather than a hole when the cutter crosses an edge', () => {
    const result = differenceSectionProfiles(
      rectangle(0, 0, 100, 80),
      [rectangle(80, 20, 120, 60)],
    );

    expect(result.rings).toHaveLength(1);
    expect(result.rings[0].role).toBe('outer');
    expect(area(result)).toBeCloseTo(7_200, 8);
  });

  it('rejects a disjoint cutter so callers can avoid a no-op history entry', () => {
    expect(() => differenceSectionProfiles(
      rectangle(0, 0, 10, 10),
      rectangle(20, 20, 30, 30),
    )).toThrowError(expect.objectContaining<Partial<SectionBooleanError>>({
      code: 'no-intersection',
    }));
  });

  it('treats point/edge contact as no area overlap but retains a small real cut', () => {
    expect(() => differenceSectionProfiles(
      rectangle(0, 0, 10, 10),
      rectangle(10, 2, 12, 8),
    )).toThrowError(expect.objectContaining<Partial<SectionBooleanError>>({
      code: 'no-intersection',
    }));

    const result = differenceSectionProfiles(
      rectangle(0, 0, 10, 10),
      rectangle(9.999999, 2, 12, 8),
    );
    expect(area(result)).toBeCloseTo(100 - 0.000001 * 6, 9);
  });

  it('detects cutters located entirely in an existing void as no overlap', () => {
    const subject = rectangle(0, 0, 20, 20);
    subject.rings.push({
      role: 'hole',
      points: rectangle(5, 5, 15, 15).rings[0].points.slice().reverse(),
    });
    expect(() => differenceSectionProfiles(subject, rectangle(7, 7, 13, 13)))
      .toThrowError(expect.objectContaining<Partial<SectionBooleanError>>({
        code: 'no-intersection',
      }));
  });

  it('reports an empty result when all section material is removed', () => {
    expect(() => differenceSectionProfiles(
      rectangle(0, 0, 10, 10),
      rectangle(-1, -1, 11, 11),
    )).toThrowError(expect.objectContaining<Partial<SectionBooleanError>>({
      code: 'empty-result',
    }));
  });

  it('recentres large document coordinates during clipping', () => {
    const offset = 1_000_000_000_000;
    const result = unionSectionProfiles([
      rectangle(offset, offset, offset + 100, offset + 100),
      rectangle(offset + 50, offset, offset + 150, offset + 100),
    ]);

    expect(area(result)).toBeCloseTo(15_000, 6);
    expect(Math.min(...result.rings[0].points.map((point) => point.x))).toBe(offset);
  });

  it('assigns a small hole correctly near the CAD coordinate limit', () => {
    const offset = 1_000_000_000;
    const outer = rectangle(offset, offset, offset + 100, offset + 100);
    const profile: SectionProfileData = {
      ...outer,
      rings: [
        ...outer.rings,
        {
          role: 'hole',
          points: [
            { x: offset + 25, y: offset + 25 },
            { x: offset + 25, y: offset + 75 },
            { x: offset + 75, y: offset + 75 },
            { x: offset + 75, y: offset + 25 },
          ],
        },
      ],
    };

    const result = unionSectionProfiles([profile]);

    expect(result.rings.map((ring) => ring.role)).toEqual(['outer', 'hole']);
    expect(area(result)).toBeCloseTo(7_500, 8);
  });

  it('does not mistake a nearby external hole for a boundary point at large coordinates', () => {
    const offset = 1_000_000_000;
    const outer = rectangle(offset, offset, offset + 100, offset + 100);
    const invalid: SectionProfileData = {
      ...outer,
      rings: [
        ...outer.rings,
        {
          role: 'hole',
          points: [
            { x: offset + 110, y: offset + 20 },
            { x: offset + 110, y: offset + 40 },
            { x: offset + 130, y: offset + 40 },
            { x: offset + 130, y: offset + 20 },
          ],
        },
      ],
    };

    expect(() => unionSectionProfiles([invalid])).toThrowError(
      expect.objectContaining<Partial<SectionBooleanError>>({ code: 'invalid-input' }),
    );
  });

  it('rejects holes that are not inside any outer boundary', () => {
    const invalid: SectionProfileData = {
      ...rectangle(0, 0, 10, 10),
      rings: [
        ...rectangle(0, 0, 10, 10).rings,
        {
          role: 'hole',
          points: [
            { x: 20, y: 20 },
            { x: 20, y: 25 },
            { x: 25, y: 25 },
            { x: 25, y: 20 },
          ],
        },
      ],
    };

    expect(() => unionSectionProfiles([invalid])).toThrowError(
      expect.objectContaining<Partial<SectionBooleanError>>({ code: 'invalid-input' }),
    );
  });
});
