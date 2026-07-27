import { describe, expect, it } from 'vitest';
import type { TracedDrawing } from '../domain/trace/tracedDrawing';
import {
  DEFAULT_TRACE_OPTIONS,
  isTraceResponse,
  isTraceWorkerRequest,
} from './traceProtocol';

function imageData(width = 2, height = 2): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
    colorSpace: 'srgb',
  } as ImageData;
}

function drawing(): TracedDrawing {
  return {
    version: 1,
    sourceWidth: 2,
    sourceHeight: 2,
    shapes: [{
      kind: 'line',
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 1,
      strokeWidth: 1,
    }],
    stats: {
      componentCount: 1,
      vertexCount: 2,
      droppedCount: 0,
    },
  };
}

describe('trace worker protocol guards', () => {
  it('accepts trace and cancellation requests with a safe positive job ID', () => {
    expect(isTraceWorkerRequest({
      type: 'trace',
      jobId: 1,
      imageData: imageData(),
      options: { ...DEFAULT_TRACE_OPTIONS },
    })).toBe(true);
    expect(isTraceWorkerRequest({ type: 'cancel', jobId: 1 })).toBe(true);
  });

  it('rejects malformed requests before the Worker processes them', () => {
    expect(isTraceWorkerRequest({
      type: 'trace',
      jobId: 0,
      imageData: imageData(),
      options: { ...DEFAULT_TRACE_OPTIONS },
    })).toBe(false);
    expect(isTraceWorkerRequest({
      type: 'trace',
      jobId: 1,
      imageData: imageData(),
      options: { ...DEFAULT_TRACE_OPTIONS, maxDimension: 0 },
    })).toBe(false);
    expect(isTraceWorkerRequest({
      type: 'trace',
      jobId: 1,
      imageData: imageData(),
      options: { ...DEFAULT_TRACE_OPTIONS, coordinateSnap: 10.5 },
    })).toBe(false);
    expect(isTraceWorkerRequest({
      type: 'trace',
      jobId: 1,
      imageData: { ...imageData(), data: new Uint8ClampedArray(3) },
      options: { ...DEFAULT_TRACE_OPTIONS },
    })).toBe(false);
  });

  it('recognizes progress, success, and classified failure responses', () => {
    expect(isTraceResponse({
      type: 'trace-progress',
      jobId: 4,
      stage: 'contours',
      progress: 0.4,
    })).toBe(true);
    expect(isTraceResponse({
      type: 'trace-success',
      jobId: 4,
      drawing: drawing(),
    })).toBe(true);
    expect(isTraceResponse({
      type: 'trace-failure',
      jobId: 4,
      code: 'NO_SHAPES',
      message: 'No shapes were detected.',
    })).toBe(true);
  });

  it('rejects out-of-range progress and invalid drawing or error payloads', () => {
    expect(isTraceResponse({
      type: 'trace-progress',
      jobId: 4,
      stage: 'contours',
      progress: 1.1,
    })).toBe(false);
    expect(isTraceResponse({
      type: 'trace-success',
      jobId: 4,
      drawing: { ...drawing(), sourceWidth: 0 },
    })).toBe(false);
    expect(isTraceResponse({
      type: 'trace-failure',
      jobId: 4,
      code: 'UNKNOWN_ERROR',
      message: 'Failed.',
    })).toBe(false);
  });
});
