import * as fabric from 'fabric';
import polygonClipping from 'polygon-clipping';
import type { MultiPolygon, Pair, Polygon as ClipPolygon } from 'polygon-clipping';
import {
  normalizeSectionProfileData,
  signedSectionRingArea,
  type SectionPoint,
  type SectionProfileData,
  type SectionRing,
} from '../domain/section';
import {
  linearEpsilon,
  orientation,
  orientationEpsilon,
  pointDistanceSquared,
  pointsCoincide,
  segmentsIntersect,
  vectorLength,
} from '../domain/sectionGeometryPredicates';
import { getFabricMetadata } from './fabricObjectMetadata';
import {
  cubicPointAt,
  quadraticPointAt,
  type SimplePathCommand,
} from './pathCommands';

export const DEFAULT_SECTION_TOLERANCE_MM = 0.01;

const MAX_CURVE_SUBDIVISION_DEPTH = 24;
const MAX_CURVE_VERTICES = 65_536;
const MATRIX_EPSILON = 1e-12;

export type SectionGeometryErrorCode =
  | 'empty-selection'
  | 'unsupported-object'
  | 'empty-group'
  | 'invalid-tolerance'
  | 'non-finite-geometry'
  | 'singular-transform'
  | 'too-many-vertices'
  | 'self-intersection'
  | 'degenerate-ring'
  | 'invalid-path'
  | 'invalid-section-profile';

export class SectionGeometryError extends Error {
  readonly code: SectionGeometryErrorCode;

  constructor(code: SectionGeometryErrorCode, message: string) {
    super(message);
    this.name = 'SectionGeometryError';
    this.code = code;
  }
}

interface ConvertedRings {
  rings: SectionRing[];
  approximate: boolean;
  analysisToleranceMm: number;
}

function assertTolerance(toleranceMm: number): void {
  if (!Number.isFinite(toleranceMm) || toleranceMm <= 0) {
    throw new SectionGeometryError(
      'invalid-tolerance',
      'Section geometry tolerance must be a positive finite number in mm.',
    );
  }
}

function assertFiniteValues(label: string, ...values: number[]): void {
  if (values.some((value) => !Number.isFinite(value))) {
    throw new SectionGeometryError(
      'non-finite-geometry',
      `${label} contains a non-finite coordinate or dimension.`,
    );
  }
}

function assertUsableMatrix(matrix: fabric.TMat2D): void {
  assertFiniteValues('Object transform', ...matrix);
  const scale = Math.max(1, Math.abs(matrix[0]), Math.abs(matrix[1]), Math.abs(matrix[2]), Math.abs(matrix[3]));
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  if (Math.abs(determinant) <= MATRIX_EPSILON * scale * scale) {
    throw new SectionGeometryError(
      'singular-transform',
      'Section geometry cannot be created from a singular or near-zero object transform.',
    );
  }
}

/**
 * Applies a Fabric canvas transform to a point expressed in engineering
 * coordinates. Both the input and result use x-right/y-up coordinates.
 */
function transformEngineeringPoint(point: SectionPoint, matrix: fabric.TMat2D): SectionPoint {
  const transformed = fabric.util.transformPoint(
    new fabric.Point(point.x, -point.y),
    matrix,
  );
  return { x: transformed.x, y: -transformed.y };
}

function transformFabricLocalPoint(
  x: number,
  y: number,
  matrix: fabric.TMat2D,
): SectionPoint {
  const transformed = fabric.util.transformPoint(new fabric.Point(x, y), matrix);
  return { x: transformed.x, y: -transformed.y };
}

function maxLinearScale(matrix: fabric.TMat2D): number {
  // Largest singular value of the 2x2 linear part. This conservatively scales
  // a local tessellation tolerance through non-uniform scale and skew.
  const a = matrix[0];
  const b = matrix[1];
  const c = matrix[2];
  const d = matrix[3];
  const sumSquares = a * a + b * b + c * c + d * d;
  const determinant = a * d - b * c;
  const discriminant = Math.max(0, sumSquares * sumSquares - 4 * determinant * determinant);
  return Math.sqrt(Math.max(0, (sumSquares + Math.sqrt(discriminant)) / 2));
}

