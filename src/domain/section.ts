/**
 * Pure section-domain types and validation.
 *
 * Section coordinates use millimetres, with +x to the right and +y upwards.
 * Ring orientation is canonicalised to counter-clockwise for material outer
 * boundaries and clockwise for holes.
 */

export const SECTION_PROFILE_VERSION = 1 as const;
export const SECTION_LENGTH_UNIT = 'mm' as const;

export interface SectionPoint {
  x: number;
  y: number;
}

export type SectionRingRole = 'outer' | 'hole';

export interface SectionRing {
  role: SectionRingRole;
  points: SectionPoint[];
}

export interface SectionProfileData {
  version: typeof SECTION_PROFILE_VERSION;
  rings: SectionRing[];
  analysisToleranceMm: number;
  approximate: boolean;
}

export interface SectionProperties {
  /** Area in mm². */
  area: number;
  /** Centroid in the section's x-right/y-up coordinate system, in mm. */
  centroid: SectionPoint;
  /** Centroidal second moment about the x-axis, in mm⁴. */
  ix: number;
  /** Centroidal second moment about the y-axis, in mm⁴. */
  iy: number;
  /** Centroidal product of inertia ∫xy dA, in mm⁴. */
  ixy: number;
  /** Larger principal second moment, in mm⁴. */
  principalMax: number;
  /** Smaller principal second moment, in mm⁴. */
  principalMin: number;
  /** Direction of the principalMax axis from +x, CCW in [-90, 90), degrees. */
  principalAngleDeg: number;
  /** Centroid-to-extreme-fibre distances, in mm. */
  cTop: number;
  cBottom: number;
  cLeft: number;
  cRight: number;
  /** Elastic section moduli, in mm³. */
  zxTop: number;
  zxBottom: number;
  zyLeft: number;
  zyRight: number;
}

export type SectionValidationIssueCode =
  | 'invalid-profile'
  | 'unsupported-version'
  | 'invalid-tolerance'
  | 'invalid-approximate-flag'
  | 'empty-profile'
  | 'missing-outer-ring'
  | 'invalid-ring'
  | 'invalid-ring-role'
  | 'too-few-points'
  | 'non-finite-point'
  | 'degenerate-ring';

export interface SectionValidationIssue {
  code: SectionValidationIssueCode;
  message: string;
  ringIndex?: number;
  pointIndex?: number;
}

export interface SectionValidationResult {
  valid: boolean;
  issues: SectionValidationIssue[];
}

export class SectionValidationError extends Error {
  readonly issues: SectionValidationIssue[];

