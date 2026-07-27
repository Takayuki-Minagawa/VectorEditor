import type { TracedPoint, TracedShape } from './tracedDrawing';

export interface AlignOptions {
  /** Maximum angular deviation that is eligible for snapping. */
  angleToleranceDeg?: number;
  /** Alias matching TraceOptions. */
  angleSnapDeg?: number;
  /** Direction increment, normally 45 degrees. */
  angleStepDeg?: number;
  /** Maximum distance between peer coordinates; zero disables alignment. */
  coordinateTolerance?: number;
  /** Alias matching TraceOptions. */
  coordinateSnap?: number;
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function angularDifference(left: number, right: number): number {
  return Math.abs(positiveModulo(left - right + 180, 360) - 180);
}

export function snapAngle(
  angle: number,
  toleranceDeg = 8,
  stepDeg = 45,
): number {
  if (
    !Number.isFinite(angle)
    || !Number.isFinite(toleranceDeg)
    || !Number.isFinite(stepDeg)
    || toleranceDeg < 0
    || stepDeg <= 0
  ) {
    throw new RangeError('Angle snapping requires finite non-negative settings.');
  }
  const nearest = Math.round(angle / stepDeg) * stepDeg;
  return angularDifference(angle, nearest) <= toleranceDeg ? nearest : angle;
}

function snapLineAngle(
  shape: Extract<TracedShape, { kind: 'line' }>,
  tolerance: number,
  step: number,
): Extract<TracedShape, { kind: 'line' }> {
  const dx = shape.x2 - shape.x1;
  const dy = shape.y2 - shape.y1;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { ...shape };
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  const snapped = snapAngle(angle, tolerance, step);
  if (snapped === angle) return { ...shape };
  const radians = snapped * Math.PI / 180;
  const centerX = (shape.x1 + shape.x2) / 2;
  const centerY = (shape.y1 + shape.y2) / 2;
  const halfX = Math.cos(radians) * length / 2;
  const halfY = Math.sin(radians) * length / 2;
  return {
    ...shape,
    x1: centerX - halfX,
    y1: centerY - halfY,
    x2: centerX + halfX,
    y2: centerY + halfY,
  };
}

function snapRectAngle(
  shape: Extract<TracedShape, { kind: 'rect' }>,
  tolerance: number,
  step: number,
): Extract<TracedShape, { kind: 'rect' }> {
  const snapped = snapAngle(shape.angle, tolerance, step);
  if (snapped === shape.angle) return { ...shape };

  const oldRadians = shape.angle * Math.PI / 180;
  const oldCos = Math.cos(oldRadians);
  const oldSin = Math.sin(oldRadians);
  const halfWidth = shape.width / 2;
  const halfHeight = shape.height / 2;
  const centerX = shape.x + oldCos * halfWidth - oldSin * halfHeight;
  const centerY = shape.y + oldSin * halfWidth + oldCos * halfHeight;

  const newRadians = snapped * Math.PI / 180;
  const newCos = Math.cos(newRadians);
  const newSin = Math.sin(newRadians);
  return {
    ...shape,
    x: centerX - newCos * halfWidth + newSin * halfHeight,
    y: centerY - newSin * halfWidth - newCos * halfHeight,
    angle: snapped,
  };
}

function alignShapeAngle(
  shape: TracedShape,
  tolerance: number,
  step: number,
): TracedShape {
  switch (shape.kind) {
    case 'line':
      return snapLineAngle(shape, tolerance, step);
    case 'rect':
      return snapRectAngle(shape, tolerance, step);
    case 'ellipse':
      return { ...shape, angle: snapAngle(shape.angle, tolerance, step) };
    case 'polyline':
      if (shape.points.length === 2) {
        const line = snapLineAngle({
          kind: 'line',
          x1: shape.points[0].x,
          y1: shape.points[0].y,
          x2: shape.points[1].x,
          y2: shape.points[1].y,
          strokeWidth: shape.strokeWidth,
        }, tolerance, step);
        return {
          ...shape,
          points: [
            { x: line.x1, y: line.y1 },
            { x: line.x2, y: line.y2 },
          ],
        };
      }
      return { ...shape, points: shape.points.map((point) => ({ ...point })) };
    case 'polygon':
      return {
        ...shape,
        points: shape.points.map((point) => ({ ...point })),
        holes: shape.holes?.map((hole) => (
          hole.map((point) => ({ ...point }))
        )),
      };
    case 'circle':
      return { ...shape };
  }
}

function clusteredValues(values: readonly number[], tolerance: number): number[] {
  if (values.length === 0 || tolerance <= 0) return [...values];
  const indexed = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value);
  const output = [...values];
  let cluster: typeof indexed = [];
  let mean = 0;

  const commit = (): void => {
    if (cluster.length <= 1) {
      cluster = [];
      mean = 0;
      return;
    }
    for (const entry of cluster) output[entry.index] = mean;
    cluster = [];
    mean = 0;
  };

  for (const entry of indexed) {
    if (cluster.length === 0) {
      cluster = [entry];
      mean = entry.value;
      continue;
    }
    if (Math.abs(entry.value - mean) <= tolerance) {
      cluster.push(entry);
      mean += (entry.value - mean) / cluster.length;
    } else {
      commit();
      cluster = [entry];
      mean = entry.value;
    }
  }
  commit();
  return output;
}

