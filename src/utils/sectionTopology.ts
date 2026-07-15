import polygonClipping from 'polygon-clipping';
import type { MultiPolygon, Pair, Ring } from 'polygon-clipping';
import {
  normalizeSectionProfileData,
  signedSectionRingArea,
  type SectionPoint,
  type SectionProfileData,
  type SectionRing,
} from '../domain/section';

const FLOAT_COMPARISON_FACTOR = 32;

export class SectionTopologyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SectionTopologyError';
  }
}

interface Segment {
  index: number;
  source: number;
  start: SectionPoint;
  end: SectionPoint;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

type PointLocation = 'outside' | 'inside' | 'boundary';

function vectorLength(first: SectionPoint, second: SectionPoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function coordinateScale(points: readonly SectionPoint[]): number {
  let scale = 1;
  for (const point of points) scale = Math.max(scale, Math.abs(point.x), Math.abs(point.y));
  return scale;
}

function linearEpsilon(points: readonly SectionPoint[], localLength = 1): number {
  return (coordinateScale(points) + Math.max(1, localLength))
    * Number.EPSILON * FLOAT_COMPARISON_FACTOR;
}

function orientation(first: SectionPoint, second: SectionPoint, third: SectionPoint): number {
  return (second.x - first.x) * (third.y - first.y)
    - (second.y - first.y) * (third.x - first.x);
}

function orientationEpsilon(
  first: SectionPoint,
  second: SectionPoint,
  third: SectionPoint,
): number {
  const firstLength = vectorLength(first, second);
  const secondLength = vectorLength(first, third);
  const localLength = Math.max(1, firstLength, secondLength);
  const coordinateUncertainty = linearEpsilon([first, second, third], localLength);
  return (firstLength + secondLength + localLength) * coordinateUncertainty
    + localLength * localLength * Number.EPSILON * FLOAT_COMPARISON_FACTOR;
}

function pointOnSegment(point: SectionPoint, start: SectionPoint, end: SectionPoint): boolean {
  const edgeLength = vectorLength(start, end);
  const pointLength = vectorLength(start, point);
  if (Math.abs(orientation(start, end, point)) > orientationEpsilon(start, end, point)) return false;
  const epsilon = linearEpsilon([point, start, end], Math.max(edgeLength, pointLength));
  return point.x >= Math.min(start.x, end.x) - epsilon
    && point.x <= Math.max(start.x, end.x) + epsilon
    && point.y >= Math.min(start.y, end.y) - epsilon
    && point.y <= Math.max(start.y, end.y) + epsilon;
}

function segmentsIntersect(
  firstStart: SectionPoint,
  firstEnd: SectionPoint,
  secondStart: SectionPoint,
  secondEnd: SectionPoint,
): boolean {
  const o1 = orientation(firstStart, firstEnd, secondStart);
  const o2 = orientation(firstStart, firstEnd, secondEnd);
  const o3 = orientation(secondStart, secondEnd, firstStart);
  const o4 = orientation(secondStart, secondEnd, firstEnd);
  const e1 = orientationEpsilon(firstStart, firstEnd, secondStart);
  const e2 = orientationEpsilon(firstStart, firstEnd, secondEnd);
  const e3 = orientationEpsilon(secondStart, secondEnd, firstStart);
  const e4 = orientationEpsilon(secondStart, secondEnd, firstEnd);
  if (((o1 > e1 && o2 < -e2) || (o1 < -e1 && o2 > e2))
      && ((o3 > e3 && o4 < -e4) || (o3 < -e3 && o4 > e4))) {
    return true;
  }
  return (Math.abs(o1) <= e1 && pointOnSegment(secondStart, firstStart, firstEnd))
    || (Math.abs(o2) <= e2 && pointOnSegment(secondEnd, firstStart, firstEnd))
    || (Math.abs(o3) <= e3 && pointOnSegment(firstStart, secondStart, secondEnd))
    || (Math.abs(o4) <= e4 && pointOnSegment(firstEnd, secondStart, secondEnd));
}

function ringSegments(points: readonly SectionPoint[], source: number): Segment[] {
  return points.map((start, index) => {
    const end = points[(index + 1) % points.length];
    return {
      index,
      source,
      start,
      end,
      minX: Math.min(start.x, end.x),
      maxX: Math.max(start.x, end.x),
      minY: Math.min(start.y, end.y),
      maxY: Math.max(start.y, end.y),
    };
  });
}

function ringHasSelfIntersection(points: readonly SectionPoint[]): boolean {
  const segments = ringSegments(points, 0).sort((a, b) => a.minX - b.minX);
  for (let firstIndex = 0; firstIndex < segments.length; firstIndex += 1) {
    const first = segments[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < segments.length; secondIndex += 1) {
      const second = segments[secondIndex];
      if (second.minX > first.maxX) break;
      const adjacent = Math.abs(first.index - second.index) === 1
        || Math.abs(first.index - second.index) === points.length - 1;
      if (adjacent || second.minY > first.maxY || second.maxY < first.minY) continue;
      if (segmentsIntersect(first.start, first.end, second.start, second.end)) return true;
    }
  }
  return false;
}

function ringBoundariesIntersect(
  firstPoints: readonly SectionPoint[],
  secondPoints: readonly SectionPoint[],
): boolean {
  const segments = [
    ...ringSegments(firstPoints, 0),
    ...ringSegments(secondPoints, 1),
  ].sort((a, b) => a.minX - b.minX);
  for (let firstIndex = 0; firstIndex < segments.length; firstIndex += 1) {
    const first = segments[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < segments.length; secondIndex += 1) {
      const second = segments[secondIndex];
      if (second.minX > first.maxX) break;
      if (first.source === second.source || second.minY > first.maxY || second.maxY < first.minY) continue;
      if (segmentsIntersect(first.start, first.end, second.start, second.end)) return true;
    }
  }
  return false;
}

function locatePointInRing(point: SectionPoint, ring: readonly SectionPoint[]): PointLocation {
  let inside = false;
  for (
    let index = 0, previousIndex = ring.length - 1;
    index < ring.length;
    previousIndex = index, index += 1
  ) {
    const current = ring[index];
    const previous = ring[previousIndex];
    if (pointOnSegment(point, previous, current)) return 'boundary';
    const crossesVertically = (current.y > point.y) !== (previous.y > point.y);
    const crossesRay = crossesVertically
      && point.x - current.x < ((previous.x - current.x) * (point.y - current.y))
        / (previous.y - current.y);
    if (crossesRay) inside = !inside;
  }
  return inside ? 'inside' : 'outside';
}

function profileTranslation(profile: SectionProfileData): SectionPoint {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  profile.rings.forEach((ring) => ring.points.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }));
  return { x: minX / 2 + maxX / 2, y: minY / 2 + maxY / 2 };
}

