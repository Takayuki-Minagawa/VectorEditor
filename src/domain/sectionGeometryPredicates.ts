import type { SectionPoint } from './section';

const FLOAT_COMPARISON_FACTOR = 32;

export type PointInRingLocation = 'outside' | 'inside' | 'boundary';
export type RingBoundaryPolicy = 'include' | 'exclude';

export function pointDistanceSquared(first: SectionPoint, second: SectionPoint): number {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  return dx * dx + dy * dy;
}

export function vectorLength(first: SectionPoint, second: SectionPoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function coordinateScale(points: readonly SectionPoint[]): number {
  let scale = 1;
  for (const point of points) scale = Math.max(scale, Math.abs(point.x), Math.abs(point.y));
  return scale;
}

/** Length-dimensional uncertainty: coordinate ULP plus local arithmetic. */
export function linearEpsilon(
  points: readonly SectionPoint[],
  localLength = 1,
): number {
  return (coordinateScale(points) + Math.max(1, localLength))
    * Number.EPSILON * FLOAT_COMPARISON_FACTOR;
}

export function pointsCoincide(first: SectionPoint, second: SectionPoint): boolean {
  const epsilon = linearEpsilon([first, second], vectorLength(first, second));
  return pointDistanceSquared(first, second) <= epsilon * epsilon;
}

export function orientation(
  first: SectionPoint,
  second: SectionPoint,
  third: SectionPoint,
): number {
  return (second.x - first.x) * (third.y - first.y)
    - (second.y - first.y) * (third.x - first.x);
}

/** Area-dimensional uncertainty for a cross product of local edge vectors. */
export function orientationEpsilon(
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

export function pointOnSegment(
  point: SectionPoint,
  start: SectionPoint,
  end: SectionPoint,
): boolean {
  const edgeLength = vectorLength(start, end);
  const pointLength = vectorLength(start, point);
  if (Math.abs(orientation(start, end, point)) > orientationEpsilon(start, end, point)) {
    return false;
  }
  const epsilon = linearEpsilon([point, start, end], Math.max(edgeLength, pointLength));
  return point.x >= Math.min(start.x, end.x) - epsilon
    && point.x <= Math.max(start.x, end.x) + epsilon
    && point.y >= Math.min(start.y, end.y) - epsilon
    && point.y <= Math.max(start.y, end.y) + epsilon;
}

/** Includes proper crossings, endpoint contact, and collinear overlap. */
export function segmentsIntersect(
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

/** Classifies boundary separately so each caller can preserve its own policy. */
export function locatePointInRing(
  point: SectionPoint,
  ring: readonly SectionPoint[],
): PointInRingLocation {
  if (ring.length < 3) return 'outside';
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
    // Compare offsets from one vertex to retain precision at large CAD origins.
    const crossesRay = crossesVertically
      && point.x - current.x < ((previous.x - current.x) * (point.y - current.y))
        / (previous.y - current.y);
    if (crossesRay) inside = !inside;
  }
  return inside ? 'inside' : 'outside';
}

export function pointInRing(
  point: SectionPoint,
  ring: readonly SectionPoint[],
  boundaryPolicy: RingBoundaryPolicy = 'include',
): boolean {
  const location = locatePointInRing(point, ring);
  return location === 'inside' || (location === 'boundary' && boundaryPolicy === 'include');
}
