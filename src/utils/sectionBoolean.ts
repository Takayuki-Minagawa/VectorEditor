import polygonClipping from 'polygon-clipping';
import type { MultiPolygon, Pair, Ring } from 'polygon-clipping';
import {
  CompensatedSum,
  normalizeSectionProfileData,
  sectionBoundsCentre,
  sectionProfileBounds,
  signedSectionRingArea,
  type SectionProfileData,
  type SectionRing,
} from '../domain/section';
import { pointInRing } from '../domain/sectionGeometryPredicates';

export type SectionBooleanErrorCode =
  | 'empty-input'
  | 'invalid-input'
  | 'numerical-instability'
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

function profileTranslation(profiles: readonly SectionProfileData[]): Translation {
  return sectionBoundsCentre(sectionProfileBounds(profiles));
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
      .filter(({ ring }) => pointInRing(representative, ring.points, 'include'))
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
  const total = new CompensatedSum();
  multiPolygon.forEach((polygon) => polygon.forEach((ring, ringIndex) => {
    const points = ring.map(([x, y]) => ({ x, y }));
    const area = Math.abs(signedSectionRingArea(points));
    total.add(ringIndex === 0 ? area : -area);
  }));
  return total.value();
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
  let result: MultiPolygon;
  try {
    combinedCutter = polygonClipping.union(cutterGeometries[0], ...cutterGeometries.slice(1));
    result = polygonClipping.difference(subjectGeometry, combinedCutter);
  } catch (error) {
    throw new SectionBooleanError(
      'invalid-input',
      error instanceof Error ? error.message : 'The section difference failed.',
    );
  }

  const toleranceMm = Math.max(...allProfiles.map((profile) => profile.analysisToleranceMm));
  const subjectArea = multiPolygonArea(subjectGeometry);
  const resultArea = multiPolygonArea(result);
  const removedArea = subjectArea - resultArea;
  // The Boolean kernel has already quantised all geometry in its translated
  // frame. This threshold covers only floating-point accumulation error; it
  // deliberately does not suppress a real overlap smaller than the UI's curve
  // approximation tolerance.
  const comparisonScale = Math.max(1, Math.abs(subjectArea), Math.abs(resultArea));
  const overlapEpsilon = comparisonScale * Number.EPSILON * 256;
  if (!Number.isFinite(removedArea) || removedArea < -overlapEpsilon) {
    throw new SectionBooleanError(
      'numerical-instability',
      'The section difference produced a non-physical area increase. Simplify the input geometry and retry.',
    );
  }
  if (removedArea <= overlapEpsilon) {
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