function translateRing(ring: SectionRing, translation: SectionPoint): Ring {
  return [
    ...ring.points.map((point): Pair => [
      point.x - translation.x,
      point.y - translation.y,
    ]),
    [
      ring.points[0].x - translation.x,
      ring.points[0].y - translation.y,
    ],
  ];
}

function multiPolygonArea(value: MultiPolygon): number {
  let area = 0;
  value.forEach((polygon) => polygon.forEach((ring, ringIndex) => {
    const points = ring.map(([x, y]) => ({ x, y }));
    const ringArea = Math.abs(signedSectionRingArea(points));
    area += ringIndex === 0 ? ringArea : -ringArea;
  }));
  return area;
}

/**
 * Validates relationships that structural ring validation cannot establish:
 * simple boundaries, hole containment, and non-overlapping material/void
 * regions. Point/line contact between separate material outers is allowed.
 */
export function assertValidSectionProfileTopology(value: SectionProfileData): void {
  const profile = normalizeSectionProfileData(value);
  profile.rings.forEach((ring, ringIndex) => {
    if (ringHasSelfIntersection(ring.points)) {
      throw new SectionTopologyError(`Section ring ${ringIndex} is self-intersecting.`);
    }
  });

  const outers = profile.rings.filter((ring) => ring.role === 'outer');
  const holes = profile.rings.filter((ring) => ring.role === 'hole');
  const holesByOuter = new Map<SectionRing, SectionRing[]>();
  outers.forEach((outer) => holesByOuter.set(outer, []));

  for (const hole of holes) {
    const containers = outers.filter((outer) => {
      if (ringBoundariesIntersect(hole.points, outer.points)) {
        throw new SectionTopologyError('A section hole must not cross or touch an outer boundary.');
      }
      return locatePointInRing(hole.points[0], outer.points) === 'inside';
    });
    if (containers.length !== 1) {
      throw new SectionTopologyError('Every section hole must be contained by exactly one outer boundary.');
    }
    holesByOuter.get(containers[0])?.push(hole);
  }

  const translation = profileTranslation(profile);
  const geometry: MultiPolygon = outers.map((outer) => [
    translateRing(outer, translation),
    ...(holesByOuter.get(outer) ?? []).map((hole) => translateRing(hole, translation)),
  ]);
  let normalized: MultiPolygon;
  try {
    normalized = polygonClipping.union(geometry);
  } catch (error) {
    throw new SectionTopologyError(
      error instanceof Error ? error.message : 'Section ring topology is invalid.',
    );
  }

  const signedInputArea = profile.rings.reduce(
    (sum, ring) => sum + signedSectionRingArea(ring.points),
    0,
  );
  const absoluteInputArea = profile.rings.reduce(
    (sum, ring) => sum + Math.abs(signedSectionRingArea(ring.points)),
    0,
  );
  const normalizedArea = multiPolygonArea(normalized);
  const areaTolerance = Math.max(
    profile.analysisToleranceMm ** 2,
    Math.max(1, absoluteInputArea, Math.abs(normalizedArea)) * 1e-10,
  );
  if (
    signedInputArea <= areaTolerance
    || Math.abs(signedInputArea - normalizedArea) > areaTolerance
  ) {
    throw new SectionTopologyError('Section outer or hole rings overlap or have inconsistent topology.');
  }
}
