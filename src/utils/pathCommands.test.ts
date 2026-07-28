import { describe, expect, it } from 'vitest';
import {
  cubicPointAt,
  deletePathAnchor,
  findNearestPathPoint,
  insertAnchorOnSegment,
  listPathAnchors,
  listPathSegments,
  pointOnSegment,
  quadraticPointAt,
  splitCubicAt,
  splitQuadraticAt,
  type SimplePathCommand,
} from './pathCommands';

const SAMPLES = 64;

describe('bezier splitting', () => {
  it('splitCubicAt reproduces the original curve exactly on both halves', () => {
    const p0 = { x: 0, y: 0 };
    const c1 = { x: 30, y: 90 };
    const c2 = { x: 80, y: -40 };
    const p1 = { x: 120, y: 20 };
    const t = 0.37;
    const split = splitCubicAt(p0, c1, c2, p1, t);

    for (let sample = 0; sample <= SAMPLES; sample += 1) {
      const u = sample / SAMPLES;
      const original = cubicPointAt(p0, c1, c2, p1, u);
      const reproduced = u <= t
        ? cubicPointAt(p0, split.first.control1, split.first.control2, split.first.end, u / t)
        : cubicPointAt(
          split.first.end,
          split.second.control1,
          split.second.control2,
          split.second.end,
          (u - t) / (1 - t),
        );
      expect(reproduced.x).toBeCloseTo(original.x, 9);
      expect(reproduced.y).toBeCloseTo(original.y, 9);
    }
  });

  it('splitQuadraticAt reproduces the original curve exactly on both halves', () => {
    const p0 = { x: 0, y: 0 };
    const control = { x: 50, y: 100 };
    const p1 = { x: 100, y: 0 };
    const t = 0.62;
    const split = splitQuadraticAt(p0, control, p1, t);

    for (let sample = 0; sample <= SAMPLES; sample += 1) {
      const u = sample / SAMPLES;
      const original = quadraticPointAt(p0, control, p1, u);
      const reproduced = u <= t
        ? quadraticPointAt(p0, split.first.control, split.first.end, u / t)
        : quadraticPointAt(split.first.end, split.second.control, split.second.end, (u - t) / (1 - t));
      expect(reproduced.x).toBeCloseTo(original.x, 9);
      expect(reproduced.y).toBeCloseTo(original.y, 9);
    }
  });
});

describe('listPathSegments', () => {
  it('includes the implicit closing segment of a Z command', () => {
    const path: SimplePathCommand[] = [
      ['M', 0, 0],
      ['L', 100, 0],
      ['L', 100, 100],
      ['Z'],
    ];
    const segments = listPathSegments(path);
    expect(segments).toHaveLength(3);
    expect(segments[2].kind).toBe('close');
    expect(segments[2].start).toEqual({ x: 100, y: 100 });
    expect(segments[2].end).toEqual({ x: 0, y: 0 });
  });

  it('returns nothing for paths with untrackable commands', () => {
    const path: SimplePathCommand[] = [['M', 0, 0], ['A', 1, 1, 0, 0, 0, 10, 10]];
    expect(listPathSegments(path)).toHaveLength(0);
  });
});