interface RingSegment {
  index: number;
  start: SectionPoint;
  end: SectionPoint;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function hasSelfIntersection(points: readonly SectionPoint[]): boolean {
  const segments = points.map((start, index): RingSegment => {
    const end = points[(index + 1) % points.length];
    return {
      index,
      start,
      end,
      minX: Math.min(start.x, end.x),
      maxX: Math.max(start.x, end.x),
      minY: Math.min(start.y, end.y),
      maxY: Math.max(start.y, end.y),
    };
  }).sort((first, second) => first.minX - second.minX);

  for (let outerIndex = 0; outerIndex < segments.length; outerIndex += 1) {
    const first = segments[outerIndex];
    for (let innerIndex = outerIndex + 1; innerIndex < segments.length; innerIndex += 1) {
      const second = segments[innerIndex];
      if (second.minX > first.maxX) break;
      const adjacent = Math.abs(first.index - second.index) === 1
        || Math.abs(first.index - second.index) === points.length - 1;
      if (adjacent || second.minY > first.maxY || second.maxY < first.minY) continue;
      if (segmentsIntersect(first.start, first.end, second.start, second.end)) return true;
    }
  }
  return false;
}

function removeRedundantPoints(points: readonly SectionPoint[]): SectionPoint[] {
  const unique: SectionPoint[] = [];
  for (const point of points) {
    assertFiniteValues('Section boundary', point.x, point.y);
    const previous = unique[unique.length - 1];
    if (!previous || !pointsCoincide(previous, point)) unique.push({ ...point });
  }
  if (unique.length > 1 && pointsCoincide(unique[0], unique[unique.length - 1])) unique.pop();

  if (unique.length < 3) return unique;
  const result: SectionPoint[] = [];
  for (let index = 0; index < unique.length; index += 1) {
    const previous = unique[(index + unique.length - 1) % unique.length];
    const current = unique[index];
    const next = unique[(index + 1) % unique.length];
    const previousLength = vectorLength(previous, current);
    const nextLength = vectorLength(current, next);
    const localLength = Math.max(1, previousLength, nextLength);
    const crossEpsilon = orientationEpsilon(previous, current, next);
    const cross = orientation(previous, current, next);
    const betweenDot = (current.x - previous.x) * (current.x - next.x)
      + (current.y - previous.y) * (current.y - next.y);
    const betweenEpsilon = linearEpsilon([previous, current, next], localLength)
      * (previousLength + nextLength + localLength);
    const between = betweenDot <= betweenEpsilon;
    if (Math.abs(cross) > crossEpsilon || !between) result.push(current);
  }
  return result;
}

function makeOuterRing(points: readonly SectionPoint[]): SectionRing {
  const cleaned = removeRedundantPoints(points);
  if (cleaned.length < 3 || Math.abs(signedSectionRingArea(cleaned)) <= Number.EPSILON) {
    throw new SectionGeometryError(
      'degenerate-ring',
      'A section boundary must contain at least three non-collinear points.',
    );
  }
  if (hasSelfIntersection(cleaned)) {
    throw new SectionGeometryError(
      'self-intersection',
      'Self-intersecting section boundaries are not supported.',
    );
  }
  if (signedSectionRingArea(cleaned) < 0) cleaned.reverse();
  return { role: 'outer', points: cleaned };
}

function appendAdaptiveArc(
  output: SectionPoint[],
  pointAtAngle: (angle: number) => SectionPoint,
  startAngle: number,
  endAngle: number,
  toleranceMm: number,
  depth = 0,
): void {
  const start = pointAtAngle(startAngle);
  const end = pointAtAngle(endAngle);
  const middleAngle = (startAngle + endAngle) / 2;
  const middle = pointAtAngle(middleAngle);
  const chordMiddle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };

  // One sixteenth of the requested boundary tolerance keeps area and second
  // moment errors comfortably below the MVP acceptance limits. The stored
  // tolerance remains the public upper bound rather than claiming this extra
  // implementation margin as guaranteed precision.
  const subdivisionTolerance = toleranceMm / 16;
  if (pointDistanceSquared(middle, chordMiddle) > subdivisionTolerance * subdivisionTolerance) {
    if (depth >= MAX_CURVE_SUBDIVISION_DEPTH) {
      throw new SectionGeometryError(
        'too-many-vertices',
        'Curve tessellation did not converge within the section tolerance.',
      );
    }
    appendAdaptiveArc(output, pointAtAngle, startAngle, middleAngle, toleranceMm, depth + 1);
    appendAdaptiveArc(output, pointAtAngle, middleAngle, endAngle, toleranceMm, depth + 1);
    return;
  }

