import { alignShapes } from '../domain/trace/align';
import {
  classifyShape,
  computeShapeFeatures,
  minimumAreaBounds,
  type OrientedBounds,
} from '../domain/trace/classify';
import {
  ConnectedComponentLimitError,
  ContourBoundaryEdgeLimitError,
  extractContours,
  labelConnectedComponents,
  type ConnectedComponentsResult,
  type Contour,
} from '../domain/trace/contour';
import { preprocessImage } from '../domain/trace/preprocess';
import { simplifyPolyline } from '../domain/trace/simplify';
import {
  extractCenterlines,
  zhangSuenThinning,
  type Centerline,
} from '../domain/trace/thinning';
import {
  DEFAULT_TRACED_PRIMITIVE_STROKE_WIDTH,
  MIN_TRACED_STROKE_WIDTH,
  assertValidTracedDrawing,
  type TracedDrawing,
  type TracedPoint,
  type TracedShape,
} from '../domain/trace/tracedDrawing';
import {
  isTraceWorkerRequest,
  type TraceErrorCode,
  type TraceFailureResponse,
  type TraceOptions,
  type TraceProgressStage,
  type TraceResponse,
  type TraceWorkerRequest,
} from './traceProtocol';

export interface TracePipelineCallbacks {
  onProgress?: (stage: TraceProgressStage, progress: number) => void;
  isCancelled?: () => boolean;
  /**
   * Injected by tests when deterministic scheduling is needed. The default
   * yields to the Worker event loop so a queued `cancel` message can run.
   */
  yieldControl?: () => Promise<void>;
}

export interface TraceCandidate {
  points: TracedPoint[];
  holes?: TracedPoint[][];
  closed: boolean;
  strokeWidth?: number;
  source: 'contour' | 'centerline';
  componentId?: number;
}

export interface SimplifiedTraceContour {
  componentId: number;
  points: TracedPoint[];
  isHole: boolean;
  area: number;
}

export interface OuterContourCandidate extends TraceCandidate {
  source: 'contour';
  componentId: number;
  area: number;
  holes: TracedPoint[][];
  holeAreas: number[];
}

const MIN_RAW_BOUNDARY_EDGES = 4_096;
const MAX_RAW_BOUNDARY_EDGES = 500_000;
const RAW_BOUNDARY_EDGE_SAFETY_FACTOR = 4;

function rawBoundaryEdgeLimit(options: TraceOptions): number {
  return Math.min(
    MAX_RAW_BOUNDARY_EDGES,
    Math.max(
      MIN_RAW_BOUNDARY_EDGES,
      options.vertexLimit * RAW_BOUNDARY_EDGE_SAFETY_FACTOR,
    ),
  );
}

export class TracePipelineError extends Error {
  readonly code: TraceErrorCode;

  constructor(code: TraceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TracePipelineError';
    this.code = code;
  }
}

