import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRACE_OPTIONS,
  TracedDrawingValidationError,
  assertValidTracedDrawing,
  isTraceOptions,
  normalizeTraceOptions,
  validateTracedDrawing,
  type TracedDrawing,
} from './tracedDrawing';

const validDrawing: TracedDrawing = {
  version: 1,
  sourceWidth: 100,
  sourceHeight: 80,
  shapes: [
    {
      kind: 'polygon',
      points: [{ x: 1, y: 1 }, { x: 10, y: 1 }, { x: 5, y: 8 }],
      closed: true,
    },
    {
      kind: 'polyline',
      points: [{ x: 2, y: 2 }, { x: 9, y: 4 }],
      strokeWidth: 2,
    },
    { kind: 'line', x1: 0, y1: 0, x2: 20, y2: 20, strokeWidth: 1 },
    { kind: 'rect', x: 5, y: 5, width: 10, height: 4, angle: 0 },
    { kind: 'circle', cx: 30, cy: 30, r: 5 },
    { kind: 'ellipse', cx: 50, cy: 40, rx: 8, ry: 4, angle: 12 },
  ],
  stats: { componentCount: 6, vertexCount: 19, droppedCount: 0 },
};

describe('traced drawing domain', () => {
  it('accepts every trace shape without depending on DOM or Fabric types', () => {
    expect(validateTracedDrawing(validDrawing)).toEqual({ valid: true, issues: [] });
    expect(() => assertValidTracedDrawing(validDrawing)).not.toThrow();
  });

  it('accepts an empty, but structurally valid, trace result', () => {
    expect(validateTracedDrawing({
      ...validDrawing,
      shapes: [],
      stats: { componentCount: 0, vertexCount: 0, droppedCount: 0 },
    }).valid).toBe(true);
  });

  it('reports invalid coordinates, dimensions, and statistics', () => {
    const result = validateTracedDrawing({
      ...validDrawing,
      shapes: [
        {
          kind: 'polygon',
          points: [{ x: -1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: Number.NaN }],
          closed: true,
        },
        { kind: 'circle', cx: 5, cy: 5, r: 0 },
      ],
      stats: { componentCount: -1, vertexCount: 0.5, droppedCount: 0 },
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'coordinate-out-of-range',
      'non-finite-coordinate',
      'invalid-dimension',
      'invalid-stats',
    ]));
    expect(() => assertValidTracedDrawing({
      ...validDrawing,
      sourceWidth: 0,
    })).toThrow(TracedDrawingValidationError);
  });

  it('accepts legacy primitives and validates optional measured stroke widths', () => {
    const measured: TracedDrawing = {
      version: 1,
      sourceWidth: 100,
      sourceHeight: 100,
      shapes: [
        {
          kind: 'rect',
          x: 10,
          y: 10,
          width: 20,
          height: 10,
          angle: 0,
          strokeWidth: 0.5,
        },
        { kind: 'circle', cx: 50, cy: 30, r: 10, strokeWidth: 4 },
        {
          kind: 'ellipse',
          cx: 70,
          cy: 70,
          rx: 12,
          ry: 6,
          angle: 15,
          strokeWidth: 6,
        },
      ],
      stats: { componentCount: 3, vertexCount: 12, droppedCount: 0 },
    };
    expect(validateTracedDrawing(measured)).toEqual({ valid: true, issues: [] });
    // Existing version-1 payloads omit primitive strokeWidth and remain valid.
    expect(validateTracedDrawing(validDrawing)).toEqual({ valid: true, issues: [] });

    const invalid = validateTracedDrawing({
      ...measured,
      shapes: [
        { ...measured.shapes[0], strokeWidth: 0 },
        { ...measured.shapes[1], strokeWidth: Number.NaN },
        { ...measured.shapes[2], strokeWidth: Number.POSITIVE_INFINITY },
      ],
    });
    expect(invalid.issues.filter(
      (issue) => issue.code === 'invalid-stroke-width',
    )).toHaveLength(3);
  });

  it('enforces a configurable aggregate vertex limit', () => {
    const result = validateTracedDrawing(validDrawing, 5);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'vertex-limit-exceeded',
    }));
  });

  it('requires reported vertex statistics to match the measured safe count', () => {
    const mismatched = validateTracedDrawing({
      ...validDrawing,
      stats: {
        ...validDrawing.stats,
        vertexCount: validDrawing.stats.vertexCount - 1,
      },
    });
    expect(mismatched.issues).toContainEqual(expect.objectContaining({
      code: 'invalid-stats',
      message: expect.stringContaining('drawing contains 19'),
    }));

    const unsafe = validateTracedDrawing({
      ...validDrawing,
      stats: {
        ...validDrawing.stats,
        componentCount: Number.MAX_SAFE_INTEGER + 1,
      },
    });
    expect(unsafe.issues).toContainEqual(expect.objectContaining({
      code: 'invalid-stats',
      message: expect.stringContaining('safe integer'),
    }));
  });

  it('validates polygon holes and counts their vertices toward the limit', () => {
    const compound: TracedDrawing = {
      version: 1,
      sourceWidth: 20,
      sourceHeight: 20,
      shapes: [{
        kind: 'polygon',
        points: [
          { x: 1, y: 1 },
          { x: 19, y: 1 },
          { x: 19, y: 19 },
          { x: 1, y: 19 },
        ],
        holes: [[
          { x: 6, y: 6 },
          { x: 6, y: 14 },
          { x: 14, y: 14 },
          { x: 14, y: 6 },
        ]],
        closed: true,
      }],
      stats: { componentCount: 1, vertexCount: 8, droppedCount: 0 },
    };

    expect(validateTracedDrawing(compound)).toEqual({ valid: true, issues: [] });
    expect(validateTracedDrawing(compound, 7).issues).toContainEqual(
      expect.objectContaining({ code: 'vertex-limit-exceeded' }),
    );

    const malformed = validateTracedDrawing({
      ...compound,
      shapes: [{
        ...compound.shapes[0],
        holes: [[{ x: 1, y: 1 }, { x: 25, y: 1 }]],
      }],
    });
    expect(malformed.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['too-few-points', 'coordinate-out-of-range']),
    );
  });

  it('rejects primitive extents that leave the source image', () => {
    const result = validateTracedDrawing({
      ...validDrawing,
      shapes: [
        { kind: 'rect', x: 95, y: 5, width: 10, height: 4, angle: 0 },
        { kind: 'circle', cx: 3, cy: 3, r: 5 },
        { kind: 'ellipse', cx: 98, cy: 40, rx: 8, ry: 2, angle: 0 },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.filter(
      (issue) => issue.code === 'coordinate-out-of-range',
    ).length).toBeGreaterThanOrEqual(3);
  });

  it('normalizes settings and exposes a strict protocol type guard', () => {
    expect(isTraceOptions(DEFAULT_TRACE_OPTIONS)).toBe(true);
    const normalized = normalizeTraceOptions({
      mode: 'cleanup',
      maxDimension: 0,
      medianRadius: 99,
      sauvolaWindow: 10,
      angleSnapDeg: 90,
    });
    expect(normalized).toEqual(expect.objectContaining({
      mode: 'cleanup',
      maxDimension: 1,
      medianRadius: 8,
      sauvolaWindow: 11,
      angleSnapDeg: 22.5,
    }));
    expect(DEFAULT_TRACE_OPTIONS.medianRadius).toBe(0);
    expect(isTraceOptions({ ...DEFAULT_TRACE_OPTIONS, threshold: 300 })).toBe(false);
    expect(isTraceOptions({
      ...DEFAULT_TRACE_OPTIONS,
      vertexLimit: 250_001,
    })).toBe(false);
  });
});