describe('findNearestPathPoint and insertAnchorOnSegment', () => {
  it('projects onto a line segment and inserts a shape-preserving anchor', () => {
    const path: SimplePathCommand[] = [['M', 0, 0], ['L', 100, 0]];
    const hit = findNearestPathPoint(path, { x: 40, y: 25 })!;
    expect(hit.point.x).toBeCloseTo(40, 9);
    expect(hit.point.y).toBeCloseTo(0, 9);

    const insertedIndex = insertAnchorOnSegment(path, hit);
    expect(path).toEqual([['M', 0, 0], ['L', 40, 0], ['L', 100, 0]]);
    expect(insertedIndex).toBe(1);
  });

  it('inserts on the closing segment without reordering anchors', () => {
    const path: SimplePathCommand[] = [['M', 0, 0], ['L', 100, 0], ['L', 100, 100], ['Z']];
    const hit = findNearestPathPoint(path, { x: 50, y: 50 })!;
    expect(hit.segment.kind).toBe('close');

    insertAnchorOnSegment(path, hit);
    expect(path).toEqual([
      ['M', 0, 0],
      ['L', 100, 0],
      ['L', 100, 100],
      ['L', 50, 50],
      ['Z'],
    ]);
  });

  it('splits a cubic segment without changing the drawn geometry', () => {
    const original: SimplePathCommand[] = [['M', 0, 0], ['C', 30, 90, 80, -40, 120, 20]];
    const path: SimplePathCommand[] = [['M', 0, 0], ['C', 30, 90, 80, -40, 120, 20]];
    const target = cubicPointAt({ x: 0, y: 0 }, { x: 30, y: 90 }, { x: 80, y: -40 }, { x: 120, y: 20 }, 0.5);
    const hit = findNearestPathPoint(path, target)!;
    insertAnchorOnSegment(path, hit);

    expect(path).toHaveLength(3);
    expect(path[1][0]).toBe('C');
    expect(path[2][0]).toBe('C');

    // Every point sampled on the original curve must lie on the split path.
    const originalSegments = listPathSegments(original);
    for (let sample = 0; sample <= SAMPLES; sample += 1) {
      const reference = pointOnSegment(originalSegments[0], sample / SAMPLES);
      const nearest = findNearestPathPoint(path, reference)!;
      expect(Math.sqrt(nearest.distanceSquared)).toBeLessThan(1e-6);
    }
  });
});

describe('deletePathAnchor', () => {
  it('refuses to shrink an open subpath below two anchors', () => {
    const path: SimplePathCommand[] = [['M', 0, 0], ['L', 100, 0]];
    expect(deletePathAnchor(path, 1)).toBe(false);
    expect(path).toHaveLength(2);
  });

  it('refuses to shrink a closed subpath below three anchors', () => {
    const path: SimplePathCommand[] = [['M', 0, 0], ['L', 100, 0], ['L', 100, 100], ['Z']];
    expect(deletePathAnchor(path, 1)).toBe(false);
    expect(path).toHaveLength(4);
  });

  it('removes a middle anchor from an open polyline path', () => {
    const path: SimplePathCommand[] = [['M', 0, 0], ['L', 50, 50], ['L', 100, 0]];
    expect(deletePathAnchor(path, 1)).toBe(true);
    expect(path).toEqual([['M', 0, 0], ['L', 100, 0]]);
  });

  it('promotes the next anchor when the subpath start is deleted', () => {
    const path: SimplePathCommand[] = [['M', 0, 0], ['L', 50, 50], ['L', 100, 0]];
    expect(deletePathAnchor(path, 0)).toBe(true);
    expect(path).toEqual([['M', 50, 50], ['L', 100, 0]]);
  });

  it('keeps the departure tangent when merging consecutive cubics', () => {
    const path: SimplePathCommand[] = [
      ['M', 0, 0],
      ['C', 10, 10, 20, 10, 30, 0],
      ['C', 40, -10, 50, -10, 60, 0],
      ['L', 100, 0],
    ];
    expect(deletePathAnchor(path, 1)).toBe(true);
    expect(path).toEqual([
      ['M', 0, 0],
      ['C', 10, 10, 50, -10, 60, 0],
      ['L', 100, 0],
    ]);
  });

  it('lists anchors with their command indices', () => {
    const path: SimplePathCommand[] = [['M', 0, 0], ['C', 10, 10, 20, 10, 30, 0], ['Z']];
    expect(listPathAnchors(path)).toEqual([
      { commandIndex: 0, point: { x: 0, y: 0 } },
      { commandIndex: 1, point: { x: 30, y: 0 } },
    ]);
  });
});
