/**
 * Geometry helpers for Fabric's simplified path command arrays (M/L/C/Q/Z with
 * absolute coordinates). All coordinates are raw command-space values, i.e. the
 * numbers stored in `fabric.Path#path` before `pathOffset` is subtracted.
 */

export type SimplePathCommand = [type: string, ...coords: number[]];

export interface PathPoint {
  x: number;
  y: number;
}

export type PathSegmentKind = 'line' | 'cubic' | 'quadratic' | 'close';

export interface PathSegment {
  /** Index of the command that terminates this segment ('Z' for close). */
  commandIndex: number;
  kind: PathSegmentKind;
  start: PathPoint;
  end: PathPoint;
  control1?: PathPoint;
  control2?: PathPoint;
}

export interface PathAnchor {
  /** Index of the command whose endpoint is this anchor (M/L/C/Q). */
  commandIndex: number;
  point: PathPoint;
}

export interface NearestPathPointHit {
  segment: PathSegment;
  t: number;
  point: PathPoint;
  distanceSquared: number;
}

const ANCHOR_COMMANDS = new Set(['M', 'L', 'C', 'Q']);

function lerp(a: PathPoint, b: PathPoint, t: number): PathPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function distanceSquared(a: PathPoint, b: PathPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function cubicPointAt(
  p0: PathPoint,
  c1: PathPoint,
  c2: PathPoint,
  p1: PathPoint,
  t: number,
): PathPoint {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return {
    x: w0 * p0.x + w1 * c1.x + w2 * c2.x + w3 * p1.x,
    y: w0 * p0.y + w1 * c1.y + w2 * c2.y + w3 * p1.y,
  };
}

export function quadraticPointAt(
  p0: PathPoint,
  control: PathPoint,
  p1: PathPoint,
  t: number,
): PathPoint {
  const u = 1 - t;
  const w0 = u * u;
  const w1 = 2 * u * t;
  const w2 = t * t;
  return {
    x: w0 * p0.x + w1 * control.x + w2 * p1.x,
    y: w0 * p0.y + w1 * control.y + w2 * p1.y,
  };
}

export interface CubicSplit {
  first: { control1: PathPoint; control2: PathPoint; end: PathPoint };
  second: { control1: PathPoint; control2: PathPoint; end: PathPoint };
}

/** de Casteljau subdivision: both halves reproduce the original curve exactly. */
export function splitCubicAt(
  p0: PathPoint,
  c1: PathPoint,
  c2: PathPoint,
  p1: PathPoint,
  t: number,
): CubicSplit {
  const p01 = lerp(p0, c1, t);
  const p12 = lerp(c1, c2, t);
  const p23 = lerp(c2, p1, t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const mid = lerp(p012, p123, t);
  return {
    first: { control1: p01, control2: p012, end: mid },
    second: { control1: p123, control2: p23, end: p1 },
  };
}

export interface QuadraticSplit {
  first: { control: PathPoint; end: PathPoint };
  second: { control: PathPoint; end: PathPoint };
}

export function splitQuadraticAt(
  p0: PathPoint,
  control: PathPoint,
  p1: PathPoint,
  t: number,
): QuadraticSplit {
  const p01 = lerp(p0, control, t);
  const p12 = lerp(control, p1, t);
  const mid = lerp(p01, p12, t);
  return {
    first: { control: p01, end: mid },
    second: { control: p12, end: p1 },
  };
}

/**
 * Enumerates drawable segments. Unknown command types make the current point
 * untrackable, so the enumeration returns an empty list instead of guessing.
 */
export function listPathSegments(path: readonly SimplePathCommand[]): PathSegment[] {
  const segments: PathSegment[] = [];
  let current: PathPoint | null = null;
  let subpathStart: PathPoint | null = null;

  for (let index = 0; index < path.length; index += 1) {
    const command = path[index];
    const type = command[0];
    if (type === 'M') {
      current = { x: command[1] as number, y: command[2] as number };
      subpathStart = current;
    } else if (type === 'L') {
      if (!current) return [];
      const end = { x: command[1] as number, y: command[2] as number };
      segments.push({ commandIndex: index, kind: 'line', start: current, end });
      current = end;
    } else if (type === 'C') {
      if (!current) return [];
      const end = { x: command[5] as number, y: command[6] as number };
      segments.push({
        commandIndex: index,
        kind: 'cubic',
        start: current,
        end,
        control1: { x: command[1] as number, y: command[2] as number },
        control2: { x: command[3] as number, y: command[4] as number },
      });
      current = end;
    } else if (type === 'Q') {
      if (!current) return [];
      const end = { x: command[3] as number, y: command[4] as number };
      segments.push({
        commandIndex: index,
        kind: 'quadratic',
        start: current,
        end,
        control1: { x: command[1] as number, y: command[2] as number },
      });
      current = end;
    } else if (type === 'Z' || type === 'z') {
      if (!current || !subpathStart) return [];
      if (distanceSquared(current, subpathStart) > Number.EPSILON) {
        segments.push({ commandIndex: index, kind: 'close', start: current, end: subpathStart });
      }
      current = subpathStart;
    } else {
      return [];
    }
  }
  return segments;
}

export function pointOnSegment(segment: PathSegment, t: number): PathPoint {
  if (segment.kind === 'cubic') {
    return cubicPointAt(segment.start, segment.control1!, segment.control2!, segment.end, t);
  }
  if (segment.kind === 'quadratic') {
    return quadraticPointAt(segment.start, segment.control1!, segment.end, t);
  }
  return lerp(segment.start, segment.end, t);
}

function projectOnLine(segment: PathSegment, point: PathPoint): number {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= Number.EPSILON) return 0;
  const t = ((point.x - segment.start.x) * dx + (point.y - segment.start.y) * dy) / lengthSquared;
  return Math.min(1, Math.max(0, t));
}

const CURVE_SAMPLES = 32;
const CURVE_REFINE_ITERATIONS = 40;

function nearestOnSegment(segment: PathSegment, point: PathPoint): { t: number; point: PathPoint } {
  if (segment.kind === 'line' || segment.kind === 'close') {
    const t = projectOnLine(segment, point);
    return { t, point: pointOnSegment(segment, t) };
  }

  let bestT = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let sample = 0; sample <= CURVE_SAMPLES; sample += 1) {
    const t = sample / CURVE_SAMPLES;
    const distance = distanceSquared(pointOnSegment(segment, t), point);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestT = t;
    }
  }

  let low = Math.max(0, bestT - 1 / CURVE_SAMPLES);
  let high = Math.min(1, bestT + 1 / CURVE_SAMPLES);
  for (let iteration = 0; iteration < CURVE_REFINE_ITERATIONS; iteration += 1) {
    const leftT = low + (high - low) / 3;
    const rightT = high - (high - low) / 3;
    const leftDistance = distanceSquared(pointOnSegment(segment, leftT), point);
    const rightDistance = distanceSquared(pointOnSegment(segment, rightT), point);
    if (leftDistance < rightDistance) high = rightT;
    else low = leftT;
  }
  const t = (low + high) / 2;
  return { t, point: pointOnSegment(segment, t) };
}

