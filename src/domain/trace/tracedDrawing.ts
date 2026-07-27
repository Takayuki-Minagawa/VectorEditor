/**
 * DOM- and Fabric-independent data exchanged by the image trace worker.
 *
 * Image-space coordinates use +x to the right and +y down. Pixel masks use
 * one byte per pixel: 1 is foreground and 0 is background.
 */

export const TRACED_DRAWING_VERSION = 1 as const;
export const MAX_TRACED_VERTICES = 250_000;

export interface TracedPoint {
  x: number;
  y: number;
}

export type TracedShape =
  | {
    kind: 'polygon';
    points: TracedPoint[];
    /** Interior rings rendered with an even-odd fill rule. */
    holes?: TracedPoint[][];
    closed: true;
  }
  | { kind: 'polyline'; points: TracedPoint[]; strokeWidth: number }
  | {
    kind: 'line';
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    strokeWidth: number;
  }
  | {
    kind: 'rect';
    x: number;
    y: number;
    width: number;
    height: number;
    angle: number;
  }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | {
    kind: 'ellipse';
    cx: number;
    cy: number;
    rx: number;
    ry: number;
    angle: number;
  };

export interface TracedDrawingStats {
  componentCount: number;
  vertexCount: number;
  droppedCount: number;
}

export interface TracedDrawing {
  version: typeof TRACED_DRAWING_VERSION;
  /** Pixel dimensions before optional preprocessing down-scaling. */
  sourceWidth: number;
  sourceHeight: number;
  shapes: TracedShape[];
  stats: TracedDrawingStats;
}

export interface BinaryImage {
  width: number;
  height: number;
  /** Row-major bytes. Values other than zero are treated as foreground. */
  data: Uint8Array;
}

export type TraceMode = 'faithful' | 'cleanup';
export type TraceThresholdMethod = 'otsu' | 'sauvola';

/**
 * Shared trace parameters. Keeping this shape independent of the worker
 * protocol makes the algorithms directly usable in tests and other workers.
 */
export interface TraceOptions {
  mode: TraceMode;
  thresholdMethod: TraceThresholdMethod;
  /** A fixed 0..255 threshold, or null to calculate one using the method. */
  threshold: number | null;
  maxDimension: number;
  minComponentArea: number;
  medianRadius: number;
  simplifyTolerance: number;
  forceCenterline: boolean;
  vertexLimit: number;
  /** Maximum deviation from a 45-degree direction that will be snapped. */
  angleSnapDeg: number;
  /** Maximum distance between coordinates that will be aligned; 0 disables. */
  coordinateSnap: number;
  sauvolaWindow: number;
  sauvolaK: number;
}

export const DEFAULT_TRACE_OPTIONS: Readonly<TraceOptions> = Object.freeze({
  mode: 'faithful',
  thresholdMethod: 'otsu',
  threshold: null,
  maxDimension: 2_000,
  minComponentArea: 8,
  medianRadius: 0,
  simplifyTolerance: 1.5,
  forceCenterline: false,
  vertexLimit: 100_000,
  angleSnapDeg: 8,
  coordinateSnap: 3,
  sauvolaWindow: 25,
  sauvolaK: 0.2,
});

export function isTraceOptions(value: unknown): value is TraceOptions {
  if (!isRecord(value)) return false;
  return (
    (value.mode === 'faithful' || value.mode === 'cleanup')
    && (value.thresholdMethod === 'otsu' || value.thresholdMethod === 'sauvola')
    && (
      value.threshold === null
      || (
        isFiniteNumber(value.threshold)
        && value.threshold >= 0
        && value.threshold <= 255
      )
    )
    && isPositiveInteger(value.maxDimension)
    && isNonNegativeInteger(value.minComponentArea)
    && isNonNegativeInteger(value.medianRadius)
    && value.medianRadius <= 8
    && isFiniteNumber(value.simplifyTolerance)
    && value.simplifyTolerance >= 0
    && typeof value.forceCenterline === 'boolean'
    && isPositiveInteger(value.vertexLimit)
    && value.vertexLimit <= MAX_TRACED_VERTICES
    && isFiniteNumber(value.angleSnapDeg)
    && value.angleSnapDeg >= 0
    && value.angleSnapDeg <= 22.5
    && isFiniteNumber(value.coordinateSnap)
    && value.coordinateSnap >= 0
    && isPositiveInteger(value.sauvolaWindow)
    && value.sauvolaWindow >= 3
    && value.sauvolaWindow % 2 === 1
    && isFiniteNumber(value.sauvolaK)
    && value.sauvolaK >= -1
    && value.sauvolaK <= 1
  );
}

