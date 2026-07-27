import type { BinaryImage, TracedPoint } from './tracedDrawing';
import { assertBinaryImage } from './preprocess';

export interface ComponentBounds {
  minX: number;
  minY: number;
  /** Exclusive maximum x coordinate. */
  maxX: number;
  /** Exclusive maximum y coordinate. */
  maxY: number;
  width: number;
  height: number;
}

export interface ConnectedComponent {
  /** Labels start at 1. Zero is reserved for background. */
  id: number;
  area: number;
  bounds: ComponentBounds;
}

export interface ConnectedComponentsResult {
  width: number;
  height: number;
  labels: Int32Array;
  components: ConnectedComponent[];
}

export interface Contour {
  componentId: number;
  points: TracedPoint[];
  closed: true;
  isHole: boolean;
  /** Absolute polygon area in pixel units. */
  area: number;
}

export interface ExtractContoursOptions {
  /**
   * Maximum number of raw pixel-boundary edges retained before cycle tracing.
   * This protects the pre-simplification stage from adversarial/noisy images.
   */
  maxBoundaryEdges?: number;
}

export class ContourBoundaryEdgeLimitError extends Error {
  readonly code = 'BOUNDARY_EDGE_LIMIT_EXCEEDED' as const;
  readonly maxBoundaryEdges: number;
  readonly attemptedBoundaryEdges: number;

  constructor(maxBoundaryEdges: number, attemptedBoundaryEdges: number) {
    super(
      `Contour boundary edge limit exceeded: attempted ${attemptedBoundaryEdges} `
      + `edges, maximum ${maxBoundaryEdges}. Reduce image complexity or increase `
      + 'the trace vertex limit.',
    );
    this.name = 'ContourBoundaryEdgeLimitError';
    this.maxBoundaryEdges = maxBoundaryEdges;
    this.attemptedBoundaryEdges = attemptedBoundaryEdges;
  }
}

export interface LabelConnectedComponentsOptions {
  /** Maximum retained components before labeling stops. */
  maxComponents?: number;
}

export class ConnectedComponentLimitError extends Error {
  readonly code = 'CONNECTED_COMPONENT_LIMIT_EXCEEDED' as const;
  readonly maxComponents: number;
  readonly attemptedComponents: number;

  constructor(maxComponents: number, attemptedComponents: number) {
    super(
      `Connected component limit exceeded: attempted ${attemptedComponents} `
      + `components, maximum ${maxComponents}. Reduce image complexity or `
      + 'increase the trace vertex limit.',
    );
    this.name = 'ConnectedComponentLimitError';
    this.maxComponents = maxComponents;
    this.attemptedComponents = attemptedComponents;
  }
}

export type PixelConnectivity = 4 | 8;

const FOUR_NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

const EIGHT_NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  ...FOUR_NEIGHBOURS,
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

export function labelConnectedComponents(
  image: BinaryImage,
  connectivity: PixelConnectivity = 8,
  options: LabelConnectedComponentsOptions = {},
): ConnectedComponentsResult {
  assertBinaryImage(image);
  const maxComponents = options.maxComponents ?? Number.POSITIVE_INFINITY;
  if (
    maxComponents !== Number.POSITIVE_INFINITY
    && (
      !Number.isSafeInteger(maxComponents)
      || maxComponents < 0
    )
  ) {
    throw new RangeError(
      'Maximum connected-component count must be a non-negative safe integer.',
    );
  }
  const labels = new Int32Array(image.data.length);
  const components: ConnectedComponent[] = [];
  const queue: number[] = [];
  const neighbours = connectivity === 4 ? FOUR_NEIGHBOURS : EIGHT_NEIGHBOURS;
  let nextId = 1;

  for (let start = 0; start < image.data.length; start += 1) {
    if (image.data[start] === 0 || labels[start] !== 0) continue;
    const attemptedComponents = components.length + 1;
    if (attemptedComponents > maxComponents) {
      throw new ConnectedComponentLimitError(
        maxComponents,
        attemptedComponents,
      );
    }
    queue.length = 0;
    queue.push(start);
    labels[start] = nextId;
    let cursor = 0;
    let minX = image.width;
    let minY = image.height;
    let maxX = 0;
    let maxY = 0;

    while (cursor < queue.length) {
      const index = queue[cursor];
      cursor += 1;
      const x = index % image.width;
      const y = Math.floor(index / image.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + 1);
      maxY = Math.max(maxY, y + 1);

      for (const [dx, dy] of neighbours) {
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
        if (
          image.data[neighbourIndex] !== 0
          && labels[neighbourIndex] === 0
        ) {
          labels[neighbourIndex] = nextId;
          queue.push(neighbourIndex);
        }
      }
    }

    components.push({
      id: nextId,
      area: queue.length,
      bounds: {
        minX,
        minY,
        maxX,
        maxY,
        width: maxX - minX,
        height: maxY - minY,
      },
    });
    nextId += 1;
  }

  return { width: image.width, height: image.height, labels, components };
}

