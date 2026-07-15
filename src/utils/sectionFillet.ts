import {
  normalizeSectionProfileData,
  type SectionPoint,
  type SectionProfileData,
  type SectionRing,
} from '../domain/section';
import { assertValidNormalizedSectionProfileTopology } from './sectionTopology';

const MAX_FILLET_SEGMENTS = 4096;
const APPROXIMATE_PROFILE_MESSAGE =
  'Convex line-line fillets require an exact straight-boundary section. Curves, existing fillets, and curve-derived Boolean results are not supported.';

export class SectionFilletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SectionFilletError';
  }
}

export interface SectionCornerReference {
  ringIndex: number;
  vertexIndex: number;
}

export interface SectionConvexCorner extends SectionCornerReference {
  point: SectionPoint;
  interiorAngleRad: number;
  /** Largest radius for this corner when it is filleted by itself. */
  maxRadiusMm: number;
}

interface ConvexCornerGeometry {
  toPrevious: SectionPoint;
  toNext: SectionPoint;
  bisector: SectionPoint;
  interiorAngleRad: number;
  previousLength: number;
  nextLength: number;
  /** Tangent setback along either edge for a unit radius. */
  tangentDistancePerRadius: number;
  centreDistancePerRadius: number;
}

interface CornerFillet {
  incoming: SectionPoint;
  outgoing: SectionPoint;
  centre: SectionPoint;
}

function distance(first: SectionPoint, second: SectionPoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function appendDistinct(points: SectionPoint[], point: SectionPoint): void {
  const previous = points[points.length - 1];
  if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > 1e-12) {
    points.push(point);
  }
}

function convexCornerGeometry(
  previous: SectionPoint,
  current: SectionPoint,
  next: SectionPoint,
): ConvexCornerGeometry | null {
  const incomingX = current.x - previous.x;
  const incomingY = current.y - previous.y;
  const outgoingX = next.x - current.x;
  const outgoingY = next.y - current.y;
  const cross = incomingX * outgoingY - incomingY * outgoingX;
  const scale = Math.max(1, Math.hypot(incomingX, incomingY), Math.hypot(outgoingX, outgoingY));
  if (cross <= scale * scale * Number.EPSILON * 128) return null;

  const previousLength = distance(previous, current);
  const nextLength = distance(current, next);
  if (previousLength <= 0 || nextLength <= 0) return null;

  const toPrevious = {
    x: (previous.x - current.x) / previousLength,
    y: (previous.y - current.y) / previousLength,
  };
  const toNext = {
    x: (next.x - current.x) / nextLength,
    y: (next.y - current.y) / nextLength,
  };
  const cosine = Math.max(-1, Math.min(1, toPrevious.x * toNext.x + toPrevious.y * toNext.y));
  const interiorAngle = Math.acos(cosine);
  if (interiorAngle <= 1e-8 || Math.PI - interiorAngle <= 1e-8) return null;

  const tangentDistancePerRadius = 1 / Math.tan(interiorAngle / 2);
  const bisectorX = toPrevious.x + toNext.x;
  const bisectorY = toPrevious.y + toNext.y;
  const bisectorLength = Math.hypot(bisectorX, bisectorY);
  const centreDistancePerRadius = 1 / Math.sin(interiorAngle / 2);
  if (
    ![tangentDistancePerRadius, centreDistancePerRadius, bisectorLength].every(Number.isFinite)
    || bisectorLength <= 0
  ) {
    throw new SectionFilletError('The requested radius cannot be applied to this corner.');
  }

  return {
    toPrevious,
    toNext,
    bisector: {
      x: bisectorX / bisectorLength,
      y: bisectorY / bisectorLength,
    },
    interiorAngleRad: interiorAngle,
    previousLength,
    nextLength,
    tangentDistancePerRadius,
    centreDistancePerRadius,
  };
}

function cornerFillet(
  current: SectionPoint,
  geometry: ConvexCornerGeometry,
  radiusMm: number,
): CornerFillet {
  const tangentDistance = radiusMm * geometry.tangentDistancePerRadius;
  const centreDistance = radiusMm * geometry.centreDistancePerRadius;
  return {
    incoming: {
      x: current.x + geometry.toPrevious.x * tangentDistance,
      y: current.y + geometry.toPrevious.y * tangentDistance,
    },
    outgoing: {
      x: current.x + geometry.toNext.x * tangentDistance,
      y: current.y + geometry.toNext.y * tangentDistance,
    },
    centre: {
      x: current.x + geometry.bisector.x * centreDistance,
      y: current.y + geometry.bisector.y * centreDistance,
    },
  };
}

