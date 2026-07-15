import { describe, expect, it } from 'vitest';
import {
  locatePointInRing,
  pointInRing,
  pointOnSegment,
  pointsCoincide,
  segmentsIntersect,
} from './sectionGeometryPredicates';

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('section geometry predicates', () => {
  it('classifies ring interior, exterior, and boundary explicitly', () => {
    expect(locatePointInRing({ x: 5, y: 5 }, square)).toBe('inside');
    expect(locatePointInRing({ x: 15, y: 5 }, square)).toBe('outside');
    expect(locatePointInRing({ x: 10, y: 5 }, square)).toBe('boundary');
    expect(pointInRing({ x: 10, y: 5 }, square, 'include')).toBe(true);
    expect(pointInRing({ x: 10, y: 5 }, square, 'exclude')).toBe(false);
  });

  it('distinguishes nearby points from boundary points at a large CAD origin', () => {
    const offset = 1_000_000_000;
    const largeSquare = square.map(({ x, y }) => ({ x: x + offset, y: y + offset }));
    expect(locatePointInRing({ x: offset + 5, y: offset + 5 }, largeSquare)).toBe('inside');
    expect(locatePointInRing({ x: offset + 10.01, y: offset + 5 }, largeSquare)).toBe('outside');
    expect(pointOnSegment(
      { x: offset + 10, y: offset + 5 },
      largeSquare[1],
      largeSquare[2],
    )).toBe(true);
  });

  it('treats crossings, endpoint contact, and overlap as segment intersections', () => {
    expect(segmentsIntersect(
      { x: 0, y: 0 }, { x: 10, y: 10 },
      { x: 0, y: 10 }, { x: 10, y: 0 },
    )).toBe(true);
    expect(segmentsIntersect(
      { x: 0, y: 0 }, { x: 10, y: 0 },
      { x: 10, y: 0 }, { x: 20, y: 0 },
    )).toBe(true);
    expect(segmentsIntersect(
      { x: 0, y: 0 }, { x: 10, y: 0 },
      { x: 4, y: 0 }, { x: 6, y: 0 },
    )).toBe(true);
    expect(segmentsIntersect(
      { x: 0, y: 0 }, { x: 10, y: 0 },
      { x: 0, y: 1 }, { x: 10, y: 1 },
    )).toBe(false);
  });

  it('uses the shared coordinate-aware tolerance for coincident points', () => {
    expect(pointsCoincide({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
    expect(pointsCoincide({ x: 1, y: 2 }, { x: 1.001, y: 2 })).toBe(false);
  });
});
