import type { TracedDrawing } from '../domain/trace/tracedDrawing';
import {
  isTraceResponse,
  isTraceOptions,
  type TraceCancelRequest,
  type TraceErrorCode,
  type TraceOptions,
  type TraceProgressResponse,
  type TraceRequest,
} from '../workers/traceProtocol';

export const TRACE_TIMEOUT_MS = 60_000;

export class TraceServiceError extends Error {
  readonly code: TraceErrorCode;

  constructor(code: TraceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TraceServiceError';
    this.code = code;
  }
}

export interface TraceJobCallbacks {
  onProgress?: (progress: TraceProgressResponse) => void;
  signal?: AbortSignal;
}

export interface TraceJob {
  readonly jobId: number;
  readonly result: Promise<TracedDrawing>;
  cancel(): void;
}

export interface TraceServiceOptions {
  workerFactory?: () => Worker | null;
  timeoutMs?: number;
}

interface ActiveTraceJob {
  worker: Worker;
  timer: ReturnType<typeof setTimeout>;
  reject: (reason: TraceServiceError) => void;
  abortSignal?: AbortSignal;
  abortListener?: () => void;
}

function createTraceWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(
      new URL('../workers/traceWorker.ts', import.meta.url),
      { type: 'module' },
    );
  } catch {
    return null;
  }
}

function cancellationError(): TraceServiceError {
  return new TraceServiceError('CANCELLED', 'Image tracing was cancelled.');
}

function validateImageData(imageData: ImageData): void {
  if (!imageData
      || !Number.isSafeInteger(imageData.width)
      || !Number.isSafeInteger(imageData.height)
      || imageData.width <= 0
      || imageData.height <= 0
      || !(imageData.data instanceof Uint8ClampedArray)
      || imageData.data.length !== imageData.width * imageData.height * 4) {
    throw new TraceServiceError('INVALID_IMAGE', 'Image data is invalid.');
  }
}

/**
 * Owns trace Worker lifetimes. A source ImageData buffer is transferred to its
 * job Worker and is therefore detached after `start` posts the request.
 */
export class TraceService {
  private readonly workerFactory: () => Worker | null;
  private readonly timeoutMs: number;
  private readonly activeJobs = new Map<number, ActiveTraceJob>();
  private nextJobId = 1;

