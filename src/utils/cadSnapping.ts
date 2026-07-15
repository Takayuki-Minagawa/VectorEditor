import * as fabric from 'fabric';
import type { ObjectAnchorKind, SemanticAnchor } from './fabricObjectMetadata';
import { getFabricMetadata } from './fabricObjectMetadata';
import { collectFabricObjectTree } from './fabricObjectTree';

export type CadSnapKind = 'endpoint' | 'midpoint' | 'center' | 'intersection';

export interface CadSnapCandidate {
  point: { x: number; y: number };
  kind: CadSnapKind;
  objectId?: string;
  anchor?: ObjectAnchorKind;
  vertexIndex?: number;
}

interface Segment {
  start: { x: number; y: number };
  end: { x: number; y: number };
  object: fabric.FabricObject;
}

interface ObjectSnapGeometry {
  candidates: CadSnapCandidate[];
  segments: Segment[];
}

const EPSILON = 1e-8;
const MAX_INTERSECTION_SEGMENTS = 300;

function transformLocalPoint(
  object: fabric.FabricObject,
  x: number,
  y: number,
): { x: number; y: number } {
  const point = fabric.util.transformPoint(
    new fabric.Point(x, y),
    object.calcTransformMatrix(),
  );
  return { x: point.x, y: point.y };
}

function objectIdOf(object: fabric.FabricObject): string | undefined {
  return getFabricMetadata(object).id;
}

function addCandidate(
  candidates: CadSnapCandidate[],
  object: fabric.FabricObject,
  point: { x: number; y: number },
  kind: CadSnapKind,
  anchor?: ObjectAnchorKind,
  vertexIndex?: number,
): void {
  candidates.push({
    point,
    kind,
    objectId: objectIdOf(object),
    anchor,
    vertexIndex,
  });
}

function midpoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function lineGeometry(line: fabric.Line): ObjectSnapGeometry {
  const centerX = (line.x1 + line.x2) / 2;
  const centerY = (line.y1 + line.y2) / 2;
  const start = transformLocalPoint(line, line.x1 - centerX, line.y1 - centerY);
  const end = transformLocalPoint(line, line.x2 - centerX, line.y2 - centerY);
  const candidates: CadSnapCandidate[] = [];
  addCandidate(candidates, line, start, 'endpoint', 'start');
  addCandidate(candidates, line, end, 'endpoint', 'end');
  addCandidate(candidates, line, midpoint(start, end), 'midpoint', 'midpoint');
  return { candidates, segments: [{ start, end, object: line }] };
}

function polyGeometry(
  poly: fabric.Polygon | fabric.Polyline,
  closed: boolean,
): ObjectSnapGeometry {
  const pathOffset = poly.pathOffset ?? new fabric.Point(0, 0);
  const points = poly.points.map((point) =>
    transformLocalPoint(poly, point.x - pathOffset.x, point.y - pathOffset.y));
  const candidates: CadSnapCandidate[] = [];
  const segments: Segment[] = [];

  points.forEach((point, index) => {
    addCandidate(candidates, poly, point, 'endpoint', 'vertex', index);
  });

  const segmentCount = closed ? points.length : Math.max(0, points.length - 1);
  for (let index = 0; index < segmentCount; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    if (!start || !end) continue;
    segments.push({ start, end, object: poly });
    addCandidate(candidates, poly, midpoint(start, end), 'midpoint', 'midpoint', index);
  }

  if (points.length > 0) {
    addCandidate(candidates, poly, poly.getCenterPoint(), 'center', 'center');
  }
  return { candidates, segments };
}

function boxGeometry(object: fabric.FabricObject): ObjectSnapGeometry {
  const coords = object.getCoords();
  if (coords.length < 4) {
    const center = object.getCenterPoint();
    return {
      candidates: [{
        point: center,
        kind: 'center',
        objectId: objectIdOf(object),
        anchor: 'center',
      }],
      segments: [],
    };
  }

  const [topLeft, topRight, bottomRight, bottomLeft] = coords;
  const corners = [topLeft, topRight, bottomRight, bottomLeft];
  const cornerAnchors: ObjectAnchorKind[] = [
    'topLeft',
    'topRight',
    'bottomRight',
    'bottomLeft',
  ];
  const edgeAnchors: ObjectAnchorKind[] = ['top', 'right', 'bottom', 'left'];
  const candidates: CadSnapCandidate[] = [];
  const segments: Segment[] = [];

  corners.forEach((point, index) => {
    addCandidate(candidates, object, point, 'endpoint', cornerAnchors[index]);
    const next = corners[(index + 1) % corners.length];
    segments.push({ start: point, end: next, object });
    addCandidate(candidates, object, midpoint(point, next), 'midpoint', edgeAnchors[index]);
  });
  addCandidate(candidates, object, object.getCenterPoint(), 'center', 'center');
  return { candidates, segments };
}

