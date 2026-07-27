import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TracedDrawing } from '../domain/trace/tracedDrawing';
import {
  DEFAULT_TRACE_OPTIONS,
  type TraceRequest,
  type TraceResponse,
  type TraceWorkerRequest,
} from '../workers/traceProtocol';
import {
  TRACE_TIMEOUT_MS,
  TraceService,
  TraceServiceError,
} from './traceService';

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
      kind: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
      closed: true,
    }],
    stats: {
      componentCount: 1,
      vertexCount: 3,
      droppedCount: 0,
    },
  };
}

class FakeTraceWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly messages: Array<{
    message: TraceWorkerRequest;
    transfer?: Transferable[];
  }> = [];
  readonly terminate = vi.fn();

  postMessage(message: TraceWorkerRequest, transfer?: Transferable[]): void {
    this.messages.push({ message, transfer });
  }

  respond(response: TraceResponse | unknown): void {
    this.onmessage?.({ data: response } as MessageEvent<unknown>);
  }

  fail(message: string): void {
    this.onerror?.({
      message,
      preventDefault: vi.fn(),
    } as unknown as ErrorEvent);
  }
}

function workerHarness() {
  const workers: FakeTraceWorker[] = [];
  const factory = vi.fn(() => {
    const worker = new FakeTraceWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  });
  return { workers, factory };
}

async function rejection(job: Promise<TracedDrawing>): Promise<TraceServiceError> {
  try {
    await job;
  } catch (error) {
    return error as TraceServiceError;
  }
  throw new Error('Expected trace job to reject.');
}