function cornerKey(reference: SectionCornerReference): string {
  return `${reference.ringIndex}:${reference.vertexIndex}`;
}

interface CollectedCorners {
  corners: SectionConvexCorner[];
  geometryByKey: Map<string, ConvexCornerGeometry>;
}

function assertExactStraightBoundaryProfile(profile: SectionProfileData): void {
  if (profile.approximate) {
    throw new SectionFilletError(APPROXIMATE_PROFILE_MESSAGE);
  }
}

function collectConvexCorners(profile: SectionProfileData): CollectedCorners {
  assertExactStraightBoundaryProfile(profile);
  const corners: SectionConvexCorner[] = [];
  const geometryByKey = new Map<string, ConvexCornerGeometry>();
  const clearance = profile.analysisToleranceMm;

  profile.rings.forEach((ring, ringIndex) => {
    if (ring.role !== 'outer') return;
    ring.points.forEach((point, vertexIndex) => {
      const geometry = convexCornerGeometry(
        ring.points[(vertexIndex + ring.points.length - 1) % ring.points.length],
        point,
        ring.points[(vertexIndex + 1) % ring.points.length],
      );
      if (!geometry) return;
      const availableLength = Math.max(
        0,
        Math.min(geometry.previousLength, geometry.nextLength) - clearance,
      );
      const maxRadiusMm = availableLength / geometry.tangentDistancePerRadius;
      const reference = { ringIndex, vertexIndex };
      corners.push({
        ...reference,
        point: { ...point },
        interiorAngleRad: geometry.interiorAngleRad,
        maxRadiusMm: Number.isFinite(maxRadiusMm) ? maxRadiusMm : 0,
      });
      geometryByKey.set(cornerKey(reference), geometry);
    });
  });

  return { corners, geometryByKey };
}

function resolveSelectedCornerKeys(
  profile: SectionProfileData,
  requested: readonly SectionCornerReference[] | undefined,
): { selectedKeys: Set<string>; geometryByKey: Map<string, ConvexCornerGeometry> } {
  const collected = collectConvexCorners(profile);
  const references = requested ?? collected.corners;
  if (references.length === 0) {
    throw new SectionFilletError('No eligible convex line-line corners were selected.');
  }

  const selectedKeys = new Set<string>();
  references.forEach((reference) => {
    if (!Number.isInteger(reference.ringIndex) || !Number.isInteger(reference.vertexIndex)) {
      throw new SectionFilletError('Section corner indices must be integers.');
    }
    const key = cornerKey(reference);
    if (!collected.geometryByKey.has(key)) {
      throw new SectionFilletError(
        `Section corner ${reference.ringIndex}:${reference.vertexIndex} is not an eligible convex outer corner.`,
      );
    }
    selectedKeys.add(key);
  });

  return { selectedKeys, geometryByKey: collected.geometryByKey };
}

function maximumRadiusForSelection(
  profile: SectionProfileData,
  selectedKeys: ReadonlySet<string>,
  geometryByKey: ReadonlyMap<string, ConvexCornerGeometry>,
): number {
  let maximum = Number.POSITIVE_INFINITY;
  const clearance = profile.analysisToleranceMm;

  profile.rings.forEach((ring, ringIndex) => {
    if (ring.role !== 'outer') return;
    ring.points.forEach((point, vertexIndex) => {
      const nextIndex = (vertexIndex + 1) % ring.points.length;
      const startKey = cornerKey({ ringIndex, vertexIndex });
      const endKey = cornerKey({ ringIndex, vertexIndex: nextIndex });
      const usagePerRadius = (selectedKeys.has(startKey)
        ? geometryByKey.get(startKey)?.tangentDistancePerRadius ?? 0
        : 0)
        + (selectedKeys.has(endKey)
          ? geometryByKey.get(endKey)?.tangentDistancePerRadius ?? 0
          : 0);
      if (usagePerRadius <= 0) return;
      const availableLength = Math.max(0, distance(point, ring.points[nextIndex]) - clearance);
      maximum = Math.min(maximum, availableLength / usagePerRadius);
    });
  });

  return Number.isFinite(maximum) ? Math.max(0, maximum) : 0;
}

/** Lists stable ring/vertex references for every eligible material-outer convex corner. */
export function listSectionProfileConvexCorners(
  input: SectionProfileData,
): SectionConvexCorner[] {
  return collectConvexCorners(normalizeSectionProfileData(input)).corners;
}