  if (output.length === 0 || !pointsCoincide(output[output.length - 1], start)) output.push(start);
  output.push(end);
  if (output.length > MAX_CURVE_VERTICES) {
    throw new SectionGeometryError(
      'too-many-vertices',
      `Curve tessellation exceeded ${MAX_CURVE_VERTICES.toLocaleString()} vertices.`,
    );
  }
}

function rectToRing(object: fabric.Rect, toleranceMm: number): ConvertedRings {
  const matrix = object.calcTransformMatrix();
  assertUsableMatrix(matrix);
  const width = object.width;
  const height = object.height;
  const radiusX = Math.min(Math.abs(object.rx ?? 0), Math.abs(width) / 2);
  const radiusY = Math.min(Math.abs(object.ry ?? 0), Math.abs(height) / 2);
  assertFiniteValues('Rectangle', width, height, radiusX, radiusY);
  if (width <= 0 || height <= 0) {
    throw new SectionGeometryError('degenerate-ring', 'A section rectangle must have positive width and height.');
  }

  const halfWidth = width / 2;
  const halfHeight = height / 2;
  if (radiusX === 0 || radiusY === 0) {
    return {
      rings: [makeOuterRing([
        transformFabricLocalPoint(-halfWidth, -halfHeight, matrix),
        transformFabricLocalPoint(halfWidth, -halfHeight, matrix),
        transformFabricLocalPoint(halfWidth, halfHeight, matrix),
        transformFabricLocalPoint(-halfWidth, halfHeight, matrix),
      ])],
      approximate: false,
      analysisToleranceMm: toleranceMm,
    };
  }

  const points: SectionPoint[] = [];
  const corners = [
    { x: halfWidth - radiusX, y: -halfHeight + radiusY, start: -Math.PI / 2, end: 0 },
    { x: halfWidth - radiusX, y: halfHeight - radiusY, start: 0, end: Math.PI / 2 },
    { x: -halfWidth + radiusX, y: halfHeight - radiusY, start: Math.PI / 2, end: Math.PI },
    { x: -halfWidth + radiusX, y: -halfHeight + radiusY, start: Math.PI, end: Math.PI * 1.5 },
  ];
  corners.forEach((corner) => {
    appendAdaptiveArc(
      points,
      (angle) => transformFabricLocalPoint(
        corner.x + radiusX * Math.cos(angle),
        corner.y + radiusY * Math.sin(angle),
        matrix,
      ),
      corner.start,
      corner.end,
      toleranceMm,
    );
  });
  return { rings: [makeOuterRing(points)], approximate: true, analysisToleranceMm: toleranceMm };
}

function ellipseToRing(
  object: fabric.Circle | fabric.Ellipse,
  radiusX: number,
  radiusY: number,
  toleranceMm: number,
): ConvertedRings {
  const matrix = object.calcTransformMatrix();
  assertUsableMatrix(matrix);
  assertFiniteValues('Ellipse', radiusX, radiusY);
  if (radiusX <= 0 || radiusY <= 0) {
    throw new SectionGeometryError('degenerate-ring', 'A section ellipse must have positive radii.');
  }
  const points: SectionPoint[] = [];
  const pointAtAngle = (angle: number): SectionPoint => transformFabricLocalPoint(
    radiusX * Math.cos(angle),
    radiusY * Math.sin(angle),
    matrix,
  );
  for (let quadrant = 0; quadrant < 4; quadrant += 1) {
    appendAdaptiveArc(
      points,
      pointAtAngle,
      quadrant * Math.PI / 2,
      (quadrant + 1) * Math.PI / 2,
      toleranceMm,
    );
  }
  return { rings: [makeOuterRing(points)], approximate: true, analysisToleranceMm: toleranceMm };
}

function polygonToRing(object: fabric.Polygon, toleranceMm: number): ConvertedRings {
  const matrix = object.calcTransformMatrix();
  assertUsableMatrix(matrix);
  const offset = object.pathOffset ?? new fabric.Point(0, 0);
  const points = object.points.map((point) => transformFabricLocalPoint(
    point.x - offset.x,
    point.y - offset.y,
    matrix,
  ));
  return { rings: [makeOuterRing(points)], approximate: false, analysisToleranceMm: toleranceMm };
}

