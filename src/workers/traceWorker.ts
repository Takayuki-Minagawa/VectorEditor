import { alignShapes } from '../domain/trace/align';
import { classifyShape, minimumAreaBounds } from '../domain/trace/classify';
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
import type {
  TracedDrawing,
  TracedPoint,
  TracedShape,
} from '../domain/trace/tracedDrawing';
import { assertValidTracedDrawing } from '../domain/trace/tracedDrawing';
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

interface TraceCandidate {
  points: TracedPoint[];
  holes?: TracedPoint[][];
  closed: boolean;
  strokeWidth?: number;
  source: 'contour' | 'centerline';
}

interface SimplifiedTraceContour {
  componentId: number;
  points: TracedPoint[];
  isHole: boolean;
  area: number;
}

interface OuterContourCandidate extends TraceCandidate {
  source: 'contour';
  componentId: number;
  area: number;
  holes: TracedPoint[][];
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

function groupContourCandidates(
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
    }));
  let orphanHoleCount = 0;

  for (const hole of contours.filter((contour) => contour.isHole)) {
    const sameComponent = candidates.filter((candidate) => (
      candidate.componentId === hole.componentId
    ));
    const containing = sameComponent.filter((candidate) => (
      pointInPolygon(hole.points[0], candidate.points)
    ));
    const possibleParents = containing.length > 0
      ? containing
      : sameComponent.filter((candidate) => candidate.area > hole.area);
    const parent = possibleParents.sort((left, right) => left.area - right.area)[0];
    if (parent) parent.holes.push(hole.points);
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

function componentIdAtPoint(
  point: TracedPoint,
  labeling: ConnectedComponentsResult,
  width: number,
  height: number,
): number {
  const centerX = Math.max(0, Math.min(width - 1, Math.round(point.x)));
  const centerY = Math.max(0, Math.min(height - 1, Math.round(point.y)));
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

function centerlineBelongsTo(
  centerline: Centerline,
  componentIds: Set<number>,
  labeling: ConnectedComponentsResult,
  width: number,
  height: number,
): boolean {
  if (componentIds.size === 0) return false;
  const stride = Math.max(1, Math.floor(centerline.points.length / 8));
  for (let index = 0; index < centerline.points.length; index += stride) {
    const componentId = componentIdAtPoint(
      centerline.points[index],
      labeling,
      width,
      height,
    );
    if (componentIds.has(componentId)) return true;
  }
  return false;
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
      };
    case 'circle':
      return {
        ...shape,
        cx: shape.cx * scaleX,
        cy: shape.cy * scaleY,
        r: shape.r * strokeScale,
      };
    case 'ellipse':
      return {
        ...shape,
        cx: shape.cx * scaleX,
        cy: shape.cy * scaleY,
        rx: shape.rx * scaleX,
        ry: shape.ry * scaleY,
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

function rotatedRectBounds(
  shape: Extract<TracedShape, { kind: 'rect' }>,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const radians = shape.angle * Math.PI / 180;
  const ux = Math.cos(radians);
  const uy = Math.sin(radians);
  const vx = -uy;
  const vy = ux;
  const corners = [
    { x: shape.x, y: shape.y },
    { x: shape.x + ux * shape.width, y: shape.y + uy * shape.width },
    { x: shape.x + vx * shape.height, y: shape.y + vy * shape.height },
    {
      x: shape.x + ux * shape.width + vx * shape.height,
      y: shape.y + uy * shape.width + vy * shape.height,
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
  let result = { ...shape };
  let bounds = rotatedRectBounds(result);
  const widthScale = imageWidth / Math.max(Number.EPSILON, bounds.maxX - bounds.minX);
  const heightScale = imageHeight / Math.max(Number.EPSILON, bounds.maxY - bounds.minY);
  const dimensionScale = Math.min(1, widthScale, heightScale);
  if (dimensionScale < 1) {
    result = {
      ...result,
      width: result.width * dimensionScale,
      height: result.height * dimensionScale,
    };
    bounds = rotatedRectBounds(result);
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
  const radius = Math.min(shape.r, imageWidth / 2, imageHeight / 2);
  if (radius <= 0) return null;
  return {
    ...shape,
    cx: clamp(shape.cx, radius, imageWidth - radius),
    cy: clamp(shape.cy, radius, imageHeight - radius),
    r: radius,
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
  let extents = ellipseExtents(rx, ry, shape.angle);
  const radiusScale = Math.min(
    1,
    imageWidth / Math.max(Number.EPSILON, extents.x * 2),
    imageHeight / Math.max(Number.EPSILON, extents.y * 2),
  );
  if (radiusScale < 1) {
    rx *= radiusScale;
    ry *= radiusScale;
    extents = ellipseExtents(rx, ry, shape.angle);
  }
  return {
    ...shape,
    cx: clamp(shape.cx, extents.x, imageWidth - extents.x),
    cy: clamp(shape.cy, extents.y, imageHeight - extents.y),
    rx,
    ry,
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
    case 'rect':
      return fitRectToImage(shape, width, height);
    case 'circle':
      return fitCircleToImage(shape, width, height);
    case 'ellipse':
      return fitEllipseToImage(shape, width, height);
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
  let centerlines: Centerline[] = [];
  if (centerlineComponentIds.size > 0) {
    await checkpoint(callbacks, 'centerlines', 0.5);
    const skeleton = zhangSuenThinning(binary);
    centerlines = extractCenterlines(skeleton, binary).filter((centerline) => (
      options.forceCenterline
      || centerlineBelongsTo(
        centerline,
        centerlineComponentIds,
        labeling,
        binary.width,
        binary.height,
      )
    ));
  } else {
    await checkpoint(callbacks, 'centerlines', 0.55);
  }

  await checkpoint(callbacks, 'simplify', 0.65);
  const candidates: TraceCandidate[] = [];
  const simplifiedContours: SimplifiedTraceContour[] = [];
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

  for (const centerline of centerlines) {
    const points = withoutDuplicateClosingPoint(simplifyPolyline(
      centerline.points,
      options.simplifyTolerance,
      centerline.closed,
    ));
    if (points.length < 2) {
      droppedCount += 1;
      continue;
    }
    candidates.push({
      points,
      closed: centerline.closed,
      strokeWidth: centerline.strokeWidth,
      source: 'centerline',
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
      const classified = classifyShape(candidate.points, { closed: candidate.closed });
      return classified.kind === 'polygon' ? compoundPolygon : classified;
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
  for (const shape of shapes) {
    const sanitized = sanitizeShape(shape, imageData.width, imageData.height);
    if (sanitized) sanitizedShapes.push(sanitized);
    else droppedCount += 1;
  }
  shapes = sanitizedShapes;
  if (shapes.length === 0) {
    throw new TracePipelineError('NO_SHAPES', 'No traceable shapes were detected.');
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
