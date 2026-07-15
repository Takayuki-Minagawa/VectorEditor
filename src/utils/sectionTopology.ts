import polygonClipping from 'polygon-clipping';
import type { MultiPolygon, Pair, Ring } from 'polygon-clipping';
import {
  CompensatedSum,
  normalizeSectionProfileData,
  sectionBoundsCentre,
  sectionProfileBounds,
  signedSectionRingArea,
  type NormalizedSectionProfileData,
  type SectionPoint,
  type SectionProfileData,
  type SectionRing,
} from '../domain/section';
import { locatePointInRing, segmentsIntersect } from '../domain/sectionGeometryPredicates';

const MAX_TOPOLOGY_CACHE_ENTRIES = 32;
const MAX_TOPOLOGY_CACHE_KEY_CHARACTERS = 4_000_000;
const validTopologyKeys = new Map<string, number>();
let validTopologyKeyCharacters = 0;

export class SectionTopologyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SectionTopologyError';
  }
}

interface Segment {
  index: number;
  source: number;
  start: SectionPoint;
  end: SectionPoint;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function ringSegments(points: readonly SectionPoint[], source: number): Segment[] {
  return points.map((start, index) => {
    const end = points[(index + 1) % points.length];
    return {
      index,
      source,
      start,
      end,
      minX: Math.min(start.x, end.x),
      maxX: Math.max(start.x, end.x),
      minY: Math.min(start.y, end.y),
      maxY: Math.max(start.y, end.y),
    };
  });
}

function ringHasSelfIntersection(points: readonly SectionPoint[]): boolean {
  const segments = ringSegments(points, 0).sort((a, b) => a.minX - b.minX);
  for (let firstIndex = 0; firstIndex < segments.length; firstIndex += 1) {
    const first = segments[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < segments.length; secondIndex += 1) {
      const second = segments[secondIndex];
      if (second.minX > first.maxX) break;
      const adjacent = Math.abs(first.index - second.index) === 1
        || Math.abs(first.index - second.index) === points.length - 1;
      if (adjacent || second.minY > first.maxY || second.maxY < first.minY) continue;
      if (segmentsIntersect(first.start, first.end, second.start, second.end)) return true;
    }
  }
  return false;
}

function ringBoundariesIntersect(
  firstPoints: readonly SectionPoint[],
  secondPoints: readonly SectionPoint[],
): boolean {
  const segments = [
    ...ringSegments(firstPoints, 0),
    ...ringSegments(secondPoints, 1),
  ].sort((a, b) => a.minX - b.minX);
  for (let firstIndex = 0; firstIndex < segments.length; firstIndex += 1) {
    const first = segments[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < segments.length; secondIndex += 1) {
      const second = segments[secondIndex];
      if (second.minX > first.maxX) break;
      if (first.source === second.source || second.minY > first.maxY || second.maxY < first.minY) continue;
      if (segmentsIntersect(first.start, first.end, second.start, second.end)) return true;
    }
  }
  return false;
}

function translateRing(ring: SectionRing, translation: SectionPoint): Ring {
  return [
    ...ring.points.map((point): Pair => [
      point.x - translation.x,
      point.y - translation.y,
    ]),
    [
      ring.points[0].x - translation.x,
      ring.points[0].y - translation.y,
    ],
  ];
}

function multiPolygonArea(value: MultiPolygon): number {
  const area = new CompensatedSum();
  value.forEach((polygon) => polygon.forEach((ring, ringIndex) => {
    const points = ring.map(([x, y]) => ({ x, y }));
    const ringArea = Math.abs(signedSectionRingArea(points));
    area.add(ringIndex === 0 ? ringArea : -ringArea);
  }));
  return area.value();
}

function topologyCacheKey(profile: SectionProfileData): string {
  // Full normalized content is the key. Unlike a WeakMap keyed by a mutable
  // profile object, in-place point edits necessarily produce a different key.
  return JSON.stringify(profile);
}

function hasCachedTopology(key: string): boolean {
  const size = validTopologyKeys.get(key);
  if (size === undefined) return false;
  validTopologyKeys.delete(key);
  validTopologyKeys.set(key, size);
  return true;
}

function rememberValidTopology(key: string): void {
  if (key.length > MAX_TOPOLOGY_CACHE_KEY_CHARACTERS) return;
  validTopologyKeys.set(key, key.length);
  validTopologyKeyCharacters += key.length;
  while (
    validTopologyKeys.size > MAX_TOPOLOGY_CACHE_ENTRIES
    || validTopologyKeyCharacters > MAX_TOPOLOGY_CACHE_KEY_CHARACTERS
  ) {
    const oldest = validTopologyKeys.entries().next().value as [string, number] | undefined;
    if (!oldest) break;
    validTopologyKeys.delete(oldest[0]);
    validTopologyKeyCharacters -= oldest[1];
  }
}

/**
 * Validates relationships that structural ring validation cannot establish:
 * simple boundaries, hole containment, and non-overlapping material/void
 * regions. Point/line contact between separate material outers is allowed.
 */
export function assertValidNormalizedSectionProfileTopology(profile: NormalizedSectionProfileData): void {
  const cacheKey = topologyCacheKey(profile);
  if (hasCachedTopology(cacheKey)) return;

  profile.rings.forEach((ring, ringIndex) => {
    if (ringHasSelfIntersection(ring.points)) {
      throw new SectionTopologyError(`Section ring ${ringIndex} is self-intersecting.`);
    }
  });

  const outers = profile.rings.filter((ring) => ring.role === 'outer');
  const holes = profile.rings.filter((ring) => ring.role === 'hole');
  const holesByOuter = new Map<SectionRing, SectionRing[]>();
  outers.forEach((outer) => holesByOuter.set(outer, []));

  for (const hole of holes) {
    const containers = outers.filter((outer) => {
      if (ringBoundariesIntersect(hole.points, outer.points)) {
        throw new SectionTopologyError('A section hole must not cross or touch an outer boundary.');
      }
      return locatePointInRing(hole.points[0], outer.points) === 'inside';
    });
    if (containers.length !== 1) {
      throw new SectionTopologyError('Every section hole must be contained by exactly one outer boundary.');
    }
    holesByOuter.get(containers[0])?.push(hole);
  }

  const translation = sectionBoundsCentre(sectionProfileBounds(profile));
  const geometry: MultiPolygon = outers.map((outer) => [
    translateRing(outer, translation),
    ...(holesByOuter.get(outer) ?? []).map((hole) => translateRing(hole, translation)),
  ]);
  let normalized: MultiPolygon;
  try {
    normalized = polygonClipping.union(geometry);
  } catch (error) {
    throw new SectionTopologyError(
      error instanceof Error ? error.message : 'Section ring topology is invalid.',
    );
  }

  const signedInputAreaSum = new CompensatedSum();
  const absoluteInputAreaSum = new CompensatedSum();
  profile.rings.forEach((ring) => {
    const ringArea = signedSectionRingArea(ring.points);
    signedInputAreaSum.add(ringArea);
    absoluteInputAreaSum.add(Math.abs(ringArea));
  });
  const signedInputArea = signedInputAreaSum.value();
  const absoluteInputArea = absoluteInputAreaSum.value();
  const normalizedArea = multiPolygonArea(normalized);
  const areaTolerance = Math.max(
    profile.analysisToleranceMm ** 2,
    Math.max(1, absoluteInputArea, Math.abs(normalizedArea)) * 1e-10,
  );
  if (
    signedInputArea <= areaTolerance
    || Math.abs(signedInputArea - normalizedArea) > areaTolerance
  ) {
    throw new SectionTopologyError('Section outer or hole rings overlap or have inconsistent topology.');
  }
  rememberValidTopology(cacheKey);
}

/** Normalizes exactly once, validates topology, and returns the analyzed copy. */
export function normalizeAndAssertValidSectionProfileTopology(
  value: SectionProfileData,
): NormalizedSectionProfileData {
  const profile = normalizeSectionProfileData(value);
  assertValidNormalizedSectionProfileTopology(profile);
  return profile;
}

export function assertValidSectionProfileTopology(value: SectionProfileData): void {
  void normalizeAndAssertValidSectionProfileTopology(value);
}