export function normalizeTraceOptions(
  options: Partial<TraceOptions> = {},
): TraceOptions {
  const merged = { ...DEFAULT_TRACE_OPTIONS, ...options };
  const sauvolaWindow = Math.max(3, Math.round(finiteOr(
    merged.sauvolaWindow,
    DEFAULT_TRACE_OPTIONS.sauvolaWindow,
  )));
  const vertexLimit = Math.max(1, Math.round(finiteOr(
    merged.vertexLimit,
    DEFAULT_TRACE_OPTIONS.vertexLimit,
  )));

  return {
    mode: merged.mode === 'cleanup' ? 'cleanup' : 'faithful',
    thresholdMethod: merged.thresholdMethod === 'sauvola' ? 'sauvola' : 'otsu',
    threshold: merged.threshold === null
      ? null
      : clamp(finiteOr(merged.threshold, 128), 0, 255),
    maxDimension: Math.max(1, Math.round(finiteOr(
      merged.maxDimension,
      DEFAULT_TRACE_OPTIONS.maxDimension,
    ))),
    minComponentArea: Math.max(0, Math.round(finiteOr(
      merged.minComponentArea,
      DEFAULT_TRACE_OPTIONS.minComponentArea,
    ))),
    medianRadius: Math.max(0, Math.min(8, Math.round(finiteOr(
      merged.medianRadius,
      DEFAULT_TRACE_OPTIONS.medianRadius,
    )))),
    simplifyTolerance: Math.max(0, finiteOr(
      merged.simplifyTolerance,
      DEFAULT_TRACE_OPTIONS.simplifyTolerance,
    )),
    forceCenterline: Boolean(merged.forceCenterline),
    vertexLimit: Math.min(MAX_TRACED_VERTICES, vertexLimit),
    angleSnapDeg: clamp(
      finiteOr(merged.angleSnapDeg, DEFAULT_TRACE_OPTIONS.angleSnapDeg),
      0,
      22.5,
    ),
    coordinateSnap: Math.max(0, finiteOr(
      merged.coordinateSnap,
      DEFAULT_TRACE_OPTIONS.coordinateSnap,
    )),
    sauvolaWindow: sauvolaWindow % 2 === 0 ? sauvolaWindow + 1 : sauvolaWindow,
    sauvolaK: clamp(
      finiteOr(merged.sauvolaK, DEFAULT_TRACE_OPTIONS.sauvolaK),
      -1,
      1,
    ),
  };
}

export type TracedDrawingValidationIssueCode =
  | 'invalid-drawing'
  | 'unsupported-version'
  | 'invalid-source-size'
  | 'invalid-shapes'
  | 'invalid-shape'
  | 'too-few-points'
  | 'non-finite-coordinate'
  | 'coordinate-out-of-range'
  | 'invalid-dimension'
  | 'invalid-stroke-width'
  | 'invalid-stats'
  | 'vertex-limit-exceeded';

export interface TracedDrawingValidationIssue {
  code: TracedDrawingValidationIssueCode;
  message: string;
  shapeIndex?: number;
  pointIndex?: number;
}

export interface TracedDrawingValidationResult {
  valid: boolean;
  issues: TracedDrawingValidationIssue[];
}

export class TracedDrawingValidationError extends Error {
  readonly issues: TracedDrawingValidationIssue[];

  constructor(issues: TracedDrawingValidationIssue[]) {
    super(issues.map((issue) => issue.message).join('; '));
    this.name = 'TracedDrawingValidationError';
    this.issues = issues;
  }
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function validatePoint(
  value: unknown,
  sourceWidth: number,
  sourceHeight: number,
  shapeIndex: number,
  pointIndex: number,
  issues: TracedDrawingValidationIssue[],
): value is TracedPoint {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
    issues.push({
      code: 'non-finite-coordinate',
      message: `Shape ${shapeIndex} point ${pointIndex} must contain finite coordinates.`,
      shapeIndex,
      pointIndex,
    });
    return false;
  }

