/**
 * Pure section-domain types and validation.
 *
 * Section coordinates use millimetres, with +x to the right and +y upwards.
 * Ring orientation is canonicalised to counter-clockwise for material outer
 * boundaries and clockwise for holes.
 */

import { pointsCoincide } from './sectionGeometryPredicates';

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

/**
 * A detached SectionProfileData copy whose rings have canonical closure and
 * winding. This brand keeps low-level topology checks from accidentally being
 * called with an unnormalised profile.
 */
declare const normalizedSectionProfileBrand: unique symbol;
export type NormalizedSectionProfileData = SectionProfileData & {
  readonly [normalizedSectionProfileBrand]: true;
};

export interface SectionBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
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

/** Neumaier compensated sum for geometry integrations and area comparisons. */
export class CompensatedSum {
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

export function sectionPointBounds(points: readonly SectionPoint[]): SectionBounds {
  if (points.length === 0) {
    throw new SectionValidationError([{
      code: 'too-few-points',
      message: 'Section bounds require at least one point.',
    }]);
  }

  const bounds: SectionBounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new SectionValidationError([{
        code: 'non-finite-point',
        message: 'Section bounds require finite point coordinates.',
      }]);
    }
    bounds.minX = Math.min(bounds.minX, point.x);
    bounds.minY = Math.min(bounds.minY, point.y);
    bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.maxY = Math.max(bounds.maxY, point.y);
  }
  return bounds;
}

/**
 * Computes bounds for one or more profiles. A role filter is useful for
 * extreme-fibre calculations, where only material outer boundaries count.
 */
export function sectionProfileBounds(
  value: SectionProfileData | readonly SectionProfileData[],
  role?: SectionRingRole,
): SectionBounds {
  const profiles = (Array.isArray(value) ? value : [value]) as readonly SectionProfileData[];
  const bounds: SectionBounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  let hasPoints = false;
  for (const profile of profiles) {
    for (const ring of profile.rings) {
      if (role && ring.role !== role) continue;
      if (ring.points.length === 0) continue;
      const ringBounds = sectionPointBounds(ring.points);
      bounds.minX = Math.min(bounds.minX, ringBounds.minX);
      bounds.minY = Math.min(bounds.minY, ringBounds.minY);
      bounds.maxX = Math.max(bounds.maxX, ringBounds.maxX);
      bounds.maxY = Math.max(bounds.maxY, ringBounds.maxY);
      hasPoints = true;
    }
  }
  if (!hasPoints) {
    throw new SectionValidationError([{
      code: 'too-few-points',
      message: 'Section bounds require at least one point.',
    }]);
  }
  return bounds;
}

/** Overflow-safe centre of finite section bounds. */
export function sectionBoundsCentre(bounds: SectionBounds): SectionPoint {
  return {
    x: bounds.minX / 2 + bounds.maxX / 2,
    y: bounds.minY / 2 + bounds.maxY / 2,
  };
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
  const bounds = sectionPointBounds(points);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
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
export function normalizeSectionProfileData(value: SectionProfileData): NormalizedSectionProfileData {
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
  } as NormalizedSectionProfileData;
}
