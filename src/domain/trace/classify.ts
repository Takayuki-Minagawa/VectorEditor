import type { Contour } from './contour';
import type { TracedPoint, TracedShape } from './tracedDrawing';
import { squaredDistanceToSegment } from './simplify';

export interface OrientedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  center: TracedPoint;
}

export interface ShapeFeatures {
  area: number;
  perimeter: number;
  centroid: TracedPoint;
  circularity: number;
  convexity: number;
  aspectRatio: number;
  fillRatio: number;
  radialVariation: number;
  ellipseError: number;
  orientedBounds: OrientedBounds;
}

export interface ClassificationOptions {
  closed?: boolean;
  strokeWidth?: number;
  lineAspectRatio?: number;
  lineStraightness?: number;
  rectangleFillRatio?: number;
  circleCircularity?: number;
  circleAspectRatio?: number;
  ellipseFitError?: number;
}

const DEFAULT_CLASSIFICATION_OPTIONS: Required<ClassificationOptions> = {
  closed: true,
  strokeWidth: 1,
  lineAspectRatio: 6,
  lineStraightness: 0.08,
  rectangleFillRatio: 0.78,
  circleCircularity: 0.72,
  circleAspectRatio: 1.2,
  ellipseFitError: 0.18,
};

function copyDistinctPoints(points: readonly TracedPoint[]): TracedPoint[] {
  const result: TracedPoint[] = [];
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new RangeError('Shape coordinates must be finite.');
    }
    const previous = result[result.length - 1];
    if (!previous || previous.x !== point.x || previous.y !== point.y) {
      result.push({ ...point });
    }
  }
  if (
    result.length > 1
    && result[0].x === result[result.length - 1].x
    && result[0].y === result[result.length - 1].y
  ) {
    result.pop();
  }
  return result;
}

