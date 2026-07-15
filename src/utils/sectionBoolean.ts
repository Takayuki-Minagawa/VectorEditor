import polygonClipping from 'polygon-clipping';
import type { MultiPolygon, Pair, Ring } from 'polygon-clipping';
import {
  normalizeSectionProfileData,
  signedSectionRingArea,
  type SectionPoint,
  type SectionProfileData,
  type SectionRing,
} from '../domain/section';

export type SectionBooleanErrorCode =
  | 'empty-input'
  | 'invalid-input'
  | 'no-intersection'
  | 'empty-result';

export class SectionBooleanError extends Error {
  readonly code: SectionBooleanErrorCode;

  constructor(code: SectionBooleanErrorCode, message: string) {
    super(message);
    this.name = 'SectionBooleanError';
    this.code = code;
  }
}

interface Translation {
  x: number;
  y: number;
}

const FLOAT_COMPARISON_FACTOR = 32;

function normalizeInput(profile: SectionProfileData): SectionProfileData {
  try {
    return normalizeSectionProfileData(profile);
  } catch (error) {
    throw new SectionBooleanError(
      'invalid-input',
      error instanceof Error ? error.message : 'The section profile is invalid.',
    );
  }
}

function ringBoundsArea(points: readonly SectionPoint[]): number {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  points.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });
  return (maxX - minX) * (maxY - minY);
}

function pointOnSegment(point: SectionPoint, start: SectionPoint, end: SectionPoint): boolean {
  const edgeX = end.x - start.x;
  const edgeY = end.y - start.y;
  const pointX = point.x - start.x;
  const pointY = point.y - start.y;
  const edgeLength = Math.hypot(edgeX, edgeY);
  const pointLength = Math.hypot(pointX, pointY);
  const localLength = Math.max(1, edgeLength, pointLength);
  const coordinateScale = Math.max(
    1,
    Math.abs(point.x),
    Math.abs(point.y),
    Math.abs(start.x),
    Math.abs(start.y),
    Math.abs(end.x),
    Math.abs(end.y),
  );
  const linearEpsilon = (coordinateScale + localLength)
    * Number.EPSILON * FLOAT_COMPARISON_FACTOR;
  const crossEpsilon = (edgeLength + pointLength + localLength) * linearEpsilon
    + localLength * localLength * Number.EPSILON * FLOAT_COMPARISON_FACTOR;
  const cross = edgeX * pointY - edgeY * pointX;
  return Math.abs(cross) <= crossEpsilon
    && point.x >= Math.min(start.x, end.x) - linearEpsilon
    && point.x <= Math.max(start.x, end.x) + linearEpsilon
    && point.y >= Math.min(start.y, end.y) - linearEpsilon
    && point.y <= Math.max(start.y, end.y) + linearEpsilon;
}

function pointInRing(point: SectionPoint, ring: readonly SectionPoint[]): boolean {
  let inside = false;
  for (let index = 0, previousIndex = ring.length - 1; index < ring.length; previousIndex = index, index += 1) {
    const current = ring[index];
    const previous = ring[previousIndex];
    if (pointOnSegment(point, previous, current)) return true;
    const crossesVertically = (current.y > point.y) !== (previous.y > point.y);
    // Compare offsets from the current vertex so a large document origin is
    // not added back into the ray intersection calculation.
    const crossesRay = crossesVertically
      && point.x - current.x < ((previous.x - current.x) * (point.y - current.y))
        / (previous.y - current.y);
    if (crossesRay) inside = !inside;
  }
  return inside;
}

function profileTranslation(profiles: readonly SectionProfileData[]): Translation {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  profiles.forEach((profile) => profile.rings.forEach((ring) => ring.points.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  })));
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

function profileToMultiPolygon(
  profile: SectionProfileData,
  translation: Translation,
): MultiPolygon {
  const outers = profile.rings
    .filter((ring) => ring.role === 'outer')
    .map((ring) => ({
      ring,
      holes: [] as SectionRing[],
      area: Math.abs(signedSectionRingArea(ring.points)),
    }));

  for (const hole of profile.rings.filter((ring) => ring.role === 'hole')) {
    const representative = hole.points[0];
    const containingOuters = outers
      .filter(({ ring }) => pointInRing(representative, ring.points))
      .sort((first, second) => first.area - second.area);
    if (containingOuters.length === 0) {
      throw new SectionBooleanError(
        'invalid-input',
        'Every section hole must be contained by an outer boundary.',
      );
    }
    containingOuters[0].holes.push(hole);
  }

  const translateRing = (ring: SectionRing): Ring => [
    ...ring.points.map((point): Pair => [
      point.x - translation.x,
      point.y - translation.y,
    ]),
    [ring.points[0].x - translation.x, ring.points[0].y - translation.y],
  ];
  return outers.map(({ ring, holes }) => [translateRing(ring), ...holes.map(translateRing)]);
}

function multiPolygonArea(multiPolygon: MultiPolygon): number {
  let total = 0;
  multiPolygon.forEach((polygon) => polygon.forEach((ring, ringIndex) => {
    const points = ring.map(([x, y]) => ({ x, y }));
    const area = Math.abs(signedSectionRingArea(points));
    total += ringIndex === 0 ? area : -area;
  }));
  return total;
}