const PATH_CLOSURE_EPSILON = 1e-6;

/** Whether every subpath of a Fabric path is explicitly or implicitly closed. */
export function isClosedFabricPath(object: fabric.Path): boolean {
  const commands = object.path as unknown as SimplePathCommand[];
  if (commands.length === 0) return false;
  let startX = 0;
  let startY = 0;
  let x = 0;
  let y = 0;
  let hasSubpath = false;
  let subpathClosed = true;
  const subpathIsClosed = (): boolean => subpathClosed
    || (Math.abs(x - startX) <= PATH_CLOSURE_EPSILON && Math.abs(y - startY) <= PATH_CLOSURE_EPSILON);
  for (const command of commands) {
    const type = command[0];
    if (type === 'M') {
      if (hasSubpath && !subpathIsClosed()) return false;
      startX = command[1] as number;
      startY = command[2] as number;
      x = startX;
      y = startY;
      hasSubpath = true;
      subpathClosed = false;
    } else if (type === 'L' || type === 'C' || type === 'Q') {
      if (!hasSubpath) return false;
      x = command[command.length - 2] as number;
      y = command[command.length - 1] as number;
      subpathClosed = false;
    } else if (type === 'Z' || type === 'z') {
      subpathClosed = true;
      x = startX;
      y = startY;
    } else {
      return false;
    }
  }
  return hasSubpath && subpathIsClosed();
}

/**
 * Converts a closed Fabric path into section rings. Curve segments are
 * flattened with the same adaptive tolerance as the other curved shapes, and
 * the even-odd fill semantics of compound paths are resolved through a
 * polygon-clipping XOR so holes keep their role.
 */
function pathToRings(object: fabric.Path, toleranceMm: number): ConvertedRings {
  const matrix = object.calcTransformMatrix();
  assertUsableMatrix(matrix);
  const commands = object.path as unknown as SimplePathCommand[];
  const offset = object.pathOffset ?? new fabric.Point(0, 0);
  const toDocument = (x: number, y: number): SectionPoint =>
    transformFabricLocalPoint(x - offset.x, y - offset.y, matrix);

  const rawRings: SectionPoint[][] = [];
  let approximate = false;
  let ring: SectionPoint[] | null = null;
  let current: { x: number; y: number } | null = null;
  let subpathStart: { x: number; y: number } | null = null;

  const openPathError = (): SectionGeometryError => new SectionGeometryError(
    'unsupported-object',
    'Only closed paths can be used. Close every subpath before running the operation.',
  );

  const finishRing = (explicitClose: boolean): void => {
    if (!ring) return;
    if (!explicitClose) {
      if (!current || !subpathStart) throw openPathError();
      if (
        Math.abs(current.x - subpathStart.x) > PATH_CLOSURE_EPSILON
        || Math.abs(current.y - subpathStart.y) > PATH_CLOSURE_EPSILON
      ) {
        throw openPathError();
      }
    }
    if (ring.length >= 3) rawRings.push(ring);
    ring = null;
  };

  for (const command of commands) {
    const type = command[0];
    if (type === 'M') {
      finishRing(false);
      current = { x: command[1] as number, y: command[2] as number };
      subpathStart = current;
      ring = [toDocument(current.x, current.y)];
    } else if (type === 'L') {
      if (!ring || !current) throw openPathError();
      const end = { x: command[1] as number, y: command[2] as number };
      const point = toDocument(end.x, end.y);
      const previous = ring[ring.length - 1];
      if (!pointsCoincide(previous, point)) ring.push(point);
      current = end;
    } else if (type === 'C' || type === 'Q') {
      if (!ring || !current) throw openPathError();
      const start = current;
      const end = type === 'C'
        ? { x: command[5] as number, y: command[6] as number }
        : { x: command[3] as number, y: command[4] as number };
      const pointAt = type === 'C'
        ? (t: number) => {
          const p = cubicPointAt(
            start,
            { x: command[1] as number, y: command[2] as number },
            { x: command[3] as number, y: command[4] as number },
            end,
            t,
          );
          return toDocument(p.x, p.y);
        }
        : (t: number) => {
          const p = quadraticPointAt(
            start,
            { x: command[1] as number, y: command[2] as number },
            end,
            t,
          );
          return toDocument(p.x, p.y);
        };
      appendAdaptiveArc(ring, pointAt, 0, 1, toleranceMm);
      approximate = true;
      current = end;
    } else if (type === 'Z' || type === 'z') {
      finishRing(true);
      current = subpathStart;
    } else {
      throw new SectionGeometryError(
        'invalid-path',
        `Unsupported path command "${type}".`,
      );
    }
  }
  finishRing(false);

  if (rawRings.length === 0) {
    throw new SectionGeometryError(
      'degenerate-ring',
      'The path does not enclose any area.',
    );
  }

  // Resolve the even-odd filled region: overlapping subpath rings become
  // holes exactly as they render. Work around the rings' bbox centre to
  // reduce floating-point cancellation, mirroring the Boolean kernel.
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  rawRings.forEach((points) => points.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }));
  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;
  const geometries: ClipPolygon[] = rawRings.map((points) => [[
    ...points.map((point): Pair => [point.x - centreX, point.y - centreY]),
    [points[0].x - centreX, points[0].y - centreY],
  ]]);

  let combined: MultiPolygon;
  try {
    combined = geometries.length === 1
      ? polygonClipping.union(geometries[0])
      : polygonClipping.xor(geometries[0], ...geometries.slice(1));
  } catch (error) {
    throw new SectionGeometryError(
      'invalid-path',
      error instanceof Error ? error.message : 'The path outline could not be resolved into a region.',
    );
  }

  const rings: SectionRing[] = [];
  combined.forEach((polygon) => polygon.forEach((ringPoints, ringIndex) => {
    const points = ringPoints.map(([x, y]) => ({ x: x + centreX, y: y + centreY }));
    if (points.length > 1) {
      const first = points[0];
      const last = points[points.length - 1];
      if (first.x === last.x && first.y === last.y) points.pop();
    }
    if (points.length >= 3) {
      rings.push({ role: ringIndex === 0 ? 'outer' : 'hole', points });
    }
  }));
  if (rings.length === 0) {
    throw new SectionGeometryError(
      'degenerate-ring',
      'The path does not enclose any area.',
    );
  }
  return { rings, approximate, analysisToleranceMm: toleranceMm };
}

