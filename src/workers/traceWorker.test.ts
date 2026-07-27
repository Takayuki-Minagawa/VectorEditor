import { describe, expect, it, vi } from 'vitest';
import {
  validateTracedDrawing,
  DEFAULT_TRACE_OPTIONS,
  MIN_TRACED_STROKE_WIDTH,
  type TraceOptions,
  type TracedShape,
} from '../domain/trace/tracedDrawing';
import type { ConnectedComponentsResult } from '../domain/trace/contour';
import type { TraceProgressStage } from './traceProtocol';
import {
  classifyTraceError,
  centerOutlinedPrimitiveGeometry,
  componentIdAtPoint,
  countDroppedCenterlineCandidates,
  estimateOutlinedStrokeWidth,
  executeTracePipeline,
  fitCircleToImage,
  fitEllipseToImage,
  fitRectToImage,
  groupContourCandidates,
  TracePipelineError,
  type SimplifiedTraceContour,
} from './traceWorker';

function raster(
  width: number,
  height: number,
  isForeground: (x: number, y: number) => boolean,
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const luminance = isForeground(x, y) ? 0 : 255;
      data[offset] = luminance;
      data[offset + 1] = luminance;
      data[offset + 2] = luminance;
      data[offset + 3] = 255;
    }
  }
  return { width, height, data, colorSpace: 'srgb' } as ImageData;
}

function options(overrides: Partial<TraceOptions> = {}): TraceOptions {
  return {
    ...DEFAULT_TRACE_OPTIONS,
    threshold: 128,
    medianRadius: 0,
    minComponentArea: 1,
    simplifyTolerance: 0.25,
    ...overrides,
  };
}

const noDelay = async (): Promise<void> => undefined;

function renderedPrimitiveBounds(
  shape: Extract<TracedShape, { kind: 'rect' | 'circle' | 'ellipse' }>,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const halfStroke = (shape.strokeWidth ?? 2) / 2;
  if (shape.kind === 'circle') {
    const outerRadius = shape.r + halfStroke;
    return {
      minX: shape.cx - outerRadius,
      minY: shape.cy - outerRadius,
      maxX: shape.cx + outerRadius,
      maxY: shape.cy + outerRadius,
    };
  }
  if (shape.kind === 'ellipse') {
    const radians = shape.angle * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const extentX = Math.hypot(shape.rx * cos, shape.ry * sin) + halfStroke;
    const extentY = Math.hypot(shape.rx * sin, shape.ry * cos) + halfStroke;
    return {
      minX: shape.cx - extentX,
      minY: shape.cy - extentY,
      maxX: shape.cx + extentX,
      maxY: shape.cy + extentY,
    };
  }

  const radians = shape.angle * Math.PI / 180;
  const ux = Math.cos(radians);
  const uy = Math.sin(radians);
  const vx = -uy;
  const vy = ux;
  const x = shape.x - halfStroke * (ux + vx);
  const y = shape.y - halfStroke * (uy + vy);
  const width = shape.width + halfStroke * 2;
  const height = shape.height + halfStroke * 2;
  const corners = [
    { x, y },
    { x: x + ux * width, y: y + uy * width },
    { x: x + vx * height, y: y + vy * height },
    {
      x: x + ux * width + vx * height,
      y: y + uy * width + vy * height,
    },
  ];
  return {
    minX: Math.min(...corners.map((point) => point.x)),
    minY: Math.min(...corners.map((point) => point.y)),
    maxX: Math.max(...corners.map((point) => point.x)),
    maxY: Math.max(...corners.map((point) => point.y)),
  };
}