  const coordinateEpsilon = Number.EPSILON
    * Math.max(1, sourceWidth, sourceHeight)
    * 16;
  if (
    value.x < -coordinateEpsilon
    || value.x > sourceWidth + coordinateEpsilon
    || value.y < -coordinateEpsilon
    || value.y > sourceHeight + coordinateEpsilon
  ) {
    issues.push({
      code: 'coordinate-out-of-range',
      message: `Shape ${shapeIndex} point ${pointIndex} lies outside the source image.`,
      shapeIndex,
      pointIndex,
    });
  }
  return true;
}

function validatePositive(
  value: unknown,
  code: 'invalid-dimension' | 'invalid-stroke-width',
  label: string,
  shapeIndex: number,
  issues: TracedDrawingValidationIssue[],
): value is number {
  if (!isFiniteNumber(value) || value <= 0) {
    issues.push({
      code,
      message: `Shape ${shapeIndex} ${label} must be a positive finite number.`,
      shapeIndex,
    });
    return false;
  }
  return true;
}

function validateAnchor(
  x: unknown,
  y: unknown,
  sourceWidth: number,
  sourceHeight: number,
  shapeIndex: number,
  pointIndex: number,
  issues: TracedDrawingValidationIssue[],
): void {
  validatePoint({ x, y }, sourceWidth, sourceHeight, shapeIndex, pointIndex, issues);
}