  constructor(issues: SectionValidationIssue[]) {
    super(issues.map((issue) => issue.message).join('; '));
    this.name = 'SectionValidationError';
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFinitePoint(value: unknown): value is SectionPoint {
  return isRecord(value)
    && typeof value.x === 'number'
    && Number.isFinite(value.x)
    && typeof value.y === 'number'
    && Number.isFinite(value.y);
}

function pointEqualityTolerance(a: SectionPoint, b: SectionPoint): number {
  const coordinateScale = Math.max(1, Math.abs(a.x), Math.abs(a.y), Math.abs(b.x), Math.abs(b.y));
  return coordinateScale * Number.EPSILON * 16;
}

function pointsCoincide(a: SectionPoint, b: SectionPoint): boolean {
  const tolerance = pointEqualityTolerance(a, b);
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

/**
 * Removes redundant adjacent/closing points without changing the represented
 * polygon. This accepts both GeoJSON-style explicitly closed rings and the
 * implicit closure used by the section model.
 */
export function canonicalizeSectionRingPoints(points: readonly SectionPoint[]): SectionPoint[] {
  const result: SectionPoint[] = [];

  for (const point of points) {
    const copy = { x: point.x, y: point.y };
    const previous = result[result.length - 1];
    if (!previous || !pointsCoincide(previous, copy)) result.push(copy);
  }

  if (result.length > 1 && pointsCoincide(result[0], result[result.length - 1])) {
    result.pop();
  }

  return result;
}

class CompensatedSum {
  private sum = 0;
  private correction = 0;

  add(value: number): void {
    const next = this.sum + value;
    this.correction += Math.abs(this.sum) >= Math.abs(value)
      ? (this.sum - next) + value
      : (value - next) + this.sum;
    this.sum = next;
  }

  value(): number {
    return this.sum + this.correction;
  }
}

/** Signed polygon area; positive is counter-clockwise in x-right/y-up space. */
export function signedSectionRingArea(points: readonly SectionPoint[]): number {
  if (points.length < 3) return 0;

  // Translating close to the ring reduces cancellation for document-scale
  // coordinates while leaving every edge cross product invariant in sum.
  const origin = points[0];
  const twiceArea = new CompensatedSum();
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea.add(
      (current.x - origin.x) * (next.y - origin.y)
      - (next.x - origin.x) * (current.y - origin.y),
    );
  }
  return twiceArea.value() / 2;
}

function ringAreaEpsilon(points: readonly SectionPoint[]): number {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const scale = Math.max(1, width, height);
  return scale * scale * Number.EPSILON * Math.max(64, points.length * 8);
}

/**
 * Structural and finite-number validation. Orientation is deliberately not an
 * error because normalizeSectionProfileData canonicalises it from the explicit
 * outer/hole role.
 */
export function validateSectionProfileData(value: unknown): SectionValidationResult {
  const issues: SectionValidationIssue[] = [];
  if (!isRecord(value)) {
    return {
      valid: false,
      issues: [{ code: 'invalid-profile', message: 'Section profile must be an object.' }],
    };
  }

  if (value.version !== SECTION_PROFILE_VERSION) {
    issues.push({
      code: 'unsupported-version',
      message: `Unsupported section profile version: ${String(value.version)}.`,
    });
  }
  if (typeof value.analysisToleranceMm !== 'number'
      || !Number.isFinite(value.analysisToleranceMm)
      || value.analysisToleranceMm <= 0) {
    issues.push({
      code: 'invalid-tolerance',
      message: 'Section analysis tolerance must be a positive finite number in mm.',
    });
  }
  if (typeof value.approximate !== 'boolean') {
    issues.push({
      code: 'invalid-approximate-flag',
      message: 'Section approximate flag must be boolean.',
    });
  }
  if (!Array.isArray(value.rings) || value.rings.length === 0) {
    issues.push({ code: 'empty-profile', message: 'Section profile must contain at least one ring.' });
    return { valid: false, issues };
  }

  let hasOuterRing = false;
  value.rings.forEach((candidate, ringIndex) => {
    if (!isRecord(candidate) || !Array.isArray(candidate.points)) {
      issues.push({
        code: 'invalid-ring',
        message: `Section ring ${ringIndex} must contain a points array.`,
        ringIndex,
      });
      return;
    }

    if (candidate.role !== 'outer' && candidate.role !== 'hole') {
      issues.push({
        code: 'invalid-ring-role',
        message: `Section ring ${ringIndex} must be explicitly marked outer or hole.`,
        ringIndex,
      });
    } else if (candidate.role === 'outer') {
      hasOuterRing = true;
    }

    const finitePoints: SectionPoint[] = [];
    candidate.points.forEach((point, pointIndex) => {
      if (!isFinitePoint(point)) {
        issues.push({
          code: 'non-finite-point',
          message: `Section ring ${ringIndex} point ${pointIndex} must have finite x and y coordinates.`,
          ringIndex,
          pointIndex,
        });
      } else {
        finitePoints.push(point);
      }
    });

    if (finitePoints.length !== candidate.points.length) return;
    const canonicalPoints = canonicalizeSectionRingPoints(finitePoints);
    if (canonicalPoints.length < 3) {
      issues.push({
        code: 'too-few-points',
        message: `Section ring ${ringIndex} must contain at least three distinct points.`,
        ringIndex,
      });
      return;
    }

    const area = signedSectionRingArea(canonicalPoints);
    if (!Number.isFinite(area) || Math.abs(area) <= ringAreaEpsilon(canonicalPoints)) {
      issues.push({
        code: 'degenerate-ring',
        message: `Section ring ${ringIndex} has zero or numerically degenerate area.`,
        ringIndex,
      });
    }
  });

  if (!hasOuterRing) {
    issues.push({
      code: 'missing-outer-ring',
      message: 'Section profile must contain at least one outer ring.',
    });
  }

  return { valid: issues.length === 0, issues };
}

export function assertValidSectionProfileData(value: unknown): asserts value is SectionProfileData {
  const result = validateSectionProfileData(value);
  if (!result.valid) throw new SectionValidationError(result.issues);
}

/** Returns a detached profile with canonical point closure and ring winding. */
export function normalizeSectionProfileData(value: SectionProfileData): SectionProfileData {
  assertValidSectionProfileData(value);

  const rings = value.rings.map((ring) => {
    const points = canonicalizeSectionRingPoints(ring.points);
    const signedArea = signedSectionRingArea(points);
    const hasCanonicalWinding = ring.role === 'outer' ? signedArea > 0 : signedArea < 0;
    return {
      role: ring.role,
      points: hasCanonicalWinding ? points : points.reverse(),
    } satisfies SectionRing;
  });

  return {
    version: SECTION_PROFILE_VERSION,
    rings,
    analysisToleranceMm: value.analysisToleranceMm,
    approximate: value.approximate,
  };
}