function yieldToWorker(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function throwIfCancelled(callbacks: TracePipelineCallbacks): void {
  if (callbacks.isCancelled?.()) {
    throw new TracePipelineError('CANCELLED', 'Image tracing was cancelled.');
  }
}

async function checkpoint(
  callbacks: TracePipelineCallbacks,
  stage: TraceProgressStage,
  progress: number,
): Promise<void> {
  throwIfCancelled(callbacks);
  callbacks.onProgress?.(stage, progress);
  await (callbacks.yieldControl ?? yieldToWorker)();
  throwIfCancelled(callbacks);
}

function pointOnSegment(
  point: TracedPoint,
  start: TracedPoint,
  end: TracedPoint,
): boolean {
  const cross = (
    (point.x - start.x) * (end.y - start.y)
    - (point.y - start.y) * (end.x - start.x)
  );
  if (Math.abs(cross) > 1e-9) return false;
  return point.x >= Math.min(start.x, end.x) - 1e-9
    && point.x <= Math.max(start.x, end.x) + 1e-9
    && point.y >= Math.min(start.y, end.y) - 1e-9
    && point.y <= Math.max(start.y, end.y) + 1e-9;
}

function pointInPolygon(point: TracedPoint, polygon: readonly TracedPoint[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1) {
    const start = polygon[previous];
    const end = polygon[index];
    if (pointOnSegment(point, start, end)) return true;
    const crossesScanline = (start.y > point.y) !== (end.y > point.y);
    if (!crossesScanline) continue;
    const intersectionX = (
      (end.x - start.x) * (point.y - start.y) / (end.y - start.y)
      + start.x
    );
    if (point.x < intersectionX) inside = !inside;
  }
  return inside;
}

export function groupContourCandidates(
  contours: readonly SimplifiedTraceContour[],
): { candidates: OuterContourCandidate[]; orphanHoleCount: number } {
  const candidates: OuterContourCandidate[] = contours
    .filter((contour) => !contour.isHole)
    .map((contour) => ({
      points: contour.points,
      holes: [],
      closed: true,
      source: 'contour',
      componentId: contour.componentId,
      area: contour.area,
      holeAreas: [],
    }));
  const candidatesByComponent = new Map<number, OuterContourCandidate[]>();
  for (const candidate of candidates) {
    const componentCandidates = candidatesByComponent.get(candidate.componentId);
    if (componentCandidates) componentCandidates.push(candidate);
    else candidatesByComponent.set(candidate.componentId, [candidate]);
  }
  let orphanHoleCount = 0;

  for (const hole of contours) {
    if (!hole.isHole) continue;
    let containingParent: OuterContourCandidate | undefined;
    let areaFallback: OuterContourCandidate | undefined;
    for (const candidate of candidatesByComponent.get(hole.componentId) ?? []) {
      if (pointInPolygon(hole.points[0], candidate.points)
          && (!containingParent || candidate.area < containingParent.area)) {
        containingParent = candidate;
      }
      if (candidate.area > hole.area
          && (!areaFallback || candidate.area < areaFallback.area)) {
        areaFallback = candidate;
      }
    }
    const parent = containingParent ?? areaFallback;
    if (parent) {
      parent.holes.push(hole.points);
      parent.holeAreas.push(hole.area);
    }
    else orphanHoleCount += 1;
  }

  return { candidates, orphanHoleCount };
}

function lineLikeComponentIds(contours: Contour[]): Set<number> {
  const primaryByComponent = new Map<number, Contour>();
  for (const contour of contours) {
    if (contour.isHole) continue;
    const previous = primaryByComponent.get(contour.componentId);
    if (!previous || Math.abs(contour.area) > Math.abs(previous.area)) {
      primaryByComponent.set(contour.componentId, contour);
    }
  }

  const result = new Set<number>();
  for (const [componentId, contour] of primaryByComponent) {
    if (contour.points.length === 0) continue;
    const bounds = minimumAreaBounds(contour.points);
    const major = Math.max(bounds.width, bounds.height);
    const minor = Math.max(1, Math.min(bounds.width, bounds.height));
    const aspectRatio = major / minor;
    if (aspectRatio >= 6) result.add(componentId);
  }
  return result;
}

export function componentIdAtPoint(
  point: TracedPoint,
  labeling: ConnectedComponentsResult,
  width: number,
  height: number,
): number {
  if (!Number.isFinite(point.x)
      || !Number.isFinite(point.y)
      || width <= 0
      || height <= 0) {
    return 0;
  }
  // Centerlines use pixel-centre coordinates (x + 0.5, y + 0.5). Flooring
  // selects that pixel; rounding would incorrectly move it to the next cell.
  const centerX = Math.max(0, Math.min(width - 1, Math.floor(point.x)));
  const centerY = Math.max(0, Math.min(height - 1, Math.floor(point.y)));
  for (let radius = 0; radius <= 1; radius += 1) {
    for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        const x = centerX + offsetX;
        const y = centerY + offsetY;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const componentId = labeling.labels[y * width + x] ?? 0;
        if (componentId > 0) return componentId;
      }
    }
  }
  return 0;
}

function centerlineComponentId(
  centerline: Centerline,
  componentIds: Set<number>,
  labeling: ConnectedComponentsResult,
  width: number,
  height: number,
): number {
  if (componentIds.size === 0) return 0;
  const stride = Math.max(1, Math.floor(centerline.points.length / 8));
  for (let index = 0; index < centerline.points.length; index += stride) {
    const componentId = componentIdAtPoint(
      centerline.points[index],
      labeling,
      width,
      height,
    );
    if (componentIds.has(componentId)) return componentId;
  }
  return 0;
}

function samePoint(left: TracedPoint, right: TracedPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function withoutDuplicateClosingPoint(points: TracedPoint[]): TracedPoint[] {
  if (points.length > 1 && samePoint(points[0], points[points.length - 1])) {
    return points.slice(0, -1);
  }
  return points;
}

function closedBoundaryLength(points: readonly TracedPoint[]): number {
  let length = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    length += Math.hypot(next.x - current.x, next.y - current.y);
  }
  return length;
}

export function estimateOutlinedStrokeWidth(
  candidate: OuterContourCandidate,
): number {
  if (candidate.holes.length === 0) {
    return DEFAULT_TRACED_PRIMITIVE_STROKE_WIDTH;
  }
  const inkArea = candidate.area
    - candidate.holeAreas.reduce((total, area) => total + area, 0);
  const totalBoundaryLength = closedBoundaryLength(candidate.points)
    + candidate.holes.reduce(
      (total, hole) => total + closedBoundaryLength(hole),
      0,
    );
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of candidate.points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const maximumStrokeWidth = Math.max(
    MIN_TRACED_STROKE_WIDTH,
    Math.min(
      maxX - minX,
      maxY - minY,
    ),
  );
  const estimated = 2 * inkArea / totalBoundaryLength;
  if (!Number.isFinite(estimated) || estimated <= 0) {
    return Math.min(
      DEFAULT_TRACED_PRIMITIVE_STROKE_WIDTH,
      maximumStrokeWidth,
    );
  }
  return clamp(
    estimated,
    MIN_TRACED_STROKE_WIDTH,
    maximumStrokeWidth,
  );
}

type CleanupPrimitiveShape = Extract<
  TracedShape,
  { kind: 'rect' | 'circle' | 'ellipse' }
>;

function isCleanupPrimitive(shape: TracedShape): shape is CleanupPrimitiveShape {
  return shape.kind === 'rect'
    || shape.kind === 'circle'
    || shape.kind === 'ellipse';
}