function validateShape(
  value: unknown,
  sourceWidth: number,
  sourceHeight: number,
  shapeIndex: number,
  issues: TracedDrawingValidationIssue[],
): number {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    issues.push({
      code: 'invalid-shape',
      message: `Shape ${shapeIndex} is not a supported trace shape.`,
      shapeIndex,
    });
    return 0;
  }

  switch (value.kind) {
    case 'polygon':
    case 'polyline': {
      if (!Array.isArray(value.points)) {
        issues.push({
          code: 'invalid-shape',
          message: `Shape ${shapeIndex} points must be an array.`,
          shapeIndex,
        });
        return 0;
      }
      const minimum = value.kind === 'polygon' ? 3 : 2;
      if (value.points.length < minimum) {
        issues.push({
          code: 'too-few-points',
          message: `Shape ${shapeIndex} requires at least ${minimum} points.`,
          shapeIndex,
        });
      }
      value.points.forEach((point, pointIndex) => {
        validatePoint(
          point,
          sourceWidth,
          sourceHeight,
          shapeIndex,
          pointIndex,
          issues,
        );
      });
      if (value.kind === 'polygon' && value.closed !== true) {
        issues.push({
          code: 'invalid-shape',
          message: `Shape ${shapeIndex} polygon must be closed.`,
          shapeIndex,
        });
      }
      let vertexCount = value.points.length;
      if (value.kind === 'polygon' && value.holes !== undefined) {
        if (!Array.isArray(value.holes)) {
          issues.push({
            code: 'invalid-shape',
            message: `Shape ${shapeIndex} polygon holes must be an array.`,
            shapeIndex,
          });
        } else {
          let flattenedPointIndex = value.points.length;
          value.holes.forEach((hole, holeIndex) => {
            if (!Array.isArray(hole)) {
              issues.push({
                code: 'invalid-shape',
                message: `Shape ${shapeIndex} hole ${holeIndex} must be an array.`,
                shapeIndex,
              });
              return;
            }
            if (hole.length < 3) {
              issues.push({
                code: 'too-few-points',
                message: `Shape ${shapeIndex} hole ${holeIndex} requires at least 3 points.`,
                shapeIndex,
              });
            }
            hole.forEach((point) => {
              validatePoint(
                point,
                sourceWidth,
                sourceHeight,
                shapeIndex,
                flattenedPointIndex,
                issues,
              );
              flattenedPointIndex += 1;
            });
            vertexCount += hole.length;
          });
        }
      } else if (value.kind === 'polyline') {
        validatePositive(
          value.strokeWidth,
          'invalid-stroke-width',
          'stroke width',
          shapeIndex,
          issues,
        );
      }
      return vertexCount;
    }
    case 'line':
      validateAnchor(
        value.x1,
        value.y1,
        sourceWidth,
        sourceHeight,
        shapeIndex,
        0,
        issues,
      );
      validateAnchor(
        value.x2,
        value.y2,
        sourceWidth,
        sourceHeight,
        shapeIndex,
        1,
        issues,
      );
      validatePositive(
        value.strokeWidth,
        'invalid-stroke-width',
        'stroke width',
        shapeIndex,
        issues,
      );
      if (
        isFiniteNumber(value.x1)
        && isFiniteNumber(value.y1)
        && isFiniteNumber(value.x2)
        && isFiniteNumber(value.y2)
        && value.x1 === value.x2
        && value.y1 === value.y2
      ) {
        issues.push({
          code: 'invalid-dimension',
          message: `Shape ${shapeIndex} line must have non-zero length.`,
          shapeIndex,
        });
      }
      return 2;
    case 'rect':
      validateAnchor(
        value.x,
        value.y,
        sourceWidth,
        sourceHeight,
        shapeIndex,
        0,
        issues,
      );
      {
        const width = value.width;
        const height = value.height;
        const validWidth = validatePositive(
          width,
          'invalid-dimension',
          'width',
          shapeIndex,
          issues,
        );
        const validHeight = validatePositive(
          height,
          'invalid-dimension',
          'height',
          shapeIndex,
          issues,
        );
        if (
          !isFiniteNumber(value.angle)
          || !isFiniteNumber(value.x)
          || !isFiniteNumber(value.y)
        ) {
          if (!isFiniteNumber(value.angle)) {
            issues.push({
              code: 'non-finite-coordinate',
              message: `Shape ${shapeIndex} angle must be finite.`,
              shapeIndex,
            });
          }
        } else if (validWidth && validHeight) {
          const radians = value.angle * Math.PI / 180;
          const ux = Math.cos(radians);
          const uy = Math.sin(radians);
          const vx = -uy;
          const vy = ux;
          [
            {
              x: value.x + ux * width,
              y: value.y + uy * width,
            },
            {
              x: value.x + vx * height,
              y: value.y + vy * height,
            },
            {
              x: value.x + ux * width + vx * height,
              y: value.y + uy * width + vy * height,
            },
          ].forEach((point, pointIndex) => {
            validatePoint(
              point,
              sourceWidth,
              sourceHeight,
              shapeIndex,
              pointIndex + 1,
              issues,
            );
          });
        }
      }
      return 4;
    case 'circle':
      validateAnchor(
        value.cx,
        value.cy,
        sourceWidth,
        sourceHeight,
        shapeIndex,
        0,
        issues,
      );
      if (
        validatePositive(value.r, 'invalid-dimension', 'radius', shapeIndex, issues)
        && isFiniteNumber(value.cx)
        && isFiniteNumber(value.cy)
      ) {
        [
          { x: value.cx - value.r, y: value.cy },
          { x: value.cx + value.r, y: value.cy },
          { x: value.cx, y: value.cy - value.r },
          { x: value.cx, y: value.cy + value.r },
        ].forEach((point, pointIndex) => {
          validatePoint(
            point,
            sourceWidth,
            sourceHeight,
            shapeIndex,
            pointIndex + 1,
            issues,
          );
        });
      }
      return 4;
    case 'ellipse':
      validateAnchor(
        value.cx,
        value.cy,
        sourceWidth,
        sourceHeight,
        shapeIndex,
        0,
        issues,
      );
      {
        const rx = value.rx;
        const ry = value.ry;
        const validRx = validatePositive(
          rx,
          'invalid-dimension',
          'x radius',
          shapeIndex,
          issues,
        );
        const validRy = validatePositive(
          ry,
          'invalid-dimension',
          'y radius',
          shapeIndex,
          issues,
        );
        if (!isFiniteNumber(value.angle)) {
          issues.push({
            code: 'non-finite-coordinate',
            message: `Shape ${shapeIndex} angle must be finite.`,
            shapeIndex,
          });
        } else if (
          validRx
          && validRy
          && isFiniteNumber(value.cx)
          && isFiniteNumber(value.cy)
        ) {
          const radians = value.angle * Math.PI / 180;
          const cos = Math.cos(radians);
          const sin = Math.sin(radians);
          const extentX = Math.hypot(rx * cos, ry * sin);
          const extentY = Math.hypot(rx * sin, ry * cos);
          [
            { x: value.cx - extentX, y: value.cy },
            { x: value.cx + extentX, y: value.cy },
            { x: value.cx, y: value.cy - extentY },
            { x: value.cx, y: value.cy + extentY },
          ].forEach((point, pointIndex) => {
            validatePoint(
              point,
              sourceWidth,
              sourceHeight,
              shapeIndex,
              pointIndex + 1,
              issues,
            );
          });
        }
      }
      return 4;
    default:
      issues.push({
        code: 'invalid-shape',
        message: `Shape ${shapeIndex} has an unsupported kind.`,
        shapeIndex,
      });
      return 0;
  }
}