interface BoundaryEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 0=east, 1=south, 2=west, 3=north. */
  direction: number;
}

interface BoundaryEdgeBudget {
  count: number;
  maximum: number;
}

type VertexKey = number | string;

function createVertexKey(
  width: number,
  height: number,
): (x: number, y: number) => VertexKey {
  const stride = width + 1;
  const maximumKey = height * stride + width;
  // Pixel-boundary vertices span 0..width and 0..height. Use a compact numeric
  // key whenever the full range is exact, with the previous string key as a
  // correctness fallback for dimensions beyond Number's safe integer range.
  return Number.isSafeInteger(maximumKey)
    ? (x, y) => y * stride + x
    : (x, y) => `${x},${y}`;
}

function signedPolygonArea(points: readonly TracedPoint[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return twiceArea / 2;
}

function directionPreference(
  incomingDirection: number,
  candidateDirection: number,
): number {
  const turn = (candidateDirection - incomingDirection + 4) % 4;
  // Keeping foreground on the right splits a diagonal vertex into separate
  // cycles instead of spuriously joining their outlines.
  switch (turn) {
    case 1:
      return 0; // right
    case 0:
      return 1; // straight
    case 3:
      return 2; // left
    default:
      return 3; // reverse
  }
}

function traceBoundaryCycles(
  edges: readonly BoundaryEdge[],
  vertexKey: (x: number, y: number) => VertexKey,
): TracedPoint[][] {
  const outgoing = new Map<VertexKey, number[]>();
  edges.forEach((edge, index) => {
    const key = vertexKey(edge.x1, edge.y1);
    const entries = outgoing.get(key);
    if (entries) entries.push(index);
    else outgoing.set(key, [index]);
  });
  const used = new Uint8Array(edges.length);
  const cycles: TracedPoint[][] = [];

  for (let startIndex = 0; startIndex < edges.length; startIndex += 1) {
    if (used[startIndex] !== 0) continue;
    const start = edges[startIndex];
    const points: TracedPoint[] = [{ x: start.x1, y: start.y1 }];
    let currentIndex = startIndex;
    let closed = false;

    for (let step = 0; step <= edges.length; step += 1) {
      if (used[currentIndex] !== 0) break;
      used[currentIndex] = 1;
      const current = edges[currentIndex];
      if (current.x2 === start.x1 && current.y2 === start.y1) {
        closed = true;
        break;
      }
      points.push({ x: current.x2, y: current.y2 });
      const candidates = (outgoing.get(vertexKey(current.x2, current.y2)) ?? [])
        .filter((candidate) => used[candidate] === 0)
        .sort((left, right) => (
          directionPreference(current.direction, edges[left].direction)
          - directionPreference(current.direction, edges[right].direction)
        ));
      if (candidates.length === 0) break;
      currentIndex = candidates[0];
    }

    if (closed && points.length >= 3) cycles.push(points);
  }
  return cycles;
}

function addBoundaryEdges(
  edgesByComponent: Map<number, BoundaryEdge[]>,
  componentId: number,
  x: number,
  y: number,
  labels: Int32Array,
  width: number,
  height: number,
  budget: BoundaryEdgeBudget,
): void {
  let edges = edgesByComponent.get(componentId);
  if (!edges) {
    edges = [];
    edgesByComponent.set(componentId, edges);
  }
  const labelAt = (candidateX: number, candidateY: number): number => {
    if (
      candidateX < 0
      || candidateX >= width
      || candidateY < 0
      || candidateY >= height
    ) {
      return 0;
    }
    return labels[candidateY * width + candidateX];
  };
  const push = (edge: BoundaryEdge): void => {
    const attempted = budget.count + 1;
    if (attempted > budget.maximum) {
      throw new ContourBoundaryEdgeLimitError(budget.maximum, attempted);
    }
    edges.push(edge);
    budget.count = attempted;
  };

  if (labelAt(x, y - 1) !== componentId) {
    push({ x1: x, y1: y, x2: x + 1, y2: y, direction: 0 });
  }
  if (labelAt(x + 1, y) !== componentId) {
    push({
      x1: x + 1,
      y1: y,
      x2: x + 1,
      y2: y + 1,
      direction: 1,
    });
  }
  if (labelAt(x, y + 1) !== componentId) {
    push({
      x1: x + 1,
      y1: y + 1,
      x2: x,
      y2: y + 1,
      direction: 2,
    });
  }
  if (labelAt(x - 1, y) !== componentId) {
    push({ x1: x, y1: y + 1, x2: x, y2: y, direction: 3 });
  }
}

function isConnectedComponentsResult(
  value: ConnectedComponentsResult | ExtractContoursOptions,
): value is ConnectedComponentsResult {
  return 'labels' in value;
}

function boundaryEdgeLimit(options: ExtractContoursOptions): number {
  if (options.maxBoundaryEdges === undefined) return Number.POSITIVE_INFINITY;
  if (
    !Number.isSafeInteger(options.maxBoundaryEdges)
    || options.maxBoundaryEdges < 0
  ) {
    throw new RangeError('Maximum boundary edge count must be a non-negative safe integer.');
  }
  return options.maxBoundaryEdges;
}

/**
 * Extracts pixel-edge polygons. Outer contours have positive signed area in
 * image coordinates; hole contours are detected by their opposite winding.
 */
export function extractContours(
  image: BinaryImage,
  options?: ExtractContoursOptions,
): Contour[];
export function extractContours(
  image: BinaryImage,
  labeling: ConnectedComponentsResult,
  options?: ExtractContoursOptions,
): Contour[];
export function extractContours(
  image: BinaryImage,
  labelingOrOptions: ConnectedComponentsResult | ExtractContoursOptions = {},
  suppliedOptions: ExtractContoursOptions = {},
): Contour[] {
  assertBinaryImage(image);
  const hasSuppliedLabeling = isConnectedComponentsResult(labelingOrOptions);
  const options = hasSuppliedLabeling
    ? suppliedOptions
    : labelingOrOptions;
  const maximumBoundaryEdges = boundaryEdgeLimit(options);
  const labeling = hasSuppliedLabeling
    ? labelingOrOptions
    : labelConnectedComponents(image);
  if (
    labeling.width !== image.width
    || labeling.height !== image.height
    || labeling.labels.length !== image.data.length
  ) {
    throw new RangeError('Connected-component labels do not match the image.');
  }

  const edgesByComponent = new Map<number, BoundaryEdge[]>();
  const budget: BoundaryEdgeBudget = {
    count: 0,
    maximum: maximumBoundaryEdges,
  };
  for (let index = 0; index < labeling.labels.length; index += 1) {
    const componentId = labeling.labels[index];
    if (componentId === 0) continue;
    const x = index % image.width;
    const y = Math.floor(index / image.width);
    addBoundaryEdges(
      edgesByComponent,
      componentId,
      x,
      y,
      labeling.labels,
      image.width,
      image.height,
      budget,
    );
  }

  const contours: Contour[] = [];
  const vertexKey = createVertexKey(image.width, image.height);
  for (const component of labeling.components) {
    const cycles = traceBoundaryCycles(
      edgesByComponent.get(component.id) ?? [],
      vertexKey,
    );
    for (const points of cycles) {
      const signedArea = signedPolygonArea(points);
      if (signedArea === 0) continue;
      contours.push({
        componentId: component.id,
        points,
        closed: true,
        isHole: signedArea < 0,
        area: Math.abs(signedArea),
      });
    }
  }
  return contours;
}

export function componentBinaryImage(
  image: BinaryImage,
  labeling: ConnectedComponentsResult,
  componentId: number,
): BinaryImage {
  assertBinaryImage(image);
  if (labeling.labels.length !== image.data.length) {
    throw new RangeError('Connected-component labels do not match the image.');
  }
  const data = new Uint8Array(image.data.length);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = labeling.labels[index] === componentId ? 1 : 0;
  }
  return { width: image.width, height: image.height, data };
}