/** Returns the inclusive radius limit imposed by the selected corners and their shared edges. */
export function getMaximumSectionFilletRadius(
  input: SectionProfileData,
  selectedCorners?: readonly SectionCornerReference[],
): number {
  const profile = normalizeSectionProfileData(input);
  const { selectedKeys, geometryByKey } = resolveSelectedCornerKeys(profile, selectedCorners);
  return maximumRadiusForSelection(profile, selectedKeys, geometryByKey);
}

function appendFilletArc(
  output: SectionPoint[],
  fillet: CornerFillet,
  radiusMm: number,
  toleranceMm: number,
): void {
  const startAngle = Math.atan2(
    fillet.incoming.y - fillet.centre.y,
    fillet.incoming.x - fillet.centre.x,
  );
  let endAngle = Math.atan2(
    fillet.outgoing.y - fillet.centre.y,
    fillet.outgoing.x - fillet.centre.x,
  );
  while (endAngle <= startAngle) endAngle += Math.PI * 2;
  const sweep = endAngle - startAngle;
  if (sweep >= Math.PI) {
    throw new SectionFilletError('The requested radius produced an invalid outer-corner arc.');
  }

  const safeTolerance = Math.min(toleranceMm / 16, radiusMm);
  const maxStep = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - safeTolerance / radiusMm)));
  const segmentCount = Math.max(1, Math.ceil(sweep / Math.max(maxStep, 1e-6)));
  if (segmentCount > MAX_FILLET_SEGMENTS) {
    throw new SectionFilletError('The requested radius requires too many approximation segments.');
  }
  for (let index = 0; index <= segmentCount; index += 1) {
    const angle = startAngle + sweep * index / segmentCount;
    appendDistinct(output, {
      x: fillet.centre.x + radiusMm * Math.cos(angle),
      y: fillet.centre.y + radiusMm * Math.sin(angle),
    });
  }
}

function filletOuterRing(
  ring: SectionRing,
  ringIndex: number,
  radiusMm: number,
  toleranceMm: number,
  selectedKeys: ReadonlySet<string>,
  geometryByKey: ReadonlyMap<string, ConvexCornerGeometry>,
): { ring: SectionRing; applied: boolean } {
  if (ring.role !== 'outer') return { ring, applied: false };
  const corners = ring.points.map((point, vertexIndex) => {
    const key = cornerKey({ ringIndex, vertexIndex });
    if (!selectedKeys.has(key)) return null;
    const geometry = geometryByKey.get(key);
    if (!geometry) return null;
    return cornerFillet(point, geometry, radiusMm);
  });

  if (!corners.some(Boolean)) return { ring, applied: false };
  const points: SectionPoint[] = [];
  corners.forEach((fillet, index) => {
    if (!fillet) appendDistinct(points, ring.points[index]);
    else appendFilletArc(points, fillet, radiusMm, toleranceMm);
  });
  return { ring: { role: 'outer', points }, applied: true };
}

/** Applies one radius to selected convex outer corners, or every eligible corner when omitted. */
export function filletSectionProfileConvexCorners(
  input: SectionProfileData,
  radiusMm: number,
  selectedCorners?: readonly SectionCornerReference[],
): SectionProfileData {
  if (!Number.isFinite(radiusMm) || radiusMm <= 0) {
    throw new SectionFilletError('Section fillet radius must be a positive finite value in mm.');
  }
  const profile = normalizeSectionProfileData(input);
  const { selectedKeys, geometryByKey } = resolveSelectedCornerKeys(profile, selectedCorners);
  const maximumRadiusMm = maximumRadiusForSelection(profile, selectedKeys, geometryByKey);
  const comparisonTolerance = Math.max(1, radiusMm, maximumRadiusMm)
    * Number.EPSILON * 128;
  if (maximumRadiusMm <= 0 || radiusMm > maximumRadiusMm + comparisonTolerance) {
    throw new SectionFilletError(
      `The requested radius exceeds the maximum ${maximumRadiusMm.toPrecision(8)} mm allowed by the selected corners or adjacent edges.`,
    );
  }
  const toleranceMm = Math.min(profile.analysisToleranceMm, radiusMm / 4);
  let applied = false;
  const rings = profile.rings.map((ring, ringIndex) => {
    const result = filletOuterRing(
      ring,
      ringIndex,
      radiusMm,
      toleranceMm,
      selectedKeys,
      geometryByKey,
    );
    applied ||= result.applied;
    return result.ring;
  });
  if (!applied) {
    throw new SectionFilletError('No eligible convex line-line corners were found.');
  }
  try {
    const result = normalizeSectionProfileData({
      ...profile,
      rings,
      approximate: true,
    });
    assertValidNormalizedSectionProfileTopology(result);
    return result;
  } catch (error) {
    throw new SectionFilletError(
      `The fillet result has invalid section topology: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
}