export function findNearestPathPoint(
  path: readonly SimplePathCommand[],
  point: PathPoint,
): NearestPathPointHit | null {
  let best: NearestPathPointHit | null = null;
  for (const segment of listPathSegments(path)) {
    const nearest = nearestOnSegment(segment, point);
    const distance = distanceSquared(nearest.point, point);
    if (!best || distance < best.distanceSquared) {
      best = { segment, t: nearest.t, point: nearest.point, distanceSquared: distance };
    }
  }
  return best;
}

/**
 * Inserts an anchor on the hit segment without changing the drawn geometry.
 * Returns the command index that now terminates at the new anchor.
 */
export function insertAnchorOnSegment(
  path: SimplePathCommand[],
  hit: NearestPathPointHit,
): number {
  const { segment, t, point } = hit;
  const index = segment.commandIndex;
  if (segment.kind === 'line' || segment.kind === 'close') {
    path.splice(index, 0, ['L', point.x, point.y]);
    return index;
  }
  if (segment.kind === 'cubic') {
    const split = splitCubicAt(segment.start, segment.control1!, segment.control2!, segment.end, t);
    path.splice(
      index,
      1,
      ['C', split.first.control1.x, split.first.control1.y, split.first.control2.x, split.first.control2.y, split.first.end.x, split.first.end.y],
      ['C', split.second.control1.x, split.second.control1.y, split.second.control2.x, split.second.control2.y, split.second.end.x, split.second.end.y],
    );
    return index;
  }
  const split = splitQuadraticAt(segment.start, segment.control1!, segment.end, t);
  path.splice(
    index,
    1,
    ['Q', split.first.control.x, split.first.control.y, split.first.end.x, split.first.end.y],
    ['Q', split.second.control.x, split.second.control.y, split.second.end.x, split.second.end.y],
  );
  return index;
}

