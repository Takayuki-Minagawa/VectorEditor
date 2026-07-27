import { describe, expect, it, vi } from 'vitest';
import {
  validateTracedDrawing,
  DEFAULT_TRACE_OPTIONS,
  type TraceOptions,
} from '../domain/trace/tracedDrawing';
import type { TraceProgressStage } from './traceProtocol';
import {
  classifyTraceError,
  executeTracePipeline,
  TracePipelineError,
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

describe('executeTracePipeline', () => {
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
      expect.objectContaining({ kind: 'rect' }),
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

  it('classifies outlined rectangle and circle rasters as cleanup primitives', async () => {
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

    expect(rectangle.shapes).toEqual([
      expect.objectContaining({ kind: 'rect' }),
    ]);
    expect(circle.shapes).toEqual([
      expect.objectContaining({ kind: 'circle' }),
    ]);
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

  it('keeps a one-pixel line with the default preprocessing options', async () => {
    const drawing = await executeTracePipeline(
      raster(24, 7, (x, y) => y === 3 && x >= 2 && x <= 21),
      { ...DEFAULT_TRACE_OPTIONS },
      { yieldControl: noDelay },
    );

    expect(drawing.shapes.length).toBeGreaterThan(0);
    expect(drawing.stats.componentCount).toBe(1);
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