function readLocalProfileMetadata(object: fabric.FabricObject): SectionProfileData | null {
  const metadata = getFabricMetadata(object);
  if (metadata.objectKind !== 'sectionProfile' || !metadata.sectionProfileData) return null;
  try {
    return normalizeSectionProfileData(metadata.sectionProfileData as SectionProfileData);
  } catch {
    throw new SectionGeometryError(
      'invalid-section-profile',
      'The selected section profile contains invalid or unsupported geometry metadata.',
    );
  }
}

/** Whether an object can be converted into a section profile without selection state. */
export function isSupportedSectionSourceObject(object: fabric.FabricObject): boolean {
  const metadata = getFabricMetadata(object);
  if (metadata.objectKind === 'sectionProfile' && metadata.sectionProfileData) return true;
  if (object instanceof fabric.ActiveSelection) return false;
  if (object instanceof fabric.Group) {
    const children = object.getObjects();
    return children.length > 0 && children.every(isSupportedSectionSourceObject);
  }
  if (object instanceof fabric.Path) return isClosedFabricPath(object);
  return object instanceof fabric.Rect
    || object instanceof fabric.Circle
    || object instanceof fabric.Ellipse
    || object instanceof fabric.Polygon;
}

/** Applies a complete Fabric matrix while retaining section x-right/y-up coordinates. */
export function transformSectionProfile(
  profile: SectionProfileData,
  matrix: fabric.TMat2D,
): SectionProfileData {
  assertUsableMatrix(matrix);
  const transformed = normalizeSectionProfileData({
    ...profile,
    rings: profile.rings.map((ring) => ({
      role: ring.role,
      points: ring.points.map((point) => transformEngineeringPoint(point, matrix)),
    })),
    analysisToleranceMm: profile.analysisToleranceMm * maxLinearScale(matrix),
  });
  transformed.rings.forEach((ring) => {
    if (hasSelfIntersection(ring.points)) {
      throw new SectionGeometryError(
        'self-intersection',
        'The transformed section profile contains a self-intersecting boundary.',
      );
    }
  });
  return transformed;
}

/**
 * Reads section rings in document coordinates without reordering their points.
 *
 * Reflected Fabric transforms reverse the rings' winding. Keeping the original
 * local point order here gives OSNAP vertices stable indices across flipX/flipY;
 * callers that need canonical winding should use
 * readSectionProfileInDocumentCoordinates instead.
 */