export function polygonSignedArea(points: readonly TracedPoint[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return twiceArea / 2;
}

function polylineLength(points: readonly TracedPoint[], closed: boolean): number {
  let length = 0;
  const edgeCount = closed ? points.length : points.length - 1;
  for (let index = 0; index < edgeCount; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    length += Math.hypot(next.x - current.x, next.y - current.y);
  }
  return length;
}

function averagePoint(points: readonly TracedPoint[]): TracedPoint {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function polygonCentroid(
  points: readonly TracedPoint[],
  signedArea: number,
): TracedPoint {
  if (Math.abs(signedArea) <= Number.EPSILON) return averagePoint(points);
  let x = 0;
  let y = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const cross = current.x * next.y - next.x * current.y;
    x += (current.x + next.x) * cross;
    y += (current.y + next.y) * cross;
  }
  const scale = 1 / (6 * signedArea);
  return { x: x * scale, y: y * scale };
}

function cross(
  origin: TracedPoint,
  first: TracedPoint,
  second: TracedPoint,
): number {
  return (
    (first.x - origin.x) * (second.y - origin.y)
    - (first.y - origin.y) * (second.x - origin.x)
  );
}

export function convexHull(points: readonly TracedPoint[]): TracedPoint[] {
  const sorted = copyDistinctPoints(points).sort(
    (left, right) => left.x - right.x || left.y - right.y,
  );
  const unique = sorted.filter((point, index) => (
    index === 0
    || point.x !== sorted[index - 1].x
    || point.y !== sorted[index - 1].y
  ));
  if (unique.length <= 2) return unique;

  const lower: TracedPoint[] = [];
  for (const point of unique) {
    while (
      lower.length >= 2
      && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: TracedPoint[] = [];
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index];
    while (
      upper.length >= 2
      && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function normalizeHalfTurn(angle: number): number {
  let normalized = ((angle + 90) % 180 + 180) % 180 - 90;
  if (Object.is(normalized, -0)) normalized = 0;
  return normalized;
}

export function minimumAreaBounds(
  points: readonly TracedPoint[],
): OrientedBounds {
  if (points.length === 0) {
    throw new RangeError('Oriented bounds require at least one point.');
  }
  const hull = convexHull(points);
  if (hull.length === 1) {
    return {
      x: hull[0].x,
      y: hull[0].y,
      width: 0,
      height: 0,
      angle: 0,
      center: { ...hull[0] },
    };
  }

  let best:
    | {
      area: number;
      minU: number;
      maxU: number;
      minV: number;
      maxV: number;
      cos: number;
      sin: number;
    }
    | undefined;
  const edgeCount = hull.length === 2 ? 1 : hull.length;
  for (let index = 0; index < edgeCount; index += 1) {
    const current = hull[index];
    const next = hull[(index + 1) % hull.length];
    const angle = Math.atan2(next.y - current.y, next.x - current.x);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let minU = Number.POSITIVE_INFINITY;
    let maxU = Number.NEGATIVE_INFINITY;
    let minV = Number.POSITIVE_INFINITY;
    let maxV = Number.NEGATIVE_INFINITY;
    for (const point of hull) {
      const u = point.x * cos + point.y * sin;
      const v = -point.x * sin + point.y * cos;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) {
      best = { area, minU, maxU, minV, maxV, cos, sin };
    }
  }

  const bounds = best as NonNullable<typeof best>;
  const angle = normalizeHalfTurn(
    Math.atan2(bounds.sin, bounds.cos) * 180 / Math.PI,
  );
  const radians = angle * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  for (const point of hull) {
    const u = point.x * cos + point.y * sin;
    const v = -point.x * sin + point.y * cos;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const width = maxU - minU;
  const height = maxV - minV;
  const centerU = (minU + maxU) / 2;
  const centerV = (minV + maxV) / 2;
  return {
    x: minU * cos - minV * sin,
    y: minU * sin + minV * cos,
    width,
    height,
    angle,
    center: {
      x: centerU * cos - centerV * sin,
      y: centerU * sin + centerV * cos,
    },
  };
}

function ellipseFitError(
  points: readonly TracedPoint[],
  bounds: OrientedBounds,
): number {
  const rx = bounds.width / 2;
  const ry = bounds.height / 2;
  if (rx <= 0 || ry <= 0) return Number.POSITIVE_INFINITY;
  const radians = bounds.angle * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  let error = 0;
  for (const point of points) {
    const dx = point.x - bounds.center.x;
    const dy = point.y - bounds.center.y;
    const u = (dx * cos + dy * sin) / rx;
    const v = (-dx * sin + dy * cos) / ry;
    error += Math.abs(Math.hypot(u, v) - 1);
  }
  return error / points.length;
}

function radialVariation(
  points: readonly TracedPoint[],
  center: TracedPoint,
): number {
  const distances = points.map((point) => (
    Math.hypot(point.x - center.x, point.y - center.y)
  ));
  const mean = distances.reduce((sum, value) => sum + value, 0) / distances.length;
  if (mean === 0) return Number.POSITIVE_INFINITY;
  const variance = distances.reduce(
    (sum, value) => sum + (value - mean) ** 2,
    0,
  ) / distances.length;
  return Math.sqrt(variance) / mean;
}

export function computeShapeFeatures(
  input: readonly TracedPoint[],
): ShapeFeatures {
  const points = copyDistinctPoints(input);
  if (points.length < 3) {
    throw new RangeError('Closed-shape features require at least three points.');
  }
  const signedArea = polygonSignedArea(points);
  const area = Math.abs(signedArea);
  const perimeter = polylineLength(points, true);
  const centroid = polygonCentroid(points, signedArea);
  const hull = convexHull(points);
  const hullArea = Math.abs(polygonSignedArea(hull));
  const bounds = minimumAreaBounds(hull);
  const minor = Math.min(bounds.width, bounds.height);
  const major = Math.max(bounds.width, bounds.height);
  return {
    area,
    perimeter,
    centroid,
    circularity: perimeter > 0 ? 4 * Math.PI * area / (perimeter * perimeter) : 0,
    convexity: hullArea > 0 ? Math.min(1, area / hullArea) : 0,
    aspectRatio: minor > 0 ? major / minor : Number.POSITIVE_INFINITY,
    fillRatio: bounds.width * bounds.height > 0
      ? Math.min(1, area / (bounds.width * bounds.height))
      : 0,
    radialVariation: radialVariation(points, centroid),
    ellipseError: ellipseFitError(points, bounds),
    orientedBounds: bounds,
  };
}

function majorAxisLine(
  bounds: OrientedBounds,
  strokeWidth: number,
): TracedShape {
  let angle = bounds.angle * Math.PI / 180;
  let length = bounds.width;
  if (bounds.height > bounds.width) {
    angle += Math.PI / 2;
    length = bounds.height;
  }
  const dx = Math.cos(angle) * length / 2;
  const dy = Math.sin(angle) * length / 2;
  return {
    kind: 'line',
    x1: bounds.center.x - dx,
    y1: bounds.center.y - dy,
    x2: bounds.center.x + dx,
    y2: bounds.center.y + dy,
    strokeWidth: Math.max(1, strokeWidth),
  };
}

function classifyOpen(
  points: readonly TracedPoint[],
  options: Required<ClassificationOptions>,
): TracedShape {
  const first = points[0];
  const last = points[points.length - 1];
  const chordLength = Math.hypot(last.x - first.x, last.y - first.y);
  let maximumDeviation = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    maximumDeviation = Math.max(
      maximumDeviation,
      Math.sqrt(squaredDistanceToSegment(points[index], first, last)),
    );
  }
  const pathLength = polylineLength(points, false);
  const deviationRatio = chordLength > 0
    ? maximumDeviation / chordLength
    : Number.POSITIVE_INFINITY;
  const directness = pathLength > 0 ? chordLength / pathLength : 0;
  if (deviationRatio <= options.lineStraightness && directness >= 0.9) {
    return {
      kind: 'line',
      x1: first.x,
      y1: first.y,
      x2: last.x,
      y2: last.y,
      strokeWidth: Math.max(1, options.strokeWidth),
    };
  }
  return {
    kind: 'polyline',
    points: points.map((point) => ({ ...point })),
    strokeWidth: Math.max(1, options.strokeWidth),
  };
}

/**
 * Deterministic cleanup classification. Ambiguous shapes deliberately fall
 * back to polygons instead of forcing a misleading primitive.
 */
export function classifyShape(
  input: readonly TracedPoint[],
  requested: ClassificationOptions = {},
): TracedShape {
  const options = { ...DEFAULT_CLASSIFICATION_OPTIONS, ...requested };
  const points = copyDistinctPoints(input);
  if (points.length < 2) {
    throw new RangeError('Shape classification requires at least two points.');
  }
  if (!options.closed) return classifyOpen(points, options);
  if (points.length < 3) {
    throw new RangeError('Closed-shape classification requires three points.');
  }

  const features = computeShapeFeatures(points);
  const bounds = features.orientedBounds;
  const majorLength = Math.max(bounds.width, bounds.height);
  if (features.aspectRatio >= options.lineAspectRatio) {
    const inferredWidth = majorLength > 0
      ? features.area / majorLength
      : options.strokeWidth;
    return majorAxisLine(bounds, Math.max(options.strokeWidth, inferredWidth));
  }

  if (
    points.length >= 6
    && features.aspectRatio <= options.circleAspectRatio
    && features.circularity >= options.circleCircularity
    && features.radialVariation <= 0.18
  ) {
    return {
      kind: 'circle',
      cx: features.centroid.x,
      cy: features.centroid.y,
      r: Math.sqrt(features.area / Math.PI),
    };
  }

  if (
    points.length >= 6
    && features.aspectRatio <= 4.5
    && features.convexity >= 0.86
    && features.ellipseError <= options.ellipseFitError
  ) {
    return {
      kind: 'ellipse',
      cx: bounds.center.x,
      cy: bounds.center.y,
      rx: bounds.width / 2,
      ry: bounds.height / 2,
      angle: bounds.angle,
    };
  }

  if (
    features.convexity >= 0.88
    && features.fillRatio >= options.rectangleFillRatio
  ) {
    return {
      kind: 'rect',
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      angle: bounds.angle,
    };
  }

  return { kind: 'polygon', points, closed: true };
}

export function classifyContour(
  contour: Contour,
  options: Omit<ClassificationOptions, 'closed'> = {},
): TracedShape {
  return classifyShape(contour.points, { ...options, closed: true });
}