function primitiveCenter(
  shape: CleanupPrimitiveShape,
): { center: TracedPoint; minimumDimension: number } {
  if (shape.kind === 'rect') {
    const radians = shape.angle * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
      center: {
        x: shape.x + cos * shape.width / 2 - sin * shape.height / 2,
        y: shape.y + sin * shape.width / 2 + cos * shape.height / 2,
      },
      minimumDimension: Math.min(shape.width, shape.height),
    };
  }
  if (shape.kind === 'circle') {
    return {
      center: { x: shape.cx, y: shape.cy },
      minimumDimension: shape.r * 2,
    };
  }
  return {
    center: { x: shape.cx, y: shape.cy },
    minimumDimension: Math.min(shape.rx, shape.ry) * 2,
  };
}

function halfTurnAngularDifference(left: number, right: number): number {
  const difference = Math.abs((((left - right) % 180) + 180) % 180);
  return Math.min(difference, 180 - difference);
}

function alignBoundsAxes(
  outerAngle: number,
  inner: OrientedBounds,
): { width: number; height: number; orientationError: number } {
  const difference = halfTurnAngularDifference(outerAngle, inner.angle);
  if (difference <= 45) {
    return {
      width: inner.width,
      height: inner.height,
      orientationError: difference,
    };
  }
  return {
    width: inner.height,
    height: inner.width,
    orientationError: 90 - difference,
  };
}

function uniformOutlineGap(
  outerWidth: number,
  outerHeight: number,
  innerWidth: number,
  innerHeight: number,
  strokeWidth: number,
  tolerance: number,
): boolean {
  const horizontalGap = (outerWidth - innerWidth) / 2;
  const verticalGap = (outerHeight - innerHeight) / 2;
  if (horizontalGap <= 0 || verticalGap <= 0) return false;
  const meanGap = (horizontalGap + verticalGap) / 2;
  return Math.abs(horizontalGap - verticalGap) <= tolerance
    && Math.abs(meanGap - strokeWidth) <= tolerance;
}

/**
 * A hole-bearing contour can be represented by one stroked primitive only
 * when its negative space is a matching, near-concentric inset. Ambiguous
 * shapes deliberately stay compound polygons so no hole topology is lost.
 */
function isCompatibleOutlinedPrimitive(
  candidate: OuterContourCandidate,
  outer: CleanupPrimitiveShape,
  strokeWidth: number,
  simplifyTolerance: number,
): boolean {
  if (candidate.holes.length !== 1 || candidate.holeAreas.length !== 1) {
    return false;
  }
  const [hole] = candidate.holes;
  if (hole.length < 3) return false;
  const holeFeatures = computeShapeFeatures(hole);
  const outerGeometry = primitiveCenter(outer);
  const noiseTolerance = clamp(
    Math.max(1.5, simplifyTolerance),
    1.5,
    3,
  );
  const centerTolerance = Math.max(
    noiseTolerance,
    Math.min(
      outerGeometry.minimumDimension * 0.08,
      strokeWidth * 0.35,
    ),
  );
  if (Math.hypot(
    holeFeatures.centroid.x - outerGeometry.center.x,
    holeFeatures.centroid.y - outerGeometry.center.y,
  ) > centerTolerance) {
    return false;
  }
  const gapTolerance = Math.max(noiseTolerance, strokeWidth * 0.35);

  if (outer.kind === 'rect') {
    // A true rectangular inset remains box-like. This rejects circular or
    // irregular cut-outs that happen to share the same bounding box.
    if (
      holeFeatures.convexity < 0.85
      || holeFeatures.fillRatio < 0.75
      || (
        hole.length > 4
        && holeFeatures.ellipseError < 0.28
      )
    ) {
      return false;
    }
    const aligned = alignBoundsAxes(outer.angle, holeFeatures.orientedBounds);
    return aligned.orientationError <= 12
      && uniformOutlineGap(
        outer.width,
        outer.height,
        aligned.width,
        aligned.height,
        strokeWidth,
        gapTolerance,
      );
  }

  // Curved primitives need a convex ellipse-like inner boundary. Five points
  // are enough for a rasterized small circle while excluding a square hole.
  if (
    hole.length < 5
    || holeFeatures.convexity < 0.85
    || holeFeatures.ellipseError > 0.32
  ) {
    return false;
  }
  if (outer.kind === 'circle') {
    if (holeFeatures.aspectRatio > 1.3) return false;
    const innerRadius = Math.sqrt(holeFeatures.area / Math.PI);
    const gap = outer.r - innerRadius;
    return gap > 0 && Math.abs(gap - strokeWidth) <= gapTolerance;
  }

  const aligned = alignBoundsAxes(outer.angle, holeFeatures.orientedBounds);
  const outerAspectRatio = Math.max(outer.rx, outer.ry)
    / Math.min(outer.rx, outer.ry);
  const requireOrientation = outerAspectRatio > 1.15
    && holeFeatures.aspectRatio > 1.15;
  return (!requireOrientation || aligned.orientationError <= 12)
    && uniformOutlineGap(
      outer.rx * 2,
      outer.ry * 2,
      aligned.width,
      aligned.height,
      strokeWidth,
      gapTolerance,
    );
}