describe('TraceService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the planned 60 second default timeout', () => {
    expect(TRACE_TIMEOUT_MS).toBe(60_000);
  });

  it('assigns monotonic job IDs, transfers the pixel buffer, and resolves success', async () => {
    const harness = workerHarness();
    const service = new TraceService({ workerFactory: harness.factory });
    const progress = vi.fn();
    const pixels = imageData();
    const first = service.start(
      pixels,
      { ...DEFAULT_TRACE_OPTIONS },
      { onProgress: progress },
    );
    const second = service.start(imageData(), { ...DEFAULT_TRACE_OPTIONS });

    expect(first.jobId).toBe(1);
    expect(second.jobId).toBe(2);
    const firstRequest = harness.workers[0].messages[0];
    expect(firstRequest.message).toMatchObject({
      type: 'trace',
      jobId: 1,
      imageData: pixels,
    });
    expect(firstRequest.transfer).toEqual([pixels.data.buffer]);

    harness.workers[0].respond({
      type: 'trace-progress',
      jobId: 1,
      stage: 'contours',
      progress: 0.4,
    });
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'contours',
      progress: 0.4,
    }));

    const output = drawing();
    harness.workers[0].respond({
      type: 'trace-success',
      jobId: 1,
      drawing: output,
    });
    await expect(first.result).resolves.toBe(output);
    expect(harness.workers[0].terminate).toHaveBeenCalledTimes(1);

    second.cancel();
    await expect(second.result).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('sends cancellation to the matching Worker and rejects the job', async () => {
    const harness = workerHarness();
    const service = new TraceService({ workerFactory: harness.factory });
    const job = service.start(imageData(), { ...DEFAULT_TRACE_OPTIONS });

    expect(service.cancel(job.jobId)).toBe(true);
    expect(harness.workers[0].messages[1].message).toEqual({
      type: 'cancel',
      jobId: job.jobId,
    });
    expect(harness.workers[0].terminate).toHaveBeenCalledTimes(1);
    expect((await rejection(job.result)).code).toBe('CANCELLED');
    expect(service.cancel(job.jobId)).toBe(false);
  });

  it('cancels through AbortSignal', async () => {
    const harness = workerHarness();
    const controller = new AbortController();
    const service = new TraceService({ workerFactory: harness.factory });
    const job = service.start(
      imageData(),
      { ...DEFAULT_TRACE_OPTIONS },
      { signal: controller.signal },
    );

    controller.abort();

    expect((await rejection(job.result)).code).toBe('CANCELLED');
    expect(harness.workers[0].terminate).toHaveBeenCalledTimes(1);
  });

  it('terminates and classifies a timed-out job', async () => {
    const harness = workerHarness();
    const service = new TraceService({
      workerFactory: harness.factory,
      timeoutMs: 100,
    });
    const job = service.start(imageData(), { ...DEFAULT_TRACE_OPTIONS });

    await vi.advanceTimersByTimeAsync(100);

    expect((await rejection(job.result)).code).toBe('TIMEOUT');
    expect(harness.workers[0].messages.at(-1)?.message).toEqual({
      type: 'cancel',
      jobId: job.jobId,
    });
    expect(harness.workers[0].terminate).toHaveBeenCalledTimes(1);
  });

  it('classifies Worker failures and rejects malformed responses', async () => {
    const harness = workerHarness();
    const service = new TraceService({ workerFactory: harness.factory });
    const failed = service.start(imageData(), { ...DEFAULT_TRACE_OPTIONS });
    harness.workers[0].respond({
      type: 'trace-failure',
      jobId: failed.jobId,
      code: 'NO_SHAPES',
      message: 'No shapes were detected.',
    });
    await expect(failed.result).rejects.toMatchObject({
      code: 'NO_SHAPES',
      message: 'No shapes were detected.',
    });

    const malformed = service.start(imageData(), { ...DEFAULT_TRACE_OPTIONS });
    harness.workers[1].respond({
      type: 'trace-success',
      jobId: malformed.jobId,
      drawing: { shapes: 'not-an-array' },
    });
    await expect(malformed.result).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('classifies Worker runtime errors and unavailable Worker support', async () => {
    const harness = workerHarness();
    const service = new TraceService({ workerFactory: harness.factory });
    const crashed = service.start(imageData(), { ...DEFAULT_TRACE_OPTIONS });

    harness.workers[0].fail('Worker crashed.');

    await expect(crashed.result).rejects.toMatchObject({
      code: 'WORKER_ERROR',
      message: 'Worker crashed.',
    });
    expect(harness.workers[0].terminate).toHaveBeenCalledTimes(1);

    const unavailableService = new TraceService({ workerFactory: () => null });
    const unavailable = unavailableService.start(
      imageData(),
      { ...DEFAULT_TRACE_OPTIONS },
    );
    await expect(unavailable.result).rejects.toMatchObject({
      code: 'WORKER_UNAVAILABLE',
    });
  });

  it('does not start a Worker for invalid input or options', async () => {
    const harness = workerHarness();
    const service = new TraceService({ workerFactory: harness.factory });
    const invalidImage = service.start(
      { ...imageData(), data: new Uint8ClampedArray(3) },
      { ...DEFAULT_TRACE_OPTIONS },
    );
    const invalidOptions = service.start(
      imageData(),
      { ...DEFAULT_TRACE_OPTIONS, vertexLimit: 0 },
    );

    expect((await rejection(invalidImage.result)).code).toBe('INVALID_IMAGE');
    expect((await rejection(invalidOptions.result)).code).toBe('INVALID_OPTIONS');
    expect(harness.factory).not.toHaveBeenCalled();
  });

  it('ignores responses for a different job ID', () => {
    const harness = workerHarness();
    const service = new TraceService({ workerFactory: harness.factory });
    const job = service.start(imageData(), { ...DEFAULT_TRACE_OPTIONS });
    const request = harness.workers[0].messages[0].message as TraceRequest;

    harness.workers[0].respond({
      type: 'trace-success',
      jobId: request.jobId + 1,
      drawing: drawing(),
    });

    expect(harness.workers[0].terminate).not.toHaveBeenCalled();
    job.cancel();
  });
});