export function listPathAnchors(path: readonly SimplePathCommand[]): PathAnchor[] {
  const anchors: PathAnchor[] = [];
  for (let index = 0; index < path.length; index += 1) {
    const command = path[index];
    if (!ANCHOR_COMMANDS.has(command[0])) continue;
    const x = command[command.length - 2] as number;
    const y = command[command.length - 1] as number;
    anchors.push({ commandIndex: index, point: { x, y } });
  }
  return anchors;
}

interface SubpathRange {
  start: number;
  /** Exclusive end index. */
  end: number;
  closed: boolean;
  anchorCount: number;
}

function subpathContaining(path: readonly SimplePathCommand[], commandIndex: number): SubpathRange | null {
  let start = -1;
  for (let index = 0; index < path.length; index += 1) {
    if (path[index][0] === 'M') {
      if (index > commandIndex) break;
      start = index;
    }
  }
  if (start < 0) return null;
  let end = path.length;
  for (let index = start + 1; index < path.length; index += 1) {
    if (path[index][0] === 'M') {
      end = index;
      break;
    }
  }
  let closed = false;
  let anchorCount = 0;
  for (let index = start; index < end; index += 1) {
    const type = path[index][0];
    if (ANCHOR_COMMANDS.has(type)) anchorCount += 1;
    if (type === 'Z' || type === 'z') closed = true;
  }
  return { start, end, closed, anchorCount };
}

/**
 * Removes the anchor terminated by `commandIndex`. Neighbouring curve control
 * points are re-joined so the remaining path departs with the deleted
 * segment's original tangent. Returns false when the subpath would fall below
 * its minimum anchor count (2 for open, 3 for closed subpaths).
 */
export function deletePathAnchor(path: SimplePathCommand[], commandIndex: number): boolean {
  const command = path[commandIndex];
  if (!command || !ANCHOR_COMMANDS.has(command[0])) return false;
  const range = subpathContaining(path, commandIndex);
  if (!range) return false;
  const minimumAnchors = range.closed ? 3 : 2;
  if (range.anchorCount - 1 < minimumAnchors) return false;

  if (command[0] === 'M') {
    const next = path[commandIndex + 1];
    if (!next || !ANCHOR_COMMANDS.has(next[0])) return false;
    const x = next[next.length - 2] as number;
    const y = next[next.length - 1] as number;
    path.splice(commandIndex, 2, ['M', x, y]);
    return true;
  }

  const next = commandIndex + 1 < range.end ? path[commandIndex + 1] : null;
  if (next && command[0] === next[0] && (command[0] === 'C' || command[0] === 'Q')) {
    // Preserve the departure tangent of the merged segment.
    next[1] = command[1];
    next[2] = command[2];
  }
  path.splice(commandIndex, 1);
  return true;
}