describe('executeTracePipeline', () => {
  it('maps pixel-centre coordinates to their floored component-label cell', () => {
    const labeling: ConnectedComponentsResult = {
      width: 3,
      height: 1,
      labels: new Int32Array([4, 9, 12]),
      components: [],
    };

    expect(componentIdAtPoint({ x: 0.5, y: 0.5 }, labeling, 3, 1)).toBe(4);
    expect(componentIdAtPoint({ x: 2.5, y: 0.5 }, labeling, 3, 1)).toBe(12);
    expect(componentIdAtPoint({ x: Number.NaN, y: 0.5 }, labeling, 3, 1)).toBe(0);
  });

  it('counts an unrepresented centerline component once', () => {
    expect(countDroppedCenterlineCandidates(
      new Set([1, 2]),
      new Set([1]),
      new Map([
        [1, 2],
        [2, 4],
      ]),
    )).toBe(3);
  });

  it('groups multiple outers and holes without changing parent priority or order', () => {
    const largeOuter = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const nestedOuter = [
      { x: 1, y: 1 },
      { x: 9, y: 1 },
      { x: 9, y: 9 },
      { x: 1, y: 9 },
    ];
    const remoteOuter = [
      { x: 20, y: 20 },
      { x: 25, y: 20 },
      { x: 25, y: 25 },
      { x: 20, y: 25 },
    ];
    const outerOnlyHole = [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ];
    const nestedHole = [
      { x: 2, y: 2 },
      { x: 4, y: 2 },
      { x: 4, y: 4 },
      { x: 2, y: 4 },
    ];
    const remoteHole = [
      { x: 21, y: 21 },
      { x: 22, y: 21 },
      { x: 22, y: 22 },
      { x: 21, y: 22 },
    ];
    const fallbackHole = [
      { x: 40, y: 40 },
      { x: 42, y: 40 },
      { x: 42, y: 42 },
      { x: 40, y: 42 },
    ];
    const orphanHole = [
      { x: 5, y: 15 },
      { x: 6, y: 15 },
      { x: 6, y: 16 },
      { x: 5, y: 16 },
    ];
    const contours: SimplifiedTraceContour[] = [
      { componentId: 1, points: largeOuter, isHole: false, area: 100 },
      { componentId: 1, points: nestedOuter, isHole: false, area: 64 },
      { componentId: 1, points: remoteOuter, isHole: false, area: 25 },
      { componentId: 1, points: outerOnlyHole, isHole: true, area: 0.64 },
      { componentId: 1, points: nestedHole, isHole: true, area: 4 },
      { componentId: 1, points: remoteHole, isHole: true, area: 1 },
      { componentId: 1, points: fallbackHole, isHole: true, area: 4 },
      { componentId: 2, points: orphanHole, isHole: true, area: 1 },
    ];

    const grouped = groupContourCandidates(contours);

    expect(grouped.candidates.map((candidate) => candidate.points)).toEqual([
      largeOuter,
      nestedOuter,
      remoteOuter,
    ]);
    expect(grouped.candidates[0].holes).toEqual([outerOnlyHole]);
    expect(grouped.candidates[0].holeAreas).toEqual([0.64]);
    expect(grouped.candidates[1].holes).toEqual([nestedHole]);
    expect(grouped.candidates[1].holeAreas).toEqual([4]);
    expect(grouped.candidates[2].holes).toEqual([remoteHole, fallbackHole]);
    expect(grouped.candidates[2].holeAreas).toEqual([1, 4]);
    expect(grouped.orphanHoleCount).toBe(1);
  });

  it('estimates outlined primitive width from ink area and both boundaries', () => {
    const outlinedRectangle = {
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 18 },
        { x: 0, y: 18 },
      ],
      holes: [[
        { x: 4, y: 4 },
        { x: 16, y: 4 },
        { x: 16, y: 14 },
        { x: 4, y: 14 },
      ]],
      holeAreas: [120],
      closed: true as const,
      source: 'contour' as const,
      componentId: 1,
      area: 360,
    };
    // 2 * (360 - 120) / (76 + 44) = 4.
    expect(estimateOutlinedStrokeWidth(outlinedRectangle)).toBeCloseTo(4, 10);
    expect(estimateOutlinedStrokeWidth({
      ...outlinedRectangle,
      holes: [],
      holeAreas: [],
    })).toBe(2);
    expect(estimateOutlinedStrokeWidth({
      ...outlinedRectangle,
      area: 100,
      holeAreas: [120],
    })).toBe(2);
  });

  it('moves solid primitive geometry onto the stroke centreline', () => {
    expect(centerOutlinedPrimitiveGeometry({
      kind: 'rect',
      x: 0,
      y: 0,
      width: 20,
      height: 10,
      angle: 0,
      strokeWidth: 2,
    }, 2)).toEqual({
      kind: 'rect',
      x: 1,
      y: 1,
      width: 18,
      height: 8,
      angle: 0,
      strokeWidth: 2,
    });
    expect(centerOutlinedPrimitiveGeometry({
      kind: 'circle',
      cx: 10,
      cy: 10,
      r: 10,
      strokeWidth: 2,
    }, 2)).toEqual({
      kind: 'circle',
      cx: 10,
      cy: 10,
      r: 9,
      strokeWidth: 2,
    });
    expect(centerOutlinedPrimitiveGeometry({
      kind: 'ellipse',
      cx: 10,
      cy: 8,
      rx: 10,
      ry: 5,
      angle: 20,
      strokeWidth: 2,
    }, 2)).toEqual({
      kind: 'ellipse',
      cx: 10,
      cy: 8,
      rx: 9,
      ry: 4,
      angle: 20,
      strokeWidth: 2,
    });
    expect(centerOutlinedPrimitiveGeometry({
      kind: 'circle',
      cx: 1,
      cy: 1,
      r: 1,
      strokeWidth: 2,
    }, 2)).toBeNull();
  });

  it('keeps fitted primitives when proportional scaling reaches the minimum stroke', () => {
    const rectAngle = 45;
    const rectRadians = rectAngle * Math.PI / 180;
    const rectWidth = 9;
    const rectHeight = 5;
    const rect = fitRectToImage({
      kind: 'rect',
      x: 5
        - Math.cos(rectRadians) * rectWidth / 2
        + Math.sin(rectRadians) * rectHeight / 2,
      y: 5
        - Math.sin(rectRadians) * rectWidth / 2
        - Math.cos(rectRadians) * rectHeight / 2,
      width: rectWidth,
      height: rectHeight,
      angle: rectAngle,
      strokeWidth: MIN_TRACED_STROKE_WIDTH,
    }, 10, 10);
    const circle = fitCircleToImage({
      kind: 'circle',
      cx: 5,
      cy: 5,
      r: 5,
      strokeWidth: MIN_TRACED_STROKE_WIDTH,
    }, 10, 10);
    const ellipse = fitEllipseToImage({
      kind: 'ellipse',
      cx: 5,
      cy: 5,
      rx: 6,
      ry: 3,
      angle: 30,
      strokeWidth: MIN_TRACED_STROKE_WIDTH,
    }, 10, 10);

    expect(rect).not.toBeNull();
    expect(circle).not.toBeNull();
    expect(ellipse).not.toBeNull();
    for (const shape of [rect, circle, ellipse]) {
      expect(shape?.strokeWidth).toBe(MIN_TRACED_STROKE_WIDTH);
      if (!shape) continue;
      const bounds = renderedPrimitiveBounds(shape);
      expect(bounds.minX).toBeGreaterThanOrEqual(-1e-8);
      expect(bounds.minY).toBeGreaterThanOrEqual(-1e-8);
      expect(bounds.maxX).toBeLessThanOrEqual(10 + 1e-8);
      expect(bounds.maxY).toBeLessThanOrEqual(10 + 1e-8);
    }
    expect(rect && rect.width / rect.height).toBeCloseTo(
      rectWidth / rectHeight,
      10,
    );
    expect(ellipse && ellipse.rx / ellipse.ry).toBeCloseTo(2, 10);
  });

  it('traces a synthetic filled component and reports every pipeline stage', async () => {
    const stages: TraceProgressStage[] = [];
    const drawing = await executeTracePipeline(
      raster(10, 10, (x, y) => x >= 2 && x <= 6 && y >= 2 && y <= 6),
      options(),
      {
        yieldControl: noDelay,
        onProgress: (stage) => stages.push(stage),
      },
    );

    expect(drawing).toMatchObject({
      version: 1,
      sourceWidth: 10,
      sourceHeight: 10,
      stats: {
        componentCount: 1,
        droppedCount: 0,
      },
    });
    expect(drawing.shapes).toHaveLength(1);
    expect(drawing.shapes[0].kind).toBe('polygon');
    expect(drawing.stats.vertexCount).toBeGreaterThanOrEqual(3);
    expect(stages).toEqual([
      'preprocess',
      'components',
      'contours',
      'centerlines',
      'simplify',
      'classify',
      'align',
      'complete',
    ]);
  });

  it('uses centerlines for elongated components and keeps their stroke width', async () => {
    const drawing = await executeTracePipeline(
      raster(20, 8, (x, y) => x >= 2 && x <= 17 && y >= 3 && y <= 4),
      options(),
      { yieldControl: noDelay },
    );

    expect(drawing.shapes.length).toBeGreaterThan(0);
    expect(drawing.shapes.every((shape) => shape.kind === 'polyline')).toBe(true);
    expect(drawing.shapes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'polyline',
        strokeWidth: expect.any(Number),
      }),
    ]));
  });

  it('automatically centerlines an elongated diagonal component', async () => {
    const drawing = await executeTracePipeline(
      raster(32, 32, (x, y) => (
        x >= 3 && x <= 28 && Math.abs(y - x) <= 1
      )),
      options(),
      { yieldControl: noDelay },
    );

    expect(drawing.shapes.length).toBeGreaterThan(0);
    expect(drawing.shapes.every((shape) => shape.kind === 'polyline')).toBe(true);
  });

  it('classifies and aligns simple shapes in cleanup mode', async () => {
    const drawing = await executeTracePipeline(
      raster(12, 12, (x, y) => x >= 2 && x <= 8 && y >= 3 && y <= 8),
      options({ mode: 'cleanup' }),
      { yieldControl: noDelay },
    );

    expect(drawing.shapes).toEqual([
      expect.objectContaining({ kind: 'rect', strokeWidth: 2 }),
    ]);
  });

  it.each([
    {
      name: 'O-shaped annulus',
      width: 24,
      height: 24,
      foreground: (x: number, y: number) => {
        const distance = Math.hypot(x - 11.5, y - 11.5);
        return distance <= 9 && distance >= 4;
      },
    },
    {
      name: 'A-shaped glyph',
      width: 23,
      height: 23,
      foreground: (x: number, y: number) => {
        if (y < 2 || y > 20) return false;
        const halfOuter = (y - 2) / 2;
        const outer = x >= Math.ceil(11 - halfOuter)
          && x <= Math.floor(11 + halfOuter);
        const halfHole = (y - 7) / 4;
        const hole = y >= 7
          && y <= 14
          && x >= Math.ceil(11 - halfHole)
          && x <= Math.floor(11 + halfHole);
        return outer && !hole;
      },
    },
    {
      name: 'rectangular doughnut',
      width: 24,
      height: 24,
      foreground: (x: number, y: number) => (
        x >= 2 && x <= 21 && y >= 2 && y <= 21
        && !(x >= 7 && x <= 16 && y >= 7 && y <= 16)
      ),
    },
  ])('preserves the hole in a $name in faithful mode', async ({
    width,
    height,
    foreground,
  }) => {
    const drawing = await executeTracePipeline(
      raster(width, height, foreground),
      options({ mode: 'faithful', coordinateSnap: 0 }),
      { yieldControl: noDelay },
    );
    expect(drawing.shapes).toHaveLength(1);
    const polygon = drawing.shapes[0];
    expect(polygon.kind).toBe('polygon');
    if (polygon.kind === 'polygon') {
      expect(polygon.holes).toHaveLength(1);
      expect(polygon.holes?.[0].length).toBeGreaterThanOrEqual(3);
      const representedVertices = polygon.points.length
        + (polygon.holes?.[0].length ?? 0);
      expect(drawing.stats.vertexCount).toBe(representedVertices);
    }
  });

  it('keeps an A-shaped hole when cleanup classification falls back to polygon', async () => {
    const drawing = await executeTracePipeline(
      raster(23, 23, (x, y) => {
        if (y < 2 || y > 20) return false;
        const halfOuter = (y - 2) / 2;
        const outer = x >= Math.ceil(11 - halfOuter)
          && x <= Math.floor(11 + halfOuter);
        const halfHole = (y - 7) / 4;
        const hole = y >= 7
          && y <= 14
          && x >= Math.ceil(11 - halfHole)
          && x <= Math.floor(11 + halfHole);
        return outer && !hole;
      }),
      options({ mode: 'cleanup', coordinateSnap: 0 }),
      { yieldControl: noDelay },
    );

    expect(drawing.shapes).toEqual([
      expect.objectContaining({
        kind: 'polygon',
        holes: [expect.any(Array)],
      }),
    ]);
  });

  it('classifies matching outlined rasters as cleanup primitives', async () => {
    const rectangle = await executeTracePipeline(
      raster(24, 24, (x, y) => (
        x >= 2 && x <= 21 && y >= 3 && y <= 20
        && !(x >= 6 && x <= 17 && y >= 7 && y <= 16)
      )),
      options({ mode: 'cleanup', simplifyTolerance: 1.25, coordinateSnap: 0 }),
      { yieldControl: noDelay },
    );
    const circle = await executeTracePipeline(
      raster(24, 24, (x, y) => {
        const distance = Math.hypot(x - 11.5, y - 11.5);
        return distance <= 9 && distance >= 5;
      }),
      options({ mode: 'cleanup', simplifyTolerance: 1.25, coordinateSnap: 0 }),
      { yieldControl: noDelay },
    );
    const ellipse = await executeTracePipeline(
      raster(50, 40, (x, y) => {
        const dx = x - 24.5;
        const dy = y - 19.5;
        const outer = (dx / 20) ** 2 + (dy / 14) ** 2 <= 1;
        const hole = (dx / 15) ** 2 + (dy / 9) ** 2 < 1;
        return outer && !hole;
      }),
      options({ mode: 'cleanup', simplifyTolerance: 1.25, coordinateSnap: 0 }),
      { yieldControl: noDelay },
    );

    expect(rectangle.shapes).toEqual([
      expect.objectContaining({
        kind: 'rect',
        strokeWidth: expect.any(Number),
      }),
    ]);
    expect(circle.shapes).toEqual([
      expect.objectContaining({
        kind: 'circle',
        strokeWidth: expect.any(Number),
      }),
    ]);
    expect(ellipse.shapes).toEqual([
      expect.objectContaining({
        kind: 'ellipse',
        strokeWidth: expect.any(Number),
      }),
    ]);
    const rectangleShape = rectangle.shapes[0];
    if (rectangleShape.kind === 'rect') {
      expect(rectangleShape.strokeWidth).toBeCloseTo(4, 8);
      const halfStroke = (rectangleShape.strokeWidth ?? 0) / 2;
      // The primitive describes the stroke centreline. Expanding and
      // contracting by half the width recovers the source outer/inner rings.
      expect(rectangleShape.x - halfStroke).toBeCloseTo(2, 8);
      expect(rectangleShape.y - halfStroke).toBeCloseTo(3, 8);
      expect(
        rectangleShape.x + rectangleShape.width + halfStroke,
      ).toBeCloseTo(22, 8);
      expect(
        rectangleShape.y + rectangleShape.height + halfStroke,
      ).toBeCloseTo(21, 8);
      expect(rectangleShape.x + halfStroke).toBeCloseTo(6, 8);
      expect(rectangleShape.y + halfStroke).toBeCloseTo(7, 8);
      expect(
        rectangleShape.x + rectangleShape.width - halfStroke,
      ).toBeCloseTo(18, 8);
      expect(
        rectangleShape.y + rectangleShape.height - halfStroke,
      ).toBeCloseTo(17, 8);
    }
    const circleShape = circle.shapes[0];
    if (circleShape.kind === 'circle') {
      expect(circleShape.strokeWidth).toBeGreaterThan(3);
      expect(circleShape.strokeWidth).toBeLessThan(5);
      const halfStroke = (circleShape.strokeWidth ?? 0) / 2;
      expect(circleShape.r + halfStroke).toBeGreaterThan(8.5);
      expect(circleShape.r + halfStroke).toBeLessThan(9.5);
      expect(circleShape.r - halfStroke).toBeGreaterThan(4.5);
      expect(circleShape.r - halfStroke).toBeLessThan(5.5);
    }
    const ellipseShape = ellipse.shapes[0];
    if (ellipseShape.kind === 'ellipse') {
      expect(ellipseShape.strokeWidth).toBeGreaterThan(4);
      expect(ellipseShape.strokeWidth).toBeLessThan(6);
      const halfStroke = (ellipseShape.strokeWidth ?? 0) / 2;
      expect(ellipseShape.rx + halfStroke).toBeGreaterThan(19);
      expect(ellipseShape.rx + halfStroke).toBeLessThan(21);
      expect(ellipseShape.ry + halfStroke).toBeGreaterThan(13);
      expect(ellipseShape.ry + halfStroke).toBeLessThan(15);
    }
  });

  it.each([
    {
      name: 'multiple holes',
      foreground: (x: number, y: number) => (
        x >= 2 && x <= 27 && y >= 2 && y <= 21
        && !(x >= 5 && x <= 9 && y >= 7 && y <= 16)
        && !(x >= 19 && x <= 23 && y >= 7 && y <= 16)
      ),
      holeCount: 2,
    },
    {
      name: 'one clearly eccentric hole',
      foreground: (x: number, y: number) => (
        x >= 2 && x <= 27 && y >= 2 && y <= 21
        && !(x >= 5 && x <= 10 && y >= 7 && y <= 16)
      ),
      holeCount: 1,
    },
    {
      name: 'a non-rectangular central hole',
      foreground: (x: number, y: number) => {
        const outer = x >= 2 && x <= 27 && y >= 2 && y <= 21;
        const hole = Math.hypot(x - 14.5, y - 11.5) <= 4.5;
        return outer && !hole;
      },
      holeCount: 1,
    },
  ])('keeps $name as a compound polygon in cleanup mode', async ({
    foreground,
    holeCount,
  }) => {
    const drawing = await executeTracePipeline(
      raster(30, 24, foreground),
      options({ mode: 'cleanup', simplifyTolerance: 1.25, coordinateSnap: 0 }),
      { yieldControl: noDelay },
    );

    expect(drawing.shapes).toEqual([
      expect.objectContaining({
        kind: 'polygon',
        holes: expect.any(Array),
      }),
    ]);
    const [shape] = drawing.shapes;
    if (shape.kind === 'polygon') expect(shape.holes).toHaveLength(holeCount);
    expect(drawing.stats.droppedCount).toBe(0);
  });

  it.each([
    {
      name: 'rectangle',
      width: 20,
      height: 20,
      foreground: () => true,
      expectedKind: 'rect',
    },
    {
      name: 'circle',
      width: 24,
      height: 24,
      foreground: (x: number, y: number) => (
        Math.hypot(x - 11.5, y - 11.5) <= 11
      ),
      expectedKind: 'circle',
      simplifyTolerance: 1.25,
    },
    {
      name: 'ellipse',
      width: 31,
      height: 21,
      foreground: (x: number, y: number) => (
        ((x - 15) / 15) ** 2 + ((y - 10) / 10) ** 2 <= 1
      ),
      expectedKind: 'ellipse',
      simplifyTolerance: 0.25,
    },
  ])('keeps the rendered stroke of an edge-touching solid $name inside the source', async ({
    width,
    height,
    foreground,
    expectedKind,
    simplifyTolerance = 0.25,
  }) => {
    const drawing = await executeTracePipeline(
      raster(width, height, foreground),
      options({
        mode: 'cleanup',
        simplifyTolerance,
        angleSnapDeg: 0,
        coordinateSnap: 0,
      }),
      { yieldControl: noDelay },
    );

    expect(drawing.shapes).toEqual([
      expect.objectContaining({
        kind: expectedKind,
        strokeWidth: expect.any(Number),
      }),
    ]);
    const [shape] = drawing.shapes;
    if (
      shape.kind === 'rect'
      || shape.kind === 'circle'
      || shape.kind === 'ellipse'
    ) {
      const bounds = renderedPrimitiveBounds(shape);
      expect(bounds.minX).toBeGreaterThanOrEqual(-1e-8);
      expect(bounds.minY).toBeGreaterThanOrEqual(-1e-8);
      expect(bounds.maxX).toBeLessThanOrEqual(width + 1e-8);
      expect(bounds.maxY).toBeLessThanOrEqual(height + 1e-8);
    }
  });

  it('falls back to a polygon when a solid primitive is too small to inset', async () => {
    const drawing = await executeTracePipeline(
      raster(2, 2, () => true),
      options({
        mode: 'cleanup',
        simplifyTolerance: 0,
        angleSnapDeg: 0,
        coordinateSnap: 0,
      }),
      { yieldControl: noDelay },
    );

    expect(drawing.shapes).toEqual([
      expect.objectContaining({ kind: 'polygon' }),
    ]);
    expect(drawing.stats.droppedCount).toBe(0);
  });

  it('scales an outlined primitive stroke width back to source coordinates', async () => {
    const drawing = await executeTracePipeline(
      raster(40, 40, (x, y) => (
        x >= 4 && x <= 35 && y >= 4 && y <= 35
        && !(x >= 12 && x <= 27 && y >= 12 && y <= 27)
      )),
      options({
        mode: 'cleanup',
        maxDimension: 20,
        simplifyTolerance: 0.5,
        coordinateSnap: 0,
      }),
      { yieldControl: noDelay },
    );

    expect(drawing.shapes).toEqual([
      expect.objectContaining({
        kind: 'rect',
        strokeWidth: expect.any(Number),
      }),
    ]);
    const shape = drawing.shapes[0];
    if (shape.kind === 'rect') {
      expect(shape.strokeWidth).toBeCloseTo(8, 8);
      const halfStroke = (shape.strokeWidth ?? 0) / 2;
      expect(shape.x - halfStroke).toBeCloseTo(4, 8);
      expect(shape.y - halfStroke).toBeCloseTo(4, 8);
      expect(shape.x + shape.width + halfStroke).toBeCloseTo(36, 8);
      expect(shape.y + shape.height + halfStroke).toBeCloseTo(36, 8);
      expect(shape.x + halfStroke).toBeCloseTo(12, 8);
      expect(shape.y + halfStroke).toBeCloseTo(12, 8);
      expect(shape.x + shape.width - halfStroke).toBeCloseTo(28, 8);
      expect(shape.y + shape.height - halfStroke).toBeCloseTo(28, 8);
    }
  });

  it('closes a loop-shaped centerline by repeating its first point', async () => {
    const drawing = await executeTracePipeline(
      raster(14, 14, (x, y) => (
        x >= 2 && x <= 11 && y >= 2 && y <= 11
        && (x === 2 || x === 11 || y === 2 || y === 11)
      )),
      options({ forceCenterline: true, simplifyTolerance: 0 }),
      { yieldControl: noDelay },
    );

    const closed = drawing.shapes.find((shape) => (
      shape.kind === 'polyline'
      && shape.points.length >= 3
      && shape.points[0].x === shape.points[shape.points.length - 1].x
      && shape.points[0].y === shape.points[shape.points.length - 1].y
    ));
    expect(closed).toBeDefined();
  });

  it('preserves a short line-like component under coordinate snapping', async () => {
    const drawing = await executeTracePipeline(
      raster(30, 20, (x, y) => (
        (y === 2 && x >= 1 && x <= 6)
        || (x >= 15 && x <= 25 && y >= 5 && y <= 15)
      )),
      options({
        mode: 'cleanup',
        coordinateSnap: 5,
        simplifyTolerance: 0,
      }),
      { yieldControl: noDelay },
    );

    expect(drawing.shapes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'rect' }),
      expect.objectContaining({ kind: 'line' }),
    ]));
    expect(drawing.stats.componentCount).toBe(2);
    expect(drawing.stats.droppedCount).toBe(0);
  });

  it('keeps a one-pixel line with the default preprocessing options', async () => {
    const drawing = await executeTracePipeline(
      raster(24, 7, (x, y) => y === 3 && x >= 2 && x <= 21),
      { ...DEFAULT_TRACE_OPTIONS },
      { yieldControl: noDelay },
    );

    expect(drawing.shapes.length).toBeGreaterThan(0);
    expect(drawing.stats.componentCount).toBe(1);
    const centerlineShapes = drawing.shapes.filter(
      (shape) => shape.kind === 'line' || shape.kind === 'polyline',
    );
    expect(centerlineShapes).not.toHaveLength(0);
    expect(centerlineShapes.every(
      (shape) => shape.strokeWidth >= MIN_TRACED_STROKE_WIDTH,
    )).toBe(true);
  });

  it('fits a rotated edge-touching cleanup primitive inside its source image', async () => {
    const drawing = await executeTracePipeline(
      raster(21, 21, (x, y) => Math.abs(x - 10) + Math.abs(y - 10) <= 10),
      options({ mode: 'cleanup', coordinateSnap: 0 }),
      { yieldControl: noDelay },
    );

    expect(drawing.shapes).toEqual([
      expect.objectContaining({ kind: 'ellipse', angle: -45 }),
    ]);
    const [shape] = drawing.shapes;
    if (shape.kind === 'ellipse') {
      const bounds = renderedPrimitiveBounds(shape);
      expect(bounds.minX).toBeGreaterThanOrEqual(-1e-8);
      expect(bounds.minY).toBeGreaterThanOrEqual(-1e-8);
      expect(bounds.maxX).toBeLessThanOrEqual(21 + 1e-8);
      expect(bounds.maxY).toBeLessThanOrEqual(21 + 1e-8);
    }
    expect(validateTracedDrawing(drawing).valid).toBe(true);
  });

  it('preserves original source coordinates after preprocessing down-scaling', async () => {
    const drawing = await executeTracePipeline(
      raster(20, 10, (x, y) => x >= 4 && x <= 14 && y >= 2 && y <= 7),
      options({ maxDimension: 10 }),
      { yieldControl: noDelay },
    );

    expect(drawing.sourceWidth).toBe(20);
    expect(drawing.sourceHeight).toBe(10);
    const polygon = drawing.shapes.find((shape) => shape.kind === 'polygon');
    expect(polygon).toBeDefined();
    if (polygon?.kind === 'polygon') {
      expect(Math.max(...polygon.points.map((point) => point.x))).toBeGreaterThan(10);
      expect(polygon.points.every((point) => (
        point.x >= 0 && point.x <= 20 && point.y >= 0 && point.y <= 10
      ))).toBe(true);
    }
  });

  it('classifies empty input, vertex overflow, and cancellation', async () => {
    await expect(executeTracePipeline(
      raster(8, 8, () => false),
      options(),
      { yieldControl: noDelay },
    )).rejects.toMatchObject({ code: 'NO_SHAPES' });

    await expect(executeTracePipeline(
      raster(8, 8, (x, y) => x >= 2 && x <= 5 && y >= 2 && y <= 5),
      options({ vertexLimit: 3 }),
      { yieldControl: noDelay },
    )).rejects.toMatchObject({ code: 'VERTEX_LIMIT_EXCEEDED' });

    const onProgress = vi.fn();
    await expect(executeTracePipeline(
      raster(8, 8, () => true),
      options(),
      {
        yieldControl: noDelay,
        isCancelled: () => true,
        onProgress,
      },
    )).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('stops raw contour growth before simplification exceeds memory bounds', async () => {
    await expect(executeTracePipeline(
      raster(50, 50, (x, y) => (x + y) % 2 === 0),
      options({ vertexLimit: 1 }),
      { yieldControl: noDelay },
    )).rejects.toMatchObject({
      code: 'VERTEX_LIMIT_EXCEEDED',
      message: expect.stringContaining('boundary edge limit'),
    });
  });

  it('stops disconnected-component growth before contour allocation', async () => {
    await expect(executeTracePipeline(
      raster(25, 25, (x, y) => x % 2 === 0 && y % 2 === 0),
      options({ vertexLimit: 10 }),
      { yieldControl: noDelay },
    )).rejects.toMatchObject({
      code: 'VERTEX_LIMIT_EXCEEDED',
      message: expect.stringContaining('component limit'),
    });
  });
});

describe('classifyTraceError', () => {
  it('preserves explicit pipeline errors and classifies unexpected failures', () => {
    expect(classifyTraceError(new TracePipelineError(
      'NO_SHAPES',
      'No traceable shapes were detected.',
    ))).toEqual({
      code: 'NO_SHAPES',
      message: 'No traceable shapes were detected.',
    });
    expect(classifyTraceError(new RangeError(
      'Image dimensions must be positive integers.',
    ))).toEqual({
      code: 'INVALID_IMAGE',
      message: 'Image dimensions must be positive integers.',
    });
    expect(classifyTraceError(new Error('Unexpected algorithm failure.'))).toEqual({
      code: 'PROCESSING_FAILED',
      message: 'Unexpected algorithm failure.',
    });
  });
});
