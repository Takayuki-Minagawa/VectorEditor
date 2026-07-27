import {
  DEFAULT_TRACE_OPTIONS,
  isTraceOptions,
  isTracedDrawing,
  type TracedDrawing,
  type TraceMode,
  type TraceOptions,
  type TraceThresholdMethod,
} from '../domain/trace/tracedDrawing';

export { DEFAULT_TRACE_OPTIONS, isTraceOptions };
export type { TraceMode, TraceOptions, TraceThresholdMethod };

export type TraceProgressStage =
  | 'preprocess'
  | 'components'
  | 'contours'
  | 'centerlines'
  | 'simplify'
  | 'classify'
  | 'align'
  | 'complete';

export type TraceErrorCode =
  | 'INVALID_IMAGE'
  | 'INVALID_OPTIONS'
  | 'NO_SHAPES'
  | 'VERTEX_LIMIT_EXCEEDED'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'WORKER_UNAVAILABLE'
  | 'WORKER_ERROR'
  | 'INVALID_RESPONSE'
  | 'PROCESSING_FAILED';

export interface TraceRequest {
  type: 'trace';
  jobId: number;
  imageData: ImageData;
  options: TraceOptions;
}

export interface TraceCancelRequest {
  type: 'cancel';
  jobId: number;
}

export type TraceWorkerRequest = TraceRequest | TraceCancelRequest;

export interface TraceProgressResponse {
  type: 'trace-progress';
  jobId: number;
  stage: TraceProgressStage;
  /** Normalized overall progress in the inclusive range 0-1. */
  progress: number;
}

export interface TraceSuccessResponse {
  type: 'trace-success';
  jobId: number;
  drawing: TracedDrawing;
}

export interface TraceFailureResponse {
  type: 'trace-failure';
  jobId: number;
  code: TraceErrorCode;
  message: string;
}

export type TraceResponse =
  | TraceProgressResponse
  | TraceSuccessResponse
  | TraceFailureResponse;

const TRACE_STAGES = new Set<TraceProgressStage>([
  'preprocess',
  'components',
  'contours',
  'centerlines',
  'simplify',
  'classify',
  'align',
  'complete',
]);

const TRACE_ERROR_CODES = new Set<TraceErrorCode>([
  'INVALID_IMAGE',
  'INVALID_OPTIONS',
  'NO_SHAPES',
  'VERTEX_LIMIT_EXCEEDED',
  'CANCELLED',
  'TIMEOUT',
  'WORKER_UNAVAILABLE',
  'WORKER_ERROR',
  'INVALID_RESPONSE',
  'PROCESSING_FAILED',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isJobId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isImageDataLike(value: unknown): value is ImageData {
  if (!isRecord(value)) return false;
  const { width, height, data } = value;
  return Number.isSafeInteger(width)
    && Number.isSafeInteger(height)
    && (width as number) > 0
    && (height as number) > 0
    && data instanceof Uint8ClampedArray
    && data.length === (width as number) * (height as number) * 4;
}

export function isTraceWorkerRequest(value: unknown): value is TraceWorkerRequest {
  if (!isRecord(value) || !isJobId(value.jobId)) return false;
  if (value.type === 'cancel') return true;
  return value.type === 'trace'
    && isImageDataLike(value.imageData)
    && isTraceOptions(value.options);
}

export function isTraceResponse(value: unknown): value is TraceResponse {
  if (!isRecord(value) || !isJobId(value.jobId)) return false;
  switch (value.type) {
    case 'trace-progress':
      return typeof value.stage === 'string'
        && TRACE_STAGES.has(value.stage as TraceProgressStage)
        && typeof value.progress === 'number'
        && Number.isFinite(value.progress)
        && value.progress >= 0
        && value.progress <= 1;
    case 'trace-success':
      return isTracedDrawing(value.drawing);
    case 'trace-failure':
      return typeof value.code === 'string'
        && TRACE_ERROR_CODES.has(value.code as TraceErrorCode)
        && typeof value.message === 'string'
        && value.message.length > 0;
    default:
      return false;
  }
}
