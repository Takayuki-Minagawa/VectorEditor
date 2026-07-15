import * as fabric from 'fabric';
import {
  normalizeSectionProfileData,
  signedSectionRingArea,
  type SectionPoint,
  type SectionProfileData,
  type SectionRing,
} from '../domain/section';
import { getFabricMetadata } from './fabricObjectMetadata';

export const DEFAULT_SECTION_TOLERANCE_MM = 0.01;

const MAX_CURVE_SUBDIVISION_DEPTH = 24;
const MAX_CURVE_VERTICES = 65_536;
const MATRIX_EPSILON = 1e-12;
const FLOAT_COMPARISON_FACTOR = 32;

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

function pointDistanceSquared(first: SectionPoint, second: SectionPoint): number {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  return dx * dx + dy * dy;
}

function coordinateScale(points: readonly SectionPoint[]): number {
  let scale = 1;
  for (const point of points) {
    scale = Math.max(scale, Math.abs(point.x), Math.abs(point.y));
  }
  return scale;
}

function vectorLength(first: SectionPoint, second: SectionPoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

/** Length-dimensional uncertainty: coordinate ULP plus local edge arithmetic. */
function linearEpsilon(
  points: readonly SectionPoint[],
  localLength = 1,
): number {
  return (
    coordinateScale(points)
    + Math.max(1, localLength)
  ) * Number.EPSILON * FLOAT_COMPARISON_FACTOR;
}

function pointsCoincide(first: SectionPoint, second: SectionPoint): boolean {
  const epsilon = linearEpsilon([first, second], vectorLength(first, second));
  return pointDistanceSquared(first, second) <= epsilon * epsilon;
}

function orientation(first: SectionPoint, second: SectionPoint, third: SectionPoint): number {
  return (second.x - first.x) * (third.y - first.y)
    - (second.y - first.y) * (third.x - first.x);
}

/** Area-dimensional uncertainty for a cross product of local edge vectors. */
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

function pointOnSegment(point: SectionPoint, first: SectionPoint, second: SectionPoint): boolean {
  const edgeLength = vectorLength(first, second);
  const distanceToPoint = vectorLength(first, point);
  const crossEpsilon = orientationEpsilon(first, second, point);
  if (Math.abs(orientation(first, second, point)) > crossEpsilon) return false;
  const boundsEpsilon = linearEpsilon(
    [point, first, second],
    Math.max(edgeLength, distanceToPoint),
  );
  return point.x >= Math.min(first.x, second.x) - boundsEpsilon
    && point.x <= Math.max(first.x, second.x) + boundsEpsilon
    && point.y >= Math.min(first.y, second.y) - boundsEpsilon
    && point.y <= Math.max(first.y, second.y) + boundsEpsilon;
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
  const epsilon1 = orientationEpsilon(firstStart, firstEnd, secondStart);
  const epsilon2 = orientationEpsilon(firstStart, firstEnd, secondEnd);
  const epsilon3 = orientationEpsilon(secondStart, secondEnd, firstStart);
  const epsilon4 = orientationEpsilon(secondStart, secondEnd, firstEnd);

  if (((o1 > epsilon1 && o2 < -epsilon2) || (o1 < -epsilon1 && o2 > epsilon2))
      && ((o3 > epsilon3 && o4 < -epsilon4) || (o3 < -epsilon3 && o4 > epsilon4))) {
    return true;
  }
  return (Math.abs(o1) <= epsilon1 && pointOnSegment(secondStart, firstStart, firstEnd))
    || (Math.abs(o2) <= epsilon2 && pointOnSegment(secondEnd, firstStart, firstEnd))
    || (Math.abs(o3) <= epsilon3 && pointOnSegment(firstStart, secondStart, secondEnd))
    || (Math.abs(o4) <= epsilon4 && pointOnSegment(firstEnd, secondStart, secondEnd));
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