export function readSectionProfileRingsInDocumentCoordinates(
  object: fabric.FabricObject,
): SectionRing[] {
  const localProfile = readLocalProfileMetadata(object);
  if (!localProfile) {
    throw new SectionGeometryError(
      'invalid-section-profile',
      'The selected object is not a metadata-backed section profile.',
    );
  }
  const matrix = object.calcTransformMatrix();
  assertUsableMatrix(matrix);
  return localProfile.rings.map((ring) => ({
    role: ring.role,
    points: ring.points.map((point) => transformEngineeringPoint(point, matrix)),
  }));
}

/** Reads local section metadata and bakes the object's complete Fabric transform. */
export function readSectionProfileInDocumentCoordinates(
  object: fabric.FabricObject,
): SectionProfileData {
  const localProfile = readLocalProfileMetadata(object);
  if (!localProfile) {
    throw new SectionGeometryError(
      'invalid-section-profile',
      'The selected object is not a metadata-backed section profile.',
    );
  }
  return transformSectionProfile(localProfile, object.calcTransformMatrix());
}

function convertObject(object: fabric.FabricObject, toleranceMm: number): ConvertedRings {
  const localProfile = readLocalProfileMetadata(object);
  if (localProfile) {
    const documentProfile = transformSectionProfile(localProfile, object.calcTransformMatrix());
    return {
      rings: documentProfile.rings,
      approximate: documentProfile.approximate,
      analysisToleranceMm: documentProfile.analysisToleranceMm,
    };
  }

  if (object instanceof fabric.ActiveSelection) {
    throw new SectionGeometryError(
      'unsupported-object',
      'Active selections must be supplied as individual section objects.',
    );
  }
  if (object instanceof fabric.Group) {
    const children = object.getObjects();
    if (children.length === 0) {
      throw new SectionGeometryError('empty-group', 'An empty group cannot define a section.');
    }
    const converted = children.map((child) => convertObject(child, toleranceMm));
    return {
      rings: converted.flatMap((result) => result.rings),
      approximate: converted.some((result) => result.approximate),
      analysisToleranceMm: Math.max(...converted.map((result) => result.analysisToleranceMm)),
    };
  }
  if (object instanceof fabric.Rect) return rectToRing(object, toleranceMm);
  if (object instanceof fabric.Circle) {
    return ellipseToRing(object, object.radius, object.radius, toleranceMm);
  }
  if (object instanceof fabric.Ellipse) {
    return ellipseToRing(object, object.rx, object.ry, toleranceMm);
  }
  if (object instanceof fabric.Polygon) return polygonToRing(object, toleranceMm);
  if (object instanceof fabric.Path) return pathToRings(object, toleranceMm);

  const type = object.type || object.constructor.name;
  throw new SectionGeometryError(
    'unsupported-object',
    `${type} is not a supported closed section shape. Use a rectangle, rounded rectangle, circle, ellipse, polygon, or supported group.`,
  );
}

/** Converts a supported Fabric object, including metadata-backed section paths. */
export function sectionProfileFromFabricObject(
  object: fabric.FabricObject,
  toleranceMm = DEFAULT_SECTION_TOLERANCE_MM,
): SectionProfileData {
  assertTolerance(toleranceMm);
  const converted = convertObject(object, toleranceMm);
  return normalizeSectionProfileData({
    version: 1,
    rings: converted.rings,
    analysisToleranceMm: converted.analysisToleranceMm,
    approximate: converted.approximate,
  });
}

/** Converts supported Fabric shapes to document-mm rings in x-right/y-up space. */
export function fabricObjectsToSectionProfile(
  objects: readonly fabric.FabricObject[],
  toleranceMm = DEFAULT_SECTION_TOLERANCE_MM,
): SectionProfileData {
  assertTolerance(toleranceMm);
  if (objects.length === 0) {
    throw new SectionGeometryError('empty-selection', 'Select at least one closed shape for the section.');
  }
  const converted = objects.map((object) => convertObject(object, toleranceMm));
  return normalizeSectionProfileData({
    version: 1,
    rings: converted.flatMap((result) => result.rings),
    analysisToleranceMm: Math.max(...converted.map((result) => result.analysisToleranceMm)),
    approximate: converted.some((result) => result.approximate),
  });
}