export function validateTracedDrawing(
  value: unknown,
  maxVertices = MAX_TRACED_VERTICES,
): TracedDrawingValidationResult {
  const issues: TracedDrawingValidationIssue[] = [];
  if (!isRecord(value)) {
    return {
      valid: false,
      issues: [{
        code: 'invalid-drawing',
        message: 'Traced drawing must be an object.',
      }],
    };
  }

  if (value.version !== TRACED_DRAWING_VERSION) {
    issues.push({
      code: 'unsupported-version',
      message: `Only traced drawing version ${TRACED_DRAWING_VERSION} is supported.`,
    });
  }

  const validSourceSize = Number.isInteger(value.sourceWidth)
    && isFiniteNumber(value.sourceWidth)
    && value.sourceWidth > 0
    && Number.isInteger(value.sourceHeight)
    && isFiniteNumber(value.sourceHeight)
    && value.sourceHeight > 0;
  if (!validSourceSize) {
    issues.push({
      code: 'invalid-source-size',
      message: 'Source dimensions must be positive integers.',
    });
  }
  const sourceWidth = validSourceSize ? value.sourceWidth as number : 0;
  const sourceHeight = validSourceSize ? value.sourceHeight as number : 0;

  let vertexCount = 0;
  if (!Array.isArray(value.shapes)) {
    issues.push({
      code: 'invalid-shapes',
      message: 'Traced drawing shapes must be an array.',
    });
  } else {
    value.shapes.forEach((shape, shapeIndex) => {
      vertexCount += validateShape(
        shape,
        sourceWidth,
        sourceHeight,
        shapeIndex,
        issues,
      );
    });
  }

  if (vertexCount > maxVertices) {
    issues.push({
      code: 'vertex-limit-exceeded',
      message: `Traced drawing contains ${vertexCount} vertices; limit is ${maxVertices}.`,
    });
  }

  if (
    !isRecord(value.stats)
    || !Number.isInteger(value.stats.componentCount)
    || !isFiniteNumber(value.stats.componentCount)
    || value.stats.componentCount < 0
    || !Number.isInteger(value.stats.vertexCount)
    || !isFiniteNumber(value.stats.vertexCount)
    || value.stats.vertexCount < 0
    || !Number.isInteger(value.stats.droppedCount)
    || !isFiniteNumber(value.stats.droppedCount)
    || value.stats.droppedCount < 0
  ) {
    issues.push({
      code: 'invalid-stats',
      message: 'Trace statistics must contain non-negative integer counts.',
    });
  }

  return { valid: issues.length === 0, issues };
}

export function isTracedDrawing(value: unknown): value is TracedDrawing {
  return validateTracedDrawing(value).valid;
}

export function assertValidTracedDrawing(
  value: unknown,
  maxVertices = MAX_TRACED_VERTICES,
): asserts value is TracedDrawing {
  const result = validateTracedDrawing(value, maxVertices);
  if (!result.valid) throw new TracedDrawingValidationError(result.issues);
}
