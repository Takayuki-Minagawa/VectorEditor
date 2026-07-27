import type { BinaryImage, TracedPoint } from './tracedDrawing';
import { assertBinaryImage } from './preprocess';

export interface Centerline {
  points: TracedPoint[];
  closed: boolean;
  strokeWidth: number;
}

function foregroundAt(
  data: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  if (x < 0 || x >= width || y < 0 || y >= height) return 0;
  return data[y * width + x] === 0 ? 0 : 1;
}

function transitionCount(neighbours: readonly number[]): number {
  let transitions = 0;
  for (let index = 0; index < neighbours.length; index += 1) {
    if (
      neighbours[index] === 0
      && neighbours[(index + 1) % neighbours.length] === 1
    ) {
      transitions += 1;
    }
  }
  return transitions;
}

function thinningSubiteration(
  data: Uint8Array,
  width: number,
  height: number,
  second: boolean,
): boolean {
  const remove = new Uint8Array(data.length);
  let changed = false;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (data[index] === 0) continue;
      // Clockwise p2..p9: north, north-east, east, ..., north-west.
      const p2 = foregroundAt(data, width, height, x, y - 1);
      const p3 = foregroundAt(data, width, height, x + 1, y - 1);
      const p4 = foregroundAt(data, width, height, x + 1, y);
      const p5 = foregroundAt(data, width, height, x + 1, y + 1);
      const p6 = foregroundAt(data, width, height, x, y + 1);
      const p7 = foregroundAt(data, width, height, x - 1, y + 1);
      const p8 = foregroundAt(data, width, height, x - 1, y);
      const p9 = foregroundAt(data, width, height, x - 1, y - 1);
      const neighbours = [p2, p3, p4, p5, p6, p7, p8, p9];
      const count = neighbours.reduce((sum, value) => sum + value, 0);
      if (count < 2 || count > 6 || transitionCount(neighbours) !== 1) {
        continue;
      }

      const firstTriplet = second
        ? p2 * p4 * p8
        : p2 * p4 * p6;
      const secondTriplet = second
        ? p2 * p6 * p8
        : p4 * p6 * p8;
      if (firstTriplet === 0 && secondTriplet === 0) {
        remove[index] = 1;
        changed = true;
      }
    }
  }

  if (changed) {
    for (let index = 0; index < data.length; index += 1) {
      if (remove[index] !== 0) data[index] = 0;
    }
  }
  return changed;
}

/** Topology-preserving Zhang-Suen binary thinning. */
export function zhangSuenThinning(image: BinaryImage): BinaryImage {
  assertBinaryImage(image);
  const data = Uint8Array.from(image.data, (value) => value === 0 ? 0 : 1);
  let changed = true;
  while (changed) {
    const firstChanged = thinningSubiteration(
      data,
      image.width,
      image.height,
      false,
    );
    const secondChanged = thinningSubiteration(
      data,
      image.width,
      image.height,
      true,
    );
    changed = firstChanged || secondChanged;
  }
  return { width: image.width, height: image.height, data };
}

const GRAPH_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

/**
 * Uses 8-neighbour connectivity, but suppresses a diagonal shortcut when an
 * orthogonal route around the same corner exists.
 */
function skeletonNeighbours(image: BinaryImage, index: number): number[] {
  const x = index % image.width;
  const y = Math.floor(index / image.width);
  const neighbours: number[] = [];
  for (const [dx, dy] of GRAPH_OFFSETS) {
    const neighbourX = x + dx;
    const neighbourY = y + dy;
    if (
      neighbourX < 0
      || neighbourX >= image.width
      || neighbourY < 0
      || neighbourY >= image.height
    ) {
      continue;
    }
    const neighbourIndex = neighbourY * image.width + neighbourX;
    if (image.data[neighbourIndex] === 0) continue;
    if (dx !== 0 && dy !== 0) {
      const horizontal = y * image.width + neighbourX;
      const vertical = neighbourY * image.width + x;
      if (image.data[horizontal] !== 0 || image.data[vertical] !== 0) continue;
    }
    neighbours.push(neighbourIndex);
  }
  return neighbours;
}

function edgeKey(left: number, right: number): string {
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

function distanceToBackground(image: BinaryImage): Float64Array {
  const distance = new Float64Array(image.data.length);
  const diagonal = Math.SQRT2;
  for (let index = 0; index < distance.length; index += 1) {
    if (image.data[index] === 0) {
      distance[index] = 0;
      continue;
    }
    const x = index % image.width;
    const y = Math.floor(index / image.width);
    distance[index] = (
      x === 0
      || y === 0
      || x === image.width - 1
      || y === image.height - 1
    ) ? 1 : Number.POSITIVE_INFINITY;
  }

  const relax = (
    index: number,
    neighbourX: number,
    neighbourY: number,
    weight: number,
  ): void => {
    if (
      neighbourX < 0
      || neighbourX >= image.width
      || neighbourY < 0
      || neighbourY >= image.height
    ) {
      distance[index] = Math.min(distance[index], weight);
      return;
    }
    distance[index] = Math.min(
      distance[index],
      distance[neighbourY * image.width + neighbourX] + weight,
    );
  };

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = y * image.width + x;
      if (image.data[index] === 0) continue;
      relax(index, x - 1, y, 1);
      relax(index, x, y - 1, 1);
      relax(index, x - 1, y - 1, diagonal);
      relax(index, x + 1, y - 1, diagonal);
    }
  }
  for (let y = image.height - 1; y >= 0; y -= 1) {
    for (let x = image.width - 1; x >= 0; x -= 1) {
      const index = y * image.width + x;
      if (image.data[index] === 0) continue;
      relax(index, x + 1, y, 1);
      relax(index, x, y + 1, 1);
      relax(index, x + 1, y + 1, diagonal);
      relax(index, x - 1, y + 1, diagonal);
    }
  }
  return distance;
}