export function centerOutlinedPrimitiveGeometry(
  shape: TracedShape,
  strokeWidth: number,
): TracedShape | null {
  const halfStrokeWidth = strokeWidth / 2;
  switch (shape.kind) {
    case 'rect': {
      const width = shape.width - strokeWidth;
      const height = shape.height - strokeWidth;
      if (width <= 0 || height <= 0) return null;
      const radians = shape.angle * Math.PI / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      return {
        ...shape,
        x: shape.x + halfStrokeWidth * (cos - sin),
        y: shape.y + halfStrokeWidth * (sin + cos),
        width,
        height,
      };
    }
    case 'circle': {
      const r = shape.r - halfStrokeWidth;
      return r > 0 ? { ...shape, r } : null;
    }
    case 'ellipse': {
      const rx = shape.rx - halfStrokeWidth;
      const ry = shape.ry - halfStrokeWidth;
      return rx > 0 && ry > 0 ? { ...shape, rx, ry } : null;
    }
    default:
      return null;
  }
}

function pointToSegmentDistance(
  point: TracedPoint,
  start: TracedPoint,
  end: TracedPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const projection = Math.max(0, Math.min(
    1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
  ));
  return Math.hypot(
    point.x - (start.x + projection * dx),
    point.y - (start.y + projection * dy),
  );
}

function centerlineShape(candidate: TraceCandidate, options: TraceOptions): TracedShape {
  const points = candidate.closed
    && !samePoint(candidate.points[0], candidate.points[candidate.points.length - 1])
    ? [...candidate.points, { ...candidate.points[0] }]
    : candidate.points;
  const strokeWidth = Math.max(0.5, candidate.strokeWidth ?? 1);
  if (options.mode === 'cleanup' && !candidate.closed && points.length >= 2) {
    const start = points[0];
    const end = points[points.length - 1];
    const straightnessTolerance = Math.max(1, options.simplifyTolerance * 2);
    if (points.every((point) => (
      pointToSegmentDistance(point, start, end) <= straightnessTolerance
    ))) {
      return {
        kind: 'line',
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        strokeWidth,
      };
    }
  }
  return { kind: 'polyline', points, strokeWidth };
}

function shapeVertexCount(shape: TracedShape): number {
  switch (shape.kind) {
    case 'polygon':
      return shape.points.length
        + (shape.holes?.reduce((total, hole) => total + hole.length, 0) ?? 0);
    case 'polyline':
      return shape.points.length;
    case 'line':
      return 2;
    case 'rect':
    case 'circle':
    case 'ellipse':
      return 4;
  }
}