  constructor(options: TraceServiceOptions = {}) {
    this.workerFactory = options.workerFactory ?? createTraceWorker;
    this.timeoutMs = options.timeoutMs ?? TRACE_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TraceServiceError('INVALID_OPTIONS', 'Trace timeout must be positive.');
    }
  }

  start(
    imageData: ImageData,
    options: TraceOptions,
    callbacks: TraceJobCallbacks = {},
  ): TraceJob {
    const jobId = this.nextJobId;
    this.nextJobId += 1;

    let resolveResult: (drawing: TracedDrawing) => void = () => undefined;
    let rejectResult: (reason: TraceServiceError) => void = () => undefined;
    const result = new Promise<TracedDrawing>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    // Attach a handler immediately so synchronous validation failures do not
    // become transient unhandled rejections before a caller can await result.
    void result.catch(() => undefined);

    const failBeforeStart = (error: TraceServiceError): TraceJob => {
      rejectResult(error);
      return { jobId, result, cancel: () => undefined };
    };

    try {
      validateImageData(imageData);
      if (!isTraceOptions(options)) {
        return failBeforeStart(new TraceServiceError(
          'INVALID_OPTIONS',
          'Trace options are invalid.',
        ));
      }
    } catch (error) {
      return failBeforeStart(error instanceof TraceServiceError
        ? error
        : new TraceServiceError('INVALID_IMAGE', 'Image data is invalid.', { cause: error }));
    }

    if (callbacks.signal?.aborted) return failBeforeStart(cancellationError());

    let worker: Worker | null;
    try {
      worker = this.workerFactory();
    } catch (error) {
      return failBeforeStart(new TraceServiceError(
        'WORKER_UNAVAILABLE',
        'Image trace Worker could not be created.',
        { cause: error },
      ));
    }
    if (!worker) {
      return failBeforeStart(new TraceServiceError(
        'WORKER_UNAVAILABLE',
        'Image trace Worker is not available.',
      ));
    }

    const finish = (
      outcome: { drawing: TracedDrawing } | { error: TraceServiceError },
    ): void => {
      const active = this.activeJobs.get(jobId);
      if (!active || active.worker !== worker) return;
      this.activeJobs.delete(jobId);
      clearTimeout(active.timer);
      if (active.abortSignal && active.abortListener) {
        active.abortSignal.removeEventListener('abort', active.abortListener);
      }
      worker.terminate();
      if ('drawing' in outcome) resolveResult(outcome.drawing);
      else rejectResult(outcome.error);
    };

    worker.onmessage = (event: MessageEvent<unknown>) => {
      const response = event.data;
      if (!isTraceResponse(response)) {
        finish({ error: new TraceServiceError(
          'INVALID_RESPONSE',
          'Image trace Worker returned an invalid response.',
        ) });
        return;
      }
      if (response.jobId !== jobId) return;
      if (response.type === 'trace-progress') {
        callbacks.onProgress?.(response);
        return;
      }
      if (response.type === 'trace-success') {
        finish({ drawing: response.drawing });
        return;
      }
      finish({ error: new TraceServiceError(response.code, response.message) });
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish({ error: new TraceServiceError(
        'WORKER_ERROR',
        event.message || 'Image trace Worker failed.',
      ) });
    };
    worker.onmessageerror = () => {
      finish({ error: new TraceServiceError(
        'INVALID_RESPONSE',
        'Image trace Worker response could not be decoded.',
      ) });
    };

    const timer = setTimeout(() => {
      const cancelRequest: TraceCancelRequest = { type: 'cancel', jobId };
      try {
        worker.postMessage(cancelRequest);
      } catch {
        // The Worker is terminated below even when its channel already closed.
      }
      finish({ error: new TraceServiceError(
        'TIMEOUT',
        `Image tracing exceeded ${this.timeoutMs} ms.`,
      ) });
    }, this.timeoutMs);

    const active: ActiveTraceJob = {
      worker,
      timer,
      reject: rejectResult,
      abortSignal: callbacks.signal,
    };
    if (callbacks.signal) {
      active.abortListener = () => {
        this.cancel(jobId);
      };
      callbacks.signal.addEventListener('abort', active.abortListener, { once: true });
    }
    this.activeJobs.set(jobId, active);

    const request: TraceRequest = {
      type: 'trace',
      jobId,
      imageData,
      options,
    };
    try {
      worker.postMessage(request, [imageData.data.buffer]);
    } catch (error) {
      finish({ error: new TraceServiceError(
        'WORKER_ERROR',
        'Image data could not be sent to the trace Worker.',
        { cause: error },
      ) });
    }

    return {
      jobId,
      result,
      cancel: () => {
        this.cancel(jobId);
      },
    };
  }

  cancel(jobId: number): boolean {
    const active = this.activeJobs.get(jobId);
    if (!active) return false;
    const request: TraceCancelRequest = { type: 'cancel', jobId };
    try {
      active.worker.postMessage(request);
    } catch {
      // Terminating the Worker remains a reliable cancellation fallback.
    }
    this.finishCancellation(jobId, active);
    return true;
  }

  cancelAll(): void {
    for (const [jobId, active] of [...this.activeJobs]) {
      try {
        const request: TraceCancelRequest = { type: 'cancel', jobId };
        active.worker.postMessage(request);
      } catch {
        // Continue cancelling the remaining jobs.
      }
      this.finishCancellation(jobId, active);
    }
  }

  dispose(): void {
    this.cancelAll();
  }

  private finishCancellation(jobId: number, active: ActiveTraceJob): void {
    if (this.activeJobs.get(jobId) !== active) return;
    this.activeJobs.delete(jobId);
    clearTimeout(active.timer);
    if (active.abortSignal && active.abortListener) {
      active.abortSignal.removeEventListener('abort', active.abortListener);
    }
    active.worker.terminate();
    active.reject(cancellationError());
  }
}

export const traceService = new TraceService();