function widthFromIndices(
  indices: readonly number[],
  distances: Float64Array | undefined,
): number {
  if (!distances || indices.length === 0) return 1;
  const widths = indices.map((index) => {
    // Pixel-centre distance d corresponds to a physical width of 2d - 1.
    return Math.max(1, 2 * distances[index] - 1);
  }).sort((left, right) => left - right);
  // Endpoints are close to background along the stroke direction, which would
  // bias a plain mean downward. The median estimates the cross-stroke width
  // while remaining stable at junctions and tapered caps.
  const middle = Math.floor(widths.length / 2);
  return widths.length % 2 === 0
    ? (widths[middle - 1] + widths[middle]) / 2
    : widths[middle];
}

function indicesToCenterline(
  indices: readonly number[],
  width: number,
  closed: boolean,
  distances: Float64Array | undefined,
): Centerline {
  return {
    points: indices.map((index) => ({
      x: index % width + 0.5,
      y: Math.floor(index / width) + 0.5,
    })),
    closed,
    strokeWidth: widthFromIndices(indices, distances),
  };
}

/**
 * Converts a one-pixel skeleton graph into maximal node-to-node polylines.
 * Branches become separate editable paths; pure loops remain closed.
 */
export function extractCenterlines(
  skeleton: BinaryImage,
  source?: BinaryImage,
): Centerline[] {
  assertBinaryImage(skeleton);
  if (
    source
    && (
      source.width !== skeleton.width
      || source.height !== skeleton.height
    )
  ) {
    throw new RangeError('Stroke-width source must match the skeleton size.');
  }
  if (source) assertBinaryImage(source);

  const neighbours = new Map<number, number[]>();
  for (let index = 0; index < skeleton.data.length; index += 1) {
    if (skeleton.data[index] !== 0) {
      neighbours.set(index, skeletonNeighbours(skeleton, index));
    }
  }
  const distances = source ? distanceToBackground(source) : undefined;
  const visitedEdges = new Set<string>();
  const lines: Centerline[] = [];
  const degree = (index: number): number => neighbours.get(index)?.length ?? 0;

  for (const [node, adjacent] of neighbours) {
    if (adjacent.length === 0) {
      lines.push(indicesToCenterline([node], skeleton.width, false, distances));
      continue;
    }
    if (adjacent.length === 2) continue;
    for (const firstNeighbour of adjacent) {
      const firstKey = edgeKey(node, firstNeighbour);
      if (visitedEdges.has(firstKey)) continue;
      const path = [node];
      let previous = node;
      let current = firstNeighbour;
      visitedEdges.add(firstKey);

      while (true) {
        path.push(current);
        if (degree(current) !== 2) break;
        const next = (neighbours.get(current) ?? []).find(
          (candidate) => candidate !== previous,
        );
        if (next === undefined) break;
        const key = edgeKey(current, next);
        if (visitedEdges.has(key)) break;
        visitedEdges.add(key);
        previous = current;
        current = next;
      }
      lines.push(indicesToCenterline(path, skeleton.width, false, distances));
    }
  }

  // Every edge in a pure loop connects degree-two nodes and was skipped above.
  for (const [start, adjacent] of neighbours) {
    for (const firstNeighbour of adjacent) {
      const firstKey = edgeKey(start, firstNeighbour);
      if (visitedEdges.has(firstKey)) continue;
      const path = [start];
      let previous = start;
      let current = firstNeighbour;
      visitedEdges.add(firstKey);
      let closed = false;

      while (true) {
        if (current === start) {
          closed = true;
          break;
        }
        path.push(current);
        const next = (neighbours.get(current) ?? []).find(
          (candidate) => (
            candidate !== previous
            && !visitedEdges.has(edgeKey(current, candidate))
          ),
        );
        if (next === undefined) break;
        visitedEdges.add(edgeKey(current, next));
        previous = current;
        current = next;
      }
      lines.push(indicesToCenterline(path, skeleton.width, closed, distances));
    }
  }
  return lines;
}

export function estimateStrokeWidth(
  source: BinaryImage,
  points: readonly TracedPoint[],
): number {
  assertBinaryImage(source);
  const distances = distanceToBackground(source);
  const indices = points
    .map((point) => {
      const x = Math.floor(point.x);
      const y = Math.floor(point.y);
      return x >= 0 && x < source.width && y >= 0 && y < source.height
        ? y * source.width + x
        : -1;
    })
    .filter((index) => index >= 0 && source.data[index] !== 0);
  return widthFromIndices(indices, distances);
}