function resultToProfile(
  result: MultiPolygon,
  translation: Translation,
  toleranceMm: number,
  approximate: boolean,
): SectionProfileData {
  const rings: SectionRing[] = [];
  result.forEach((polygon) => polygon.forEach((ring, ringIndex) => {
    const points = ring.map(([x, y]) => ({ x: x + translation.x, y: y + translation.y }));
    if (points.length > 1) {
      const first = points[0];
      const last = points[points.length - 1];
      if (first.x === last.x && first.y === last.y) points.pop();
    }
    if (points.length >= 3) rings.push({ role: ringIndex === 0 ? 'outer' : 'hole', points });
  }));
  if (rings.length === 0) {
    throw new SectionBooleanError('empty-result', 'The Boolean operation removed the entire section.');
  }
  try {
    return normalizeSectionProfileData({
      version: 1,
      rings,
      analysisToleranceMm: toleranceMm,
      approximate,
    });
  } catch (error) {
    throw new SectionBooleanError(
      'invalid-input',
      error instanceof Error ? error.message : 'The Boolean result is invalid.',
    );
  }
}

function asProfileArray(
  first: SectionProfileData | readonly SectionProfileData[],
  rest: readonly SectionProfileData[],
): SectionProfileData[] {
  return (Array.isArray(first) ? [...first] : [first, ...rest]) as SectionProfileData[];
}

/** Unions one or more profiles while retaining disconnected material islands. */
export function unionSectionProfiles(
  profiles: readonly SectionProfileData[],
): SectionProfileData;
export function unionSectionProfiles(
  first: SectionProfileData,
  ...rest: SectionProfileData[]
): SectionProfileData;
export function unionSectionProfiles(
  first: SectionProfileData | readonly SectionProfileData[],
  ...rest: SectionProfileData[]
): SectionProfileData {
  const profiles = asProfileArray(first, rest).map(normalizeInput);
  if (profiles.length === 0) {
    throw new SectionBooleanError('empty-input', 'Union requires at least one section profile.');
  }
  const translation = profileTranslation(profiles);
  const geometries = profiles.map((profile) => profileToMultiPolygon(profile, translation));
  let result: MultiPolygon;
  try {
    // Run even a single MultiPolygon through the kernel: one converted Group
    // can itself contain overlapping outer rings that must not be double-counted.
    result = polygonClipping.union(geometries[0], ...geometries.slice(1));
  } catch (error) {
    throw new SectionBooleanError(
      'invalid-input',
      error instanceof Error ? error.message : 'The section union failed.',
    );
  }
  return resultToProfile(
    result,
    translation,
    Math.max(...profiles.map((profile) => profile.analysisToleranceMm)),
    profiles.some((profile) => profile.approximate),
  );
}

/** Subtracts one or more cutter profiles from the subject section. */
export function differenceSectionProfiles(
  subject: SectionProfileData,
  cutters: readonly SectionProfileData[],
): SectionProfileData;
export function differenceSectionProfiles(
  subject: SectionProfileData,
  cutter: SectionProfileData,
  ...rest: SectionProfileData[]
): SectionProfileData;
export function differenceSectionProfiles(
  subjectValue: SectionProfileData,
  firstCutter: SectionProfileData | readonly SectionProfileData[],
  ...restCutters: SectionProfileData[]
): SectionProfileData {
  const subject = normalizeInput(subjectValue);
  const cutters = asProfileArray(firstCutter, restCutters).map(normalizeInput);
  if (cutters.length === 0) {
    throw new SectionBooleanError('empty-input', 'Difference requires at least one cutter profile.');
  }
  const allProfiles = [subject, ...cutters];
  const translation = profileTranslation(allProfiles);
  const subjectGeometry = profileToMultiPolygon(subject, translation);
  const cutterGeometries = cutters.map((profile) => profileToMultiPolygon(profile, translation));
  let combinedCutter: MultiPolygon;
  let overlap: MultiPolygon;
  let result: MultiPolygon;
  try {
    combinedCutter = polygonClipping.union(cutterGeometries[0], ...cutterGeometries.slice(1));
    overlap = polygonClipping.intersection(subjectGeometry, combinedCutter);
    result = polygonClipping.difference(subjectGeometry, combinedCutter);
  } catch (error) {
    throw new SectionBooleanError(
      'invalid-input',
      error instanceof Error ? error.message : 'The section difference failed.',
    );
  }

  const toleranceMm = Math.max(...allProfiles.map((profile) => profile.analysisToleranceMm));
  const subjectBoundsArea = subject.rings
    .filter((ring) => ring.role === 'outer')
    .reduce((sum, ring) => sum + ringBoundsArea(ring.points), 0);
  const overlapEpsilon = Math.max(
    toleranceMm * toleranceMm * Number.EPSILON,
    subjectBoundsArea * Number.EPSILON * 64,
  );
  if (overlap.length === 0 || multiPolygonArea(overlap) <= overlapEpsilon) {
    throw new SectionBooleanError(
      'no-intersection',
      'The cutter does not overlap the section material.',
    );
  }
  return resultToProfile(
    result,
    translation,
    toleranceMm,
    allProfiles.some((profile) => profile.approximate),
  );
}