function isAxisAlignedRect(
  shape: Extract<TracedShape, { kind: 'rect' }>,
): boolean {
  return angularDifference(shape.angle, Math.round(shape.angle / 180) * 180) < 1e-9;
}

interface ShapeCoordinateSlice {
  shapeIndex: number;
  offset: number;
  length: number;
}

interface CollectedCoordinates {
  x: number[];
  y: number[];
  slices: ShapeCoordinateSlice[];
}

function shapeCoordinates(shape: TracedShape): TracedPoint[] {
  switch (shape.kind) {
    case 'polygon':
      // Keep interior rings out of peer clustering: snapping a narrow hole
      // onto its outer ring would erase the negative space under even-odd fill.
      return shape.points;
    case 'polyline':
      return shape.points;
    case 'line':
      return [
        { x: shape.x1, y: shape.y1 },
        { x: shape.x2, y: shape.y2 },
      ];
    case 'rect':
      return isAxisAlignedRect(shape)
        ? [
          { x: shape.x, y: shape.y },
          { x: shape.x + shape.width, y: shape.y + shape.height },
        ]
        : [{ x: shape.x, y: shape.y }];
    case 'circle':
    case 'ellipse':
      return [{ x: shape.cx, y: shape.cy }];
  }
}

function collectCoordinates(
  shapes: readonly TracedShape[],
): CollectedCoordinates {
  const x: number[] = [];
  const y: number[] = [];
  const slices: ShapeCoordinateSlice[] = [];
  shapes.forEach((shape, shapeIndex) => {
    const points = shapeCoordinates(shape);
    const offset = x.length;
    for (const point of points) {
      x.push(point.x);
      y.push(point.y);
    }
    slices.push({ shapeIndex, offset, length: points.length });
  });
  return { x, y, slices };
}

function clusteredCoordinatesByShape(
  coordinates: CollectedCoordinates,
  tolerance: number,
): TracedPoint[][] {
  const clusteredX = clusteredValues(coordinates.x, tolerance);
  const clusteredY = clusteredValues(coordinates.y, tolerance);
  const result = Array.from(
    { length: coordinates.slices.length },
    (): TracedPoint[] => [],
  );
  for (const slice of coordinates.slices) {
    result[slice.shapeIndex] = Array.from(
      { length: slice.length },
      (_, localIndex) => ({
        x: clusteredX[slice.offset + localIndex],
        y: clusteredY[slice.offset + localIndex],
      }),
    );
  }
  return result;
}

function alignCoordinates(
  shapes: readonly TracedShape[],
  tolerance: number,
): TracedShape[] {
  const coordinates = collectCoordinates(shapes);
  const pointsByShape = clusteredCoordinatesByShape(coordinates, tolerance);

  return shapes.map((shape, shapeIndex): TracedShape => {
    const points = pointsByShape[shapeIndex];
    switch (shape.kind) {
      case 'polygon':
        return {
          ...shape,
          points,
          holes: shape.holes?.map((hole) => (
            hole.map((point) => ({ ...point }))
          )),
        };
      case 'polyline':
        return {
          ...shape,
          points,
        };
      case 'line': {
        const [first, second] = points;
        return {
          ...shape,
          x1: first.x,
          y1: first.y,
          x2: second.x,
          y2: second.y,
        };
      }
      case 'rect': {
        const [first, opposite] = points;
        if (!isAxisAlignedRect(shape)) {
          return { ...shape, x: first.x, y: first.y };
        }
        const width = opposite.x - first.x;
        const height = opposite.y - first.y;
        return {
          ...shape,
          x: width > 0 ? first.x : shape.x,
          y: height > 0 ? first.y : shape.y,
          width: width > 0 ? width : shape.width,
          height: height > 0 ? height : shape.height,
        };
      }
      case 'circle': {
        const [center] = points;
        return { ...shape, cx: center.x, cy: center.y };
      }
      case 'ellipse': {
        const [center] = points;
        return { ...shape, cx: center.x, cy: center.y };
      }
    }
  });
}

/**
 * Snaps near-cardinal directions, then clusters nearby x/y coordinates across
 * shapes. Input objects and point arrays are never mutated.
 */
export function alignShapes(
  shapes: readonly TracedShape[],
  options: AlignOptions = {},
): TracedShape[] {
  const angleTolerance = options.angleToleranceDeg
    ?? options.angleSnapDeg
    ?? 8;
  const angleStep = options.angleStepDeg ?? 45;
  const coordinateTolerance = options.coordinateTolerance
    ?? options.coordinateSnap
    ?? 0;
  if (
    !Number.isFinite(coordinateTolerance)
    || coordinateTolerance < 0
  ) {
    throw new RangeError('Coordinate snapping tolerance must be non-negative.');
  }
  const angleAligned = shapes.map((shape) => (
    alignShapeAngle(shape, angleTolerance, angleStep)
  ));
  return coordinateTolerance > 0
    ? alignCoordinates(angleAligned, coordinateTolerance)
    : angleAligned;
}