export function getObjectSnapGeometry(object: fabric.FabricObject): ObjectSnapGeometry {
  if (object instanceof fabric.Line) return lineGeometry(object);
  if (object instanceof fabric.Polygon) return polyGeometry(object, true);
  if (object instanceof fabric.Polyline) return polyGeometry(object, false);

  const metadata = getFabricMetadata(object);
  if (metadata.objectKind === 'dimension' && metadata.dimensionData) {
    const { start, end } = metadata.dimensionData;
    const candidates: CadSnapCandidate[] = [];
    addCandidate(candidates, object, start, 'endpoint', 'start');
    addCandidate(candidates, object, end, 'endpoint', 'end');
    addCandidate(candidates, object, midpoint(start, end), 'midpoint', 'midpoint');
    return { candidates, segments: [{ start, end, object }] };
  }
  if (metadata.objectKind === 'connector' && metadata.connectorData) {
    const { from, to } = metadata.connectorData;
    const candidates: CadSnapCandidate[] = [];
    addCandidate(candidates, object, from, 'endpoint', 'start');
    addCandidate(candidates, object, to, 'endpoint', 'end');
    addCandidate(candidates, object, midpoint(from, to), 'midpoint', 'midpoint');
    return { candidates, segments: [{ start: from, end: to, object }] };
  }

  if (object instanceof fabric.Circle || object instanceof fabric.Ellipse) {
    const center = object.getCenterPoint();
    return {
      candidates: [{
        point: center,
        kind: 'center',
        objectId: objectIdOf(object),
        anchor: 'center',
      }],
      segments: [],
    };
  }
  return boxGeometry(object);
}

function segmentIntersection(a: Segment, b: Segment): { x: number; y: number } | null {
  const ax = a.end.x - a.start.x;
  const ay = a.end.y - a.start.y;
  const bx = b.end.x - b.start.x;
  const by = b.end.y - b.start.y;
  const denominator = ax * by - ay * bx;
  if (Math.abs(denominator) < EPSILON) return null;

  const dx = b.start.x - a.start.x;
  const dy = b.start.y - a.start.y;
  const ta = (dx * by - dy * bx) / denominator;
  const tb = (dx * ay - dy * ax) / denominator;
  if (ta < -EPSILON || ta > 1 + EPSILON || tb < -EPSILON || tb > 1 + EPSILON) {
    return null;
  }
  return { x: a.start.x + ta * ax, y: a.start.y + ta * ay };
}

function distanceSquared(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

const SNAP_KIND_PRIORITY: Record<CadSnapKind, number> = {
  endpoint: 0,
  intersection: 1,
  midpoint: 2,
  center: 3,
};

export function findCadSnap(
  objects: readonly fabric.FabricObject[],
  pointer: { x: number; y: number },
  thresholdScene: number,
): CadSnapCandidate | null {
  if (!Number.isFinite(thresholdScene) || thresholdScene <= 0) return null;
  const geometries = objects
    .filter((object) => object.visible !== false)
    .map((object) => getObjectSnapGeometry(object));
  const candidates = geometries.flatMap((geometry) => geometry.candidates);
  const segments = geometries.flatMap((geometry) => geometry.segments)
    .slice(0, MAX_INTERSECTION_SEGMENTS);

  for (let left = 0; left < segments.length; left += 1) {
    for (let right = left + 1; right < segments.length; right += 1) {
      const a = segments[left];
      const b = segments[right];
      if (a.object === b.object) continue;
      const point = segmentIntersection(a, b);
      if (point && distanceSquared(point, pointer) <= thresholdScene * thresholdScene) {
        candidates.push({ point, kind: 'intersection' });
      }
    }
  }

  const maxDistanceSquared = thresholdScene * thresholdScene;
  let best: CadSnapCandidate | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = distanceSquared(candidate.point, pointer);
    if (distance > maxDistanceSquared) continue;
    if (
      distance < bestDistance - EPSILON
      || (
        Math.abs(distance - bestDistance) <= EPSILON
        && best
        && SNAP_KIND_PRIORITY[candidate.kind] < SNAP_KIND_PRIORITY[best.kind]
      )
    ) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

export function snapCandidateToAnchor(candidate: CadSnapCandidate): SemanticAnchor {
  return {
    x: candidate.point.x,
    y: candidate.point.y,
    objectId: candidate.objectId,
    anchor: candidate.anchor,
    vertexIndex: candidate.vertexIndex,
  };
}

export function resolveSemanticAnchor(
  anchor: SemanticAnchor,
  objects: readonly fabric.FabricObject[],
): { x: number; y: number } {
  const objectIndex = new Map<string, fabric.FabricObject>();
  collectFabricObjectTree(objects).forEach((object) => {
    const id = objectIdOf(object);
    if (id) objectIndex.set(id, object);
  });
  return resolveSemanticAnchorFromIndex(anchor, objectIndex);
}

/**
 * Resolve an associative anchor against an index built by the caller.
 *
 * Batch semantic refreshes use this entry point so resolving D dimensions or
 * connectors does not repeatedly scan the same N-object Fabric tree.
 */
export function resolveSemanticAnchorFromIndex(
  anchor: SemanticAnchor,
  objectIndex: ReadonlyMap<string, fabric.FabricObject>,
): { x: number; y: number } {
  if (!anchor.objectId || !anchor.anchor) return { x: anchor.x, y: anchor.y };
  const object = objectIndex.get(anchor.objectId);
  if (!object) return { x: anchor.x, y: anchor.y };
  const match = getObjectSnapGeometry(object).candidates.find((candidate) =>
    candidate.anchor === anchor.anchor
    && candidate.vertexIndex === anchor.vertexIndex);
  return match?.point ?? { x: anchor.x, y: anchor.y };
}