function scaleShape(shape: TracedShape, scaleX: number, scaleY: number): TracedShape {
  const strokeScale = (scaleX + scaleY) / 2;
  switch (shape.kind) {
    case 'polygon':
      return {
        ...shape,
        points: shape.points.map((point) => ({
          x: point.x * scaleX,
          y: point.y * scaleY,
        })),
        holes: shape.holes?.map((hole) => hole.map((point) => ({
          x: point.x * scaleX,
          y: point.y * scaleY,
        }))),
      };
    case 'polyline':
      return {
        ...shape,
        points: shape.points.map((point) => ({
          x: point.x * scaleX,
          y: point.y * scaleY,
        })),
        strokeWidth: shape.strokeWidth * strokeScale,
      };
    case 'line':
      return {
        ...shape,
        x1: shape.x1 * scaleX,
        y1: shape.y1 * scaleY,
        x2: shape.x2 * scaleX,
        y2: shape.y2 * scaleY,
        strokeWidth: shape.strokeWidth * strokeScale,
      };
    case 'rect':
      return {
        ...shape,
        x: shape.x * scaleX,
        y: shape.y * scaleY,
        width: shape.width * scaleX,
        height: shape.height * scaleY,
        ...(shape.strokeWidth === undefined
          ? {}
          : { strokeWidth: shape.strokeWidth * strokeScale }),
      };
    case 'circle':
      return {
        ...shape,
        cx: shape.cx * scaleX,
        cy: shape.cy * scaleY,
        r: shape.r * strokeScale,
        ...(shape.strokeWidth === undefined
          ? {}
          : { strokeWidth: shape.strokeWidth * strokeScale }),
      };
    case 'ellipse':
      return {
        ...shape,
        cx: shape.cx * scaleX,
        cy: shape.cy * scaleY,
        rx: shape.rx * scaleX,
        ry: shape.ry * scaleY,
        ...(shape.strokeWidth === undefined
          ? {}
          : { strokeWidth: shape.strokeWidth * strokeScale }),
      };
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function sanitizePoints(
  points: readonly TracedPoint[],
  width: number,
  height: number,
  keepClosingPoint = false,
): TracedPoint[] {
  const result: TracedPoint[] = [];
  for (const point of points) {
    const next = {
      x: clamp(point.x, 0, width),
      y: clamp(point.y, 0, height),
    };
    const previous = result[result.length - 1];
    if (!previous || !samePoint(previous, next)) result.push(next);
  }
  return keepClosingPoint ? result : withoutDuplicateClosingPoint(result);
}

type PrimitiveShape = Extract<
  TracedShape,
  { kind: 'rect' | 'circle' | 'ellipse' }
>;

function sanitizePrimitiveStrokeWidth<Shape extends PrimitiveShape>(
  shape: Shape,
  width: number,
  height: number,
): Shape | null {
  if (shape.strokeWidth === undefined) return shape;
  if (!Number.isFinite(shape.strokeWidth)) return null;
  return {
    ...shape,
    strokeWidth: clamp(
      shape.strokeWidth,
      MIN_TRACED_STROKE_WIDTH,
      Math.max(width, height),
    ),
  };
}

function effectivePrimitiveStrokeWidth(shape: PrimitiveShape): number {
  return shape.strokeWidth ?? DEFAULT_TRACED_PRIMITIVE_STROKE_WIDTH;
}

function renderedRectBounds(
  shape: Extract<TracedShape, { kind: 'rect' }>,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const radians = shape.angle * Math.PI / 180;
  const ux = Math.cos(radians);
  const uy = Math.sin(radians);
  const vx = -uy;
  const vy = ux;
  const halfStrokeWidth = effectivePrimitiveStrokeWidth(shape) / 2;
  const x = shape.x - halfStrokeWidth * (ux + vx);
  const y = shape.y - halfStrokeWidth * (uy + vy);
  const width = shape.width + halfStrokeWidth * 2;
  const height = shape.height + halfStrokeWidth * 2;
  const corners = [
    { x, y },
    { x: x + ux * width, y: y + uy * width },
    { x: x + vx * height, y: y + vy * height },
    {
      x: x + ux * width + vx * height,
      y: y + uy * width + vy * height,
    },
  ];
  return {
    minX: Math.min(...corners.map((point) => point.x)),
    minY: Math.min(...corners.map((point) => point.y)),
    maxX: Math.max(...corners.map((point) => point.x)),
    maxY: Math.max(...corners.map((point) => point.y)),
  };
}

function fitRectToImage(
  shape: Extract<TracedShape, { kind: 'rect' }>,
  imageWidth: number,
  imageHeight: number,
): Extract<TracedShape, { kind: 'rect' }> | null {
  if (!Number.isFinite(shape.x)
      || !Number.isFinite(shape.y)
      || !Number.isFinite(shape.width)
      || !Number.isFinite(shape.height)
      || !Number.isFinite(shape.angle)
      || shape.width <= 0
      || shape.height <= 0) {
    return null;
  }
  let result = {
    ...shape,
    strokeWidth: effectivePrimitiveStrokeWidth(shape),
  };
  let bounds = renderedRectBounds(result);
  const widthScale = imageWidth / Math.max(Number.EPSILON, bounds.maxX - bounds.minX);
  const heightScale = imageHeight / Math.max(Number.EPSILON, bounds.maxY - bounds.minY);
  const dimensionScale = Math.min(1, widthScale, heightScale);
  if (dimensionScale < 1) {
    const scaledStrokeWidth = result.strokeWidth * dimensionScale;
    if (scaledStrokeWidth < MIN_TRACED_STROKE_WIDTH) return null;
    const radians = result.angle * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const centerX = result.x
      + cos * result.width / 2
      - sin * result.height / 2;
    const centerY = result.y
      + sin * result.width / 2
      + cos * result.height / 2;
    const width = result.width * dimensionScale;
    const height = result.height * dimensionScale;
    result = {
      ...result,
      x: centerX - cos * width / 2 + sin * height / 2,
      y: centerY - sin * width / 2 - cos * height / 2,
      width,
      height,
      strokeWidth: scaledStrokeWidth,
    };
    bounds = renderedRectBounds(result);
  }
  const offsetX = bounds.minX < 0
    ? -bounds.minX
    : bounds.maxX > imageWidth
      ? imageWidth - bounds.maxX
      : 0;
  const offsetY = bounds.minY < 0
    ? -bounds.minY
    : bounds.maxY > imageHeight
      ? imageHeight - bounds.maxY
      : 0;
  return {
    ...result,
    x: result.x + offsetX,
    y: result.y + offsetY,
  };
}

function fitCircleToImage(
  shape: Extract<TracedShape, { kind: 'circle' }>,
  imageWidth: number,
  imageHeight: number,
): Extract<TracedShape, { kind: 'circle' }> | null {
  if (!Number.isFinite(shape.cx)
      || !Number.isFinite(shape.cy)
      || !Number.isFinite(shape.r)
      || shape.r <= 0) {
    return null;
  }
  const strokeWidth = effectivePrimitiveStrokeWidth(shape);
  const outerRadius = shape.r + strokeWidth / 2;
  const radiusScale = Math.min(
    1,
    imageWidth / Math.max(Number.EPSILON, outerRadius * 2),
    imageHeight / Math.max(Number.EPSILON, outerRadius * 2),
  );
  const radius = shape.r * radiusScale;
  const fittedStrokeWidth = strokeWidth * radiusScale;
  const fittedOuterRadius = radius + fittedStrokeWidth / 2;
  if (
    radius <= 0
    || fittedStrokeWidth < MIN_TRACED_STROKE_WIDTH
  ) {
    return null;
  }
  return {
    ...shape,
    cx: clamp(
      shape.cx,
      fittedOuterRadius,
      imageWidth - fittedOuterRadius,
    ),
    cy: clamp(
      shape.cy,
      fittedOuterRadius,
      imageHeight - fittedOuterRadius,
    ),
    r: radius,
    strokeWidth: fittedStrokeWidth,
  };
}

function ellipseExtents(
  rx: number,
  ry: number,
  angle: number,
): { x: number; y: number } {
  const radians = angle * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: Math.hypot(rx * cos, ry * sin),
    y: Math.hypot(rx * sin, ry * cos),
  };
}

function renderedEllipseExtents(
  rx: number,
  ry: number,
  angle: number,
  strokeWidth: number,
): { x: number; y: number } {
  const extents = ellipseExtents(rx, ry, angle);
  const halfStrokeWidth = strokeWidth / 2;
  // A centred ellipse stroke is the Minkowski sum of its path and a disc.
  // Its axis-aligned support therefore grows by half the stroke in both axes.
  return {
    x: extents.x + halfStrokeWidth,
    y: extents.y + halfStrokeWidth,
  };
}

function fitEllipseToImage(
  shape: Extract<TracedShape, { kind: 'ellipse' }>,
  imageWidth: number,
  imageHeight: number,
): Extract<TracedShape, { kind: 'ellipse' }> | null {
  if (!Number.isFinite(shape.cx)
      || !Number.isFinite(shape.cy)
      || !Number.isFinite(shape.rx)
      || !Number.isFinite(shape.ry)
      || !Number.isFinite(shape.angle)
      || shape.rx <= 0
      || shape.ry <= 0) {
    return null;
  }
  let rx = shape.rx;
  let ry = shape.ry;
  let strokeWidth = effectivePrimitiveStrokeWidth(shape);
  let extents = renderedEllipseExtents(
    rx,
    ry,
    shape.angle,
    strokeWidth,
  );
  const radiusScale = Math.min(
    1,
    imageWidth / Math.max(Number.EPSILON, extents.x * 2),
    imageHeight / Math.max(Number.EPSILON, extents.y * 2),
  );
  if (radiusScale < 1) {
    rx *= radiusScale;
    ry *= radiusScale;
    strokeWidth *= radiusScale;
    if (strokeWidth < MIN_TRACED_STROKE_WIDTH) return null;
    extents = renderedEllipseExtents(
      rx,
      ry,
      shape.angle,
      strokeWidth,
    );
  }
  return {
    ...shape,
    cx: clamp(shape.cx, extents.x, imageWidth - extents.x),
    cy: clamp(shape.cy, extents.y, imageHeight - extents.y),
    rx,
    ry,
    strokeWidth,
  };
}

function sanitizeShape(
  shape: TracedShape,
  width: number,
  height: number,
): TracedShape | null {
  switch (shape.kind) {
    case 'polygon': {
      const points = sanitizePoints(shape.points, width, height);
      if (points.length < 3) return null;
      const holes: TracedPoint[][] = [];
      for (const hole of shape.holes ?? []) {
        const sanitizedHole = sanitizePoints(hole, width, height);
        if (sanitizedHole.length < 3) return null;
        holes.push(sanitizedHole);
      }
      return {
        ...shape,
        points,
        holes: shape.holes === undefined ? undefined : holes,
      };
    }
    case 'polyline': {
      const points = sanitizePoints(shape.points, width, height, true);
      return points.length >= 2 ? { ...shape, points } : null;
    }
    case 'line': {
      const sanitized = {
        ...shape,
        x1: clamp(shape.x1, 0, width),
        y1: clamp(shape.y1, 0, height),
        x2: clamp(shape.x2, 0, width),
        y2: clamp(shape.y2, 0, height),
      };
      return sanitized.x1 !== sanitized.x2 || sanitized.y1 !== sanitized.y2
        ? sanitized
        : null;
    }
    case 'rect': {
      const sanitized = sanitizePrimitiveStrokeWidth(shape, width, height);
      return sanitized ? fitRectToImage(sanitized, width, height) : null;
    }
    case 'circle': {
      const sanitized = sanitizePrimitiveStrokeWidth(shape, width, height);
      return sanitized ? fitCircleToImage(sanitized, width, height) : null;
    }
    case 'ellipse': {
      const sanitized = sanitizePrimitiveStrokeWidth(shape, width, height);
      return sanitized ? fitEllipseToImage(sanitized, width, height) : null;
    }
  }
}

/**
 * Runs the DOM/fabric-independent trace pipeline used by the Worker. It is
 * exported so synthetic image tests can exercise orchestration without
 * bootstrapping an actual browser Worker.
 */
export async function executeTracePipeline(
  imageData: ImageData,
  options: TraceOptions,
  callbacks: TracePipelineCallbacks = {},
): Promise<TracedDrawing> {
  await checkpoint(callbacks, 'preprocess', 0);
  const binary = preprocessImage(imageData, options);

  await checkpoint(callbacks, 'components', 0.2);
  const maxBoundaryEdges = rawBoundaryEdgeLimit(options);
  const maxComponents = Math.max(
    1,
    Math.min(options.vertexLimit, Math.floor(maxBoundaryEdges / 4)),
  );
  let labeling: ConnectedComponentsResult;
  try {
    labeling = labelConnectedComponents(binary, 8, { maxComponents });
  } catch (error) {
    if (error instanceof ConnectedComponentLimitError) {
      throw new TracePipelineError(
        'VERTEX_LIMIT_EXCEEDED',
        error.message,
        { cause: error },
      );
    }
    throw error;
  }

  await checkpoint(callbacks, 'contours', 0.35);
  let contours: Contour[];
  try {
    contours = extractContours(binary, labeling, { maxBoundaryEdges });
  } catch (error) {
    if (error instanceof ContourBoundaryEdgeLimitError) {
      throw new TracePipelineError(
        'VERTEX_LIMIT_EXCEEDED',
        error.message,
        { cause: error },
      );
    }
    throw error;
  }
  if (labeling.components.length === 0 || contours.length === 0) {
    throw new TracePipelineError('NO_SHAPES', 'No traceable shapes were detected.');
  }

  const centerlineComponentIds = options.forceCenterline
    ? new Set(labeling.components.map((component) => component.id))
    : lineLikeComponentIds(contours);
  let centerlines: Array<{ centerline: Centerline; componentId: number }> = [];
  if (centerlineComponentIds.size > 0) {
    await checkpoint(callbacks, 'centerlines', 0.5);
    const skeleton = zhangSuenThinning(binary);
    centerlines = extractCenterlines(skeleton, binary)
      .map((centerline) => ({
        centerline,
        componentId: centerlineComponentId(
          centerline,
          centerlineComponentIds,
          labeling,
          binary.width,
          binary.height,
        ),
      }))
      .filter(({ componentId }) => (
        componentId > 0 && centerlineComponentIds.has(componentId)
      ));
  } else {
    await checkpoint(callbacks, 'centerlines', 0.55);
  }

  await checkpoint(callbacks, 'simplify', 0.65);
  const candidates: TraceCandidate[] = [];
  const simplifiedContours: SimplifiedTraceContour[] = [];
  const rejectedCenterlineCountByComponent = new Map<number, number>();
  let droppedCount = 0;
  for (const contour of contours) {
    if (centerlineComponentIds.has(contour.componentId)) continue;
    const points = withoutDuplicateClosingPoint(
      simplifyPolyline(contour.points, options.simplifyTolerance, true),
    );
    if (points.length < 3) {
      droppedCount += 1;
      continue;
    }
    simplifiedContours.push({
      componentId: contour.componentId,
      points,
      isHole: contour.isHole,
      area: contour.area,
    });
  }
  const groupedContours = groupContourCandidates(simplifiedContours);
  candidates.push(...groupedContours.candidates);
  droppedCount += groupedContours.orphanHoleCount;

  for (const { centerline, componentId } of centerlines) {
    const points = withoutDuplicateClosingPoint(simplifyPolyline(
      centerline.points,
      options.simplifyTolerance,
      centerline.closed,
    ));
    if (points.length < 2) {
      rejectedCenterlineCountByComponent.set(
        componentId,
        (rejectedCenterlineCountByComponent.get(componentId) ?? 0) + 1,
      );
      continue;
    }
    candidates.push({
      points,
      closed: centerline.closed,
      strokeWidth: centerline.strokeWidth,
      source: 'centerline',
      componentId,
    });
  }
  if (candidates.length === 0) {
    throw new TracePipelineError('NO_SHAPES', 'No traceable shapes were detected.');
  }

  await checkpoint(callbacks, 'classify', 0.8);
  let shapes = candidates.map((candidate): TracedShape => {
    if (candidate.source === 'centerline') return centerlineShape(candidate, options);
    const compoundPolygon: TracedShape = {
      kind: 'polygon',
      points: candidate.points,
      holes: candidate.holes?.length ? candidate.holes : undefined,
      closed: true,
    };
    if (options.mode === 'cleanup') {
      const strokeWidth = candidate.source === 'contour'
        ? estimateOutlinedStrokeWidth(candidate as OuterContourCandidate)
        : DEFAULT_TRACED_PRIMITIVE_STROKE_WIDTH;
      const classified = classifyShape(candidate.points, {
        closed: candidate.closed,
        strokeWidth,
      });
      if (classified.kind === 'polygon') return compoundPolygon;
      if (!isCleanupPrimitive(classified)) {
        return candidate.holes?.length ? compoundPolygon : classified;
      }
      if (
        candidate.holes?.length
        && !isCompatibleOutlinedPrimitive(
          candidate as OuterContourCandidate,
          classified,
          strokeWidth,
          options.simplifyTolerance,
        )
      ) {
        return compoundPolygon;
      }
      return centerOutlinedPrimitiveGeometry(classified, strokeWidth)
        ?? compoundPolygon;
    }
    return compoundPolygon;
  });

  await checkpoint(callbacks, 'align', 0.9);
  if (options.mode === 'cleanup') shapes = alignShapes(shapes, options);

  const scaleX = imageData.width / binary.width;
  const scaleY = imageData.height / binary.height;
  if (scaleX !== 1 || scaleY !== 1) {
    shapes = shapes.map((shape) => scaleShape(shape, scaleX, scaleY));
  }
  const sanitizedShapes: TracedShape[] = [];
  const adoptedCenterlineComponentIds = new Set<number>();
  for (let index = 0; index < shapes.length; index += 1) {
    const shape = shapes[index];
    const candidate = candidates[index];
    const sanitized = sanitizeShape(shape, imageData.width, imageData.height);
    if (sanitized) {
      sanitizedShapes.push(sanitized);
      if (candidate.source === 'centerline' && candidate.componentId !== undefined) {
        adoptedCenterlineComponentIds.add(candidate.componentId);
      }
    } else if (candidate.source === 'centerline' && candidate.componentId !== undefined) {
      rejectedCenterlineCountByComponent.set(
        candidate.componentId,
        (rejectedCenterlineCountByComponent.get(candidate.componentId) ?? 0) + 1,
      );
    } else {
      droppedCount += 1;
    }
  }
  shapes = sanitizedShapes;
  if (shapes.length === 0) {
    throw new TracePipelineError('NO_SHAPES', 'No traceable shapes were detected.');
  }

  for (const componentId of centerlineComponentIds) {
    if (adoptedCenterlineComponentIds.has(componentId)) {
      droppedCount += rejectedCenterlineCountByComponent.get(componentId) ?? 0;
    } else {
      // Its contours were deliberately excluded, so count the unrepresented
      // component once regardless of how many centerline paths were rejected.
      droppedCount += 1;
    }
  }

  const vertexCount = shapes.reduce(
    (total, shape) => total + shapeVertexCount(shape),
    0,
  );
  if (vertexCount > options.vertexLimit) {
    throw new TracePipelineError(
      'VERTEX_LIMIT_EXCEEDED',
      `Trace result has ${vertexCount} vertices; the limit is ${options.vertexLimit}.`,
    );
  }

  await checkpoint(callbacks, 'complete', 1);
  const drawing: TracedDrawing = {
    version: 1,
    sourceWidth: imageData.width,
    sourceHeight: imageData.height,
    shapes,
    stats: {
      componentCount: labeling.components.length,
      vertexCount,
      droppedCount,
    },
  };
  assertValidTracedDrawing(drawing, options.vertexLimit);
  return drawing;
}

export function classifyTraceError(error: unknown): {
  code: TraceErrorCode;
  message: string;
} {
  if (error instanceof TracePipelineError) {
    return { code: error.code, message: error.message };
  }
  const message = error instanceof Error ? error.message : 'Image tracing failed.';
  const normalized = message.toLowerCase();
  if (normalized.includes('cancel')) return { code: 'CANCELLED', message };
  if (normalized.includes('vertex') && normalized.includes('limit')) {
    return { code: 'VERTEX_LIMIT_EXCEEDED', message };
  }
  if (normalized.includes('option')
      || normalized.includes('threshold')
      || normalized.includes('tolerance')) {
    return { code: 'INVALID_OPTIONS', message };
  }
  if (normalized.includes('image')
      || normalized.includes('pixel')
      || normalized.includes('dimension')
      || normalized.includes('width')
      || normalized.includes('height')) {
    return { code: 'INVALID_IMAGE', message };
  }
  if (normalized.includes('no shape') || normalized.includes('no component')) {
    return { code: 'NO_SHAPES', message };
  }
  return { code: 'PROCESSING_FAILED', message };
}

interface TraceWorkerScope {
  onmessage: ((event: MessageEvent<TraceWorkerRequest>) => void) | null;
  postMessage(message: TraceResponse): void;
  importScripts?: (...urls: string[]) => void;
}

interface ActiveWorkerJob {
  cancelled: boolean;
}

const workerScope = globalThis as unknown as TraceWorkerScope;
const activeWorkerJobs = new Map<number, ActiveWorkerJob>();

async function runWorkerTrace(request: Extract<TraceWorkerRequest, { type: 'trace' }>): Promise<void> {
  if (activeWorkerJobs.has(request.jobId)) {
    const failure: TraceFailureResponse = {
      type: 'trace-failure',
      jobId: request.jobId,
      code: 'INVALID_OPTIONS',
      message: `Trace job ${request.jobId} is already running.`,
    };
    workerScope.postMessage(failure);
    return;
  }

  const active = { cancelled: false };
  activeWorkerJobs.set(request.jobId, active);
  try {
    const drawing = await executeTracePipeline(request.imageData, request.options, {
      isCancelled: () => active.cancelled,
      onProgress: (stage, progress) => {
        workerScope.postMessage({
          type: 'trace-progress',
          jobId: request.jobId,
          stage,
          progress,
        });
      },
    });
    throwIfCancelled({ isCancelled: () => active.cancelled });
    workerScope.postMessage({
      type: 'trace-success',
      jobId: request.jobId,
      drawing,
    });
  } catch (error) {
    const classified = classifyTraceError(error);
    workerScope.postMessage({
      type: 'trace-failure',
      jobId: request.jobId,
      ...classified,
    });
  } finally {
    activeWorkerJobs.delete(request.jobId);
  }
}

// Window also exposes postMessage, so importScripts is used to distinguish the
// actual Worker global when this module is imported by unit tests.
if (typeof workerScope.importScripts === 'function') {
  workerScope.onmessage = (event) => {
    const request = event.data;
    if (!isTraceWorkerRequest(request)) return;
    if (request.type === 'cancel') {
      const active = activeWorkerJobs.get(request.jobId);
      if (active) active.cancelled = true;
      return;
    }
    void runWorkerTrace(request);
  };
}
