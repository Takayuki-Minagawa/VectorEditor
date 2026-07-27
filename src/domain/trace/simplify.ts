import type { Contour } from './contour';
import type { TracedPoint } from './tracedDrawing';

function squaredDistance(left: TracedPoint, right: TracedPoint): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

export function squaredDistanceToSegment(
  point: TracedPoint,
  start: TracedPoint,
  end: TracedPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return squaredDistance(point, start);
  const projection = Math.max(0, Math.min(
    1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
  ));
  const projectedX = start.x + projection * dx;
  const projectedY = start.y + projection * dy;
  const distanceX = point.x - projectedX;
  const distanceY = point.y - projectedY;
  return distanceX * distanceX + distanceY * distanceY;
}

function pointsCoincide(left: TracedPoint, right: TracedPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function canonicalPoints(
  points: readonly TracedPoint[],
  closed: boolean,
): TracedPoint[] {
  const result: TracedPoint[] = [];
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new RangeError('Polyline coordinates must be finite.');
    }
    const copy = { x: point.x, y: point.y };
    if (!result.length || !pointsCoincide(result[result.length - 1], copy)) {
      result.push(copy);
    }
  }
  if (
    closed
    && result.length > 1
    && pointsCoincide(result[0], result[result.length - 1])
  ) {
    result.pop();
  }
  return result;
}

function simplifyOpen(
  points: readonly TracedPoint[],
  toleranceSquared: number,
): TracedPoint[] {
  if (points.length <= 2) return points.map((point) => ({ ...point }));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<readonly [number, number]> = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [startIndex, endIndex] = stack.pop() as readonly [number, number];
    let farthestIndex = -1;
    let maximumDistance = toleranceSquared;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distance = squaredDistanceToSegment(
        points[index],
        points[startIndex],
        points[endIndex],
      );
      if (distance > maximumDistance) {
        maximumDistance = distance;
        farthestIndex = index;
      }
    }
    if (farthestIndex >= 0) {
      keep[farthestIndex] = 1;
      stack.push([startIndex, farthestIndex], [farthestIndex, endIndex]);
    }
  }

  return points
    .filter((_, index) => keep[index] !== 0)
    .map((point) => ({ ...point }));
}

function circularChain(
  points: readonly TracedPoint[],
  start: number,
  end: number,
): TracedPoint[] {
  const result: TracedPoint[] = [];
  let index = start;
  for (let count = 0; count <= points.length; count += 1) {
    result.push(points[index]);
    if (index === end) break;
    index = (index + 1) % points.length;
  }
  return result;
}

function farthestIndexFrom(
  points: readonly TracedPoint[],
  referenceIndex: number,
): number {
  let result = referenceIndex;
  let maximumDistance = -1;
  for (let index = 0; index < points.length; index += 1) {
    const distance = squaredDistance(points[index], points[referenceIndex]);
    if (distance > maximumDistance) {
      maximumDistance = distance;
      result = index;
    }
  }
  return result;
}

function fallbackTriangle(
  points: readonly TracedPoint[],
  firstIndex: number,
  secondIndex: number,
): TracedPoint[] {
  let thirdIndex = -1;
  let maximumDistance = -1;
  for (let index = 0; index < points.length; index += 1) {
    if (index === firstIndex || index === secondIndex) continue;
    const distance = squaredDistanceToSegment(
      points[index],
      points[firstIndex],
      points[secondIndex],
    );
    if (distance > maximumDistance) {
      maximumDistance = distance;
      thirdIndex = index;
    }
  }
  if (thirdIndex < 0) return points.slice(0, 3).map((point) => ({ ...point }));
  return [firstIndex, secondIndex, thirdIndex]
    .sort((left, right) => left - right)
    .map((index) => ({ ...points[index] }));
}

/**
 * Douglas-Peucker simplification for open polylines and implicit-closure
 * polygons. The iterative implementation avoids call-stack growth on complex
 * photographs.
 */
export function simplifyPolyline(
  input: readonly TracedPoint[],
  tolerance: number,
  closed = false,
): TracedPoint[] {
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new RangeError('Simplification tolerance must be non-negative.');
  }
  const points = canonicalPoints(input, closed);
  if (!closed) return simplifyOpen(points, tolerance * tolerance);
  if (points.length <= 3) return points;

  // Split a ring at two distant vertices, simplify each open chain, and join.
  // This avoids privileging an arbitrary first/last (coincident) ring point.
  const firstIndex = farthestIndexFrom(points, 0);
  const secondIndex = farthestIndexFrom(points, firstIndex);
  const firstChain = simplifyOpen(
    circularChain(points, firstIndex, secondIndex),
    tolerance * tolerance,
  );
  const secondChain = simplifyOpen(
    circularChain(points, secondIndex, firstIndex),
    tolerance * tolerance,
  );
  const result = [
    ...firstChain.slice(0, -1),
    ...secondChain.slice(0, -1),
  ];
  return result.length >= 3
    ? result
    : fallbackTriangle(points, firstIndex, secondIndex);
}

function polygonArea(points: readonly TracedPoint[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(twiceArea) / 2;
}

export function simplifyContour(
  contour: Contour,
  tolerance: number,
): Contour {
  const points = simplifyPolyline(contour.points, tolerance, true);
  return { ...contour, points, area: polygonArea(points) };
}

export function simplifyContours(
  contours: readonly Contour[],
  tolerance: number,
): Contour[] {
  return contours.map((contour) => simplifyContour(contour, tolerance));
}
