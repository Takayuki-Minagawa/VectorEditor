import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type * as fabric from 'fabric';
import {
  DEFAULT_TRACE_OPTIONS,
  type TraceOptions,
  type TraceProgressStage,
} from '../workers/traceProtocol';
import {
  traceService,
  TraceServiceError,
  type TraceJob,
} from '../services/traceService';
import type { TracedDrawing, TracedShape } from '../domain/trace/tracedDrawing';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import type { TranslationKeys } from '../i18n/ja';
import {
  blobToImageData,
  fabricImageToImageData,
  firstClipboardImage,
  isAcceptedTraceImage,
  TRACE_ACCEPTED_IMAGE_TYPES,
} from '../utils/traceImageData';
import Dialog from './Dialog';

const DEBOUNCE_MS = 300;

interface TraceDialogProps {
  sourceImage?: fabric.Image;
  onClose: () => void;
}

function cloneImageData(imageData: ImageData): ImageData {
  return new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height,
  );
}

function errorTranslation(error: unknown): TranslationKeys {
  if (!(error instanceof TraceServiceError)) return 'traceWorkerError';
  switch (error.code) {
    case 'INVALID_IMAGE':
      return 'traceImageReadError';
    case 'NO_SHAPES':
      return 'traceNoShapes';
    case 'VERTEX_LIMIT_EXCEEDED':
      return 'traceTooComplex';
    case 'TIMEOUT':
      return 'traceTimedOut';
    case 'CANCELLED':
      return 'traceCancelled';
    default:
      return 'traceWorkerError';
  }
}

function progressTranslation(stage: TraceProgressStage): TranslationKeys {
  switch (stage) {
    case 'preprocess':
      return 'traceProgressPreprocess';
    case 'components':
    case 'contours':
    case 'simplify':
      return 'traceProgressContours';
    case 'centerlines':
      return 'traceProgressCenterline';
    case 'classify':
    case 'align':
      return 'traceProgressClassify';
    case 'complete':
      return 'traceProgressFinalize';
  }
}

function previewRingPath(points: readonly { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  return [
    `M ${points[0].x} ${points[0].y}`,
    ...points.slice(1).map((point) => `L ${point.x} ${point.y}`),
    'Z',
  ].join(' ');
}

function previewShape(shape: TracedShape, index: number) {
  const strokeProps = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (shape.kind) {
    case 'polygon': {
      if (shape.holes && shape.holes.length > 0) {
        return (
          <path
            key={index}
            d={[
              previewRingPath(shape.points),
              ...shape.holes.map(previewRingPath),
            ].join(' ')}
            fill="currentColor"
            fillRule="evenodd"
          />
        );
      }
      return (
        <polygon
          key={index}
          points={shape.points.map((point) => `${point.x},${point.y}`).join(' ')}
          fill="currentColor"
        />
      );
    }
    case 'polyline':
      return (
        <polyline
          key={index}
          points={shape.points.map((point) => `${point.x},${point.y}`).join(' ')}
          {...strokeProps}
          strokeWidth={Math.max(0.5, shape.strokeWidth)}
        />
      );
    case 'line':
      return (
        <line
          key={index}
          x1={shape.x1}
          y1={shape.y1}
          x2={shape.x2}
          y2={shape.y2}
          {...strokeProps}
          strokeWidth={Math.max(0.5, shape.strokeWidth)}
        />
      );
    case 'rect':
      return (
        <rect
          key={index}
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          transform={shape.angle
            ? `rotate(${shape.angle} ${shape.x} ${shape.y})`
            : undefined}
          {...strokeProps}
          strokeWidth={2}
        />
      );
    case 'circle':
      return (
        <circle
          key={index}
          cx={shape.cx}
          cy={shape.cy}
          r={shape.r}
          {...strokeProps}
          strokeWidth={2}
        />
      );
    case 'ellipse':
      return (
        <ellipse
          key={index}
          cx={shape.cx}
          cy={shape.cy}
          rx={shape.rx}
          ry={shape.ry}
          transform={shape.angle
            ? `rotate(${shape.angle} ${shape.cx} ${shape.cy})`
            : undefined}
          {...strokeProps}
          strokeWidth={2}
        />
      );
  }
}

export default function TraceDialog({ sourceImage, onClose }: TraceDialogProps) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const decodeTokenRef = useRef(0);
  const jobRef = useRef<TraceJob | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const traceGenerationRef = useRef(0);
  const canvas = useEditorStore((state) => state.canvas);
  const insertTracedDrawing = useEditorStore((state) => state.insertTracedDrawing);
  const showToast = useEditorStore((state) => state.showToast);
  const t = useI18n((state) => state.t);

  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [options, setOptions] = useState<TraceOptions>(() => ({
    ...DEFAULT_TRACE_OPTIONS,
  }));
  const [groupResult, setGroupResult] = useState(false);
  const [drawing, setDrawing] = useState<TracedDrawing | null>(null);
  const [processing, setProcessing] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<TraceProgressStage>('preprocess');
  const [errorKey, setErrorKey] = useState<TranslationKeys | null>(null);
  const [dragging, setDragging] = useState(false);

  const cancelActiveJob = useCallback(() => {
    traceGenerationRef.current += 1;
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const active = jobRef.current;
    jobRef.current = null;
    active?.cancel();
  }, []);

  const loadBlob = useCallback(async (blob: Blob, name = '') => {
    const token = ++decodeTokenRef.current;
    cancelActiveJob();
    if (!isAcceptedTraceImage(blob)) {
      setDecoding(false);
      setProcessing(false);
      setDrawing(null);
      setImageData(null);
      setSourceName('');
      setErrorKey('traceImageReadError');
      return;
    }
    setDecoding(true);
    setProcessing(false);
    setDrawing(null);
    setErrorKey(null);
    try {
      const decoded = await blobToImageData(blob);
      if (decodeTokenRef.current !== token) return;
      setImageData(decoded);
      setSourceName(name);
    } catch {
      if (decodeTokenRef.current !== token) return;
      setImageData(null);
      setSourceName('');
      setErrorKey('traceImageReadError');
    } finally {
      if (decodeTokenRef.current === token) setDecoding(false);
    }
  }, [cancelActiveJob]);

  useEffect(() => {
    if (!sourceImage) return;
    try {
      setImageData(fabricImageToImageData(sourceImage));
      setSourceName('');
      setErrorKey(null);
    } catch {
      setErrorKey('traceImageReadError');
    }
  }, [sourceImage]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const file = firstClipboardImage(event.clipboardData);
      if (!file) return;
      event.preventDefault();
      void loadBlob(file, file.name);
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [loadBlob]);

  useEffect(() => {
    if (!imageData) return;
    cancelActiveJob();
    setProcessing(true);
    setDrawing(null);
    setErrorKey(null);
    setProgress(0);
    setStage('preprocess');
    const generation = traceGenerationRef.current;

    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      if (traceGenerationRef.current !== generation) return;
      const job = traceService.start(
        cloneImageData(imageData),
        options,
        {
          onProgress: (update) => {
            if (
              traceGenerationRef.current !== generation
              || jobRef.current?.jobId !== update.jobId
            ) return;
            setProgress(update.progress);
            setStage(update.stage);
          },
        },
      );
      jobRef.current = job;
      void job.result.then((result) => {
        if (
          traceGenerationRef.current !== generation
          || jobRef.current?.jobId !== job.jobId
        ) return;
        jobRef.current = null;
        setDrawing(result);
        setProgress(1);
        setStage('complete');
        setProcessing(false);
      }).catch((error: unknown) => {
        if (
          traceGenerationRef.current !== generation
          || jobRef.current?.jobId !== job.jobId
        ) return;
        jobRef.current = null;
        setDrawing(null);
        setErrorKey(errorTranslation(error));
        setProcessing(false);
      });
    }, DEBOUNCE_MS);

    return cancelActiveJob;
  }, [cancelActiveJob, imageData, options]);

  useEffect(() => () => {
    decodeTokenRef.current += 1;
    cancelActiveJob();
  }, [cancelActiveJob]);

  const close = () => {
    decodeTokenRef.current += 1;
    cancelActiveJob();
    onClose();
  };

  const cancel = () => {
    cancelActiveJob();
    setProcessing(false);
    setDrawing(null);
    setErrorKey('traceCancelled');
  };

  const insert = () => {
    if (!drawing || !canvas) return;
    try {
      const objects = insertTracedDrawing(drawing, { group: groupResult });
      if (objects.length === 0) {
        setErrorKey('traceNoShapes');
        return;
      }
      showToast(t('traceInserted'), 'success');
      close();
    } catch {
      setErrorKey('traceWorkerError');
    }
  };

  const updateOption = <Key extends keyof TraceOptions>(
    key: Key,
    value: TraceOptions[Key],
  ) => {
    setOptions((current) => ({ ...current, [key]: value }));
  };

  const warning = drawing
    ? drawing.stats.vertexCount >= options.vertexLimit * 0.8
    : false;
  const preview = useMemo(() => drawing?.shapes.map(previewShape), [drawing]);
  const busy = processing || decoding;

  return (
    <Dialog
      title={t('traceDialogTitle')}
      onClose={close}
      closeLabel={t('close')}
      className="trace-dialog"
      dismissible={!decoding}
      maxWidth="min(940px, calc(100vw - 32px))"
    >
      <div
        className={`trace-body ${dragging ? 'is-dragging' : ''}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDragging(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) void loadBlob(file, file.name);
        }}
      >
        <input
          ref={fileInputRef}
          id={inputId}
          className="sr-only"
          type="file"
          aria-label={t('traceSelectFile')}
          accept={TRACE_ACCEPTED_IMAGE_TYPES.join(',')}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void loadBlob(file, file.name);
          }}
        />

        <section className="trace-preview-column" aria-label={t('tracePreview')}>
          <div className="trace-preview-header">
            <strong>{t('tracePreview')}</strong>
            {imageData && (
              <span>
                {sourceName || `${imageData.width} × ${imageData.height}`}
              </span>
            )}
          </div>
          {!imageData ? (
            <div className="trace-dropzone">
              <span className="trace-drop-icon" aria-hidden="true">◇</span>
              <strong>{t('traceDropTitle')}</strong>
              <span>{t('traceDropHint')}</span>
              <button
                type="button"
                className="toolbar-btn trace-file-button"
                onClick={() => fileInputRef.current?.click()}
                data-autofocus
              >
                {t('traceSelectFile')}
              </button>
              <small>{t('tracePasteHint')}</small>
            </div>
          ) : (
            <>
              <div className="trace-preview">
                {drawing ? (
                  <svg
                    role="img"
                    aria-label={t('tracePreview')}
                    viewBox={`0 0 ${drawing.sourceWidth} ${drawing.sourceHeight}`}
                    preserveAspectRatio="xMidYMid meet"
                  >
                    {preview}
                  </svg>
                ) : (
                  <div className="trace-preview-empty">
                    {busy ? t('traceProcessing') : t('traceNoPreview')}
                  </div>
                )}
                {busy && (
                  <div className="trace-progress-overlay" role="status" aria-live="polite">
                    <span>{decoding ? t('traceProcessing') : t(progressTranslation(stage))}</span>
                    <progress value={decoding ? undefined : progress} max={1} />
                  </div>
                )}
              </div>
              <button
                type="button"
                className="toolbar-btn trace-replace"
                onClick={() => fileInputRef.current?.click()}
                disabled={decoding}
                data-autofocus
              >
                {t('traceReplaceImage')}
              </button>
            </>
          )}

          {drawing && (
            <div className="trace-stats" aria-live="polite">
              <span>{t('traceComponents')}: {drawing.stats.componentCount}</span>
              <span>{t('traceVertices')}: {drawing.stats.vertexCount}</span>
              <span>{t('traceDropped')}: {drawing.stats.droppedCount}</span>
            </div>
          )}
          {warning && <p className="trace-warning">{t('traceWarningLimit')}</p>}
          {errorKey && <p className="trace-error" role="alert">{t(errorKey)}</p>}
          <p className="trace-privacy">{t('tracePrivacy')}</p>
        </section>

        <section className="trace-controls" aria-label={t('traceDialogTitle')}>
          <label>
            <span>{t('traceMode')}</span>
            <select
              value={options.mode}
              onChange={(event) => updateOption(
                'mode',
                event.target.value as TraceOptions['mode'],
              )}
            >
              <option value="faithful">{t('traceModeFaithful')}</option>
              <option value="cleanup">{t('traceModeCleanup')}</option>
            </select>
          </label>

          <label>
            <span>{t('traceThresholdMethod')}</span>
            <select
              value={options.thresholdMethod}
              onChange={(event) => updateOption(
                'thresholdMethod',
                event.target.value as TraceOptions['thresholdMethod'],
              )}
            >
              <option value="otsu">{t('traceOtsu')}</option>
              <option value="sauvola">{t('traceSauvola')}</option>
            </select>
          </label>

          <label className="trace-check">
            <input
              type="checkbox"
              checked={options.threshold === null}
              onChange={(event) => updateOption(
                'threshold',
                event.target.checked ? null : 128,
              )}
            />
            <span>{t('traceAutoThreshold')}</span>
          </label>

          <label>
            <span>{t('traceThreshold')}: {options.threshold ?? 'Auto'}</span>
            <input
              type="range"
              min={0}
              max={255}
              step={1}
              value={options.threshold ?? 128}
              disabled={options.threshold === null}
              onChange={(event) => updateOption('threshold', Number(event.target.value))}
            />
          </label>

          <label>
            <span>{t('traceNoise')}: {options.minComponentArea}px²</span>
            <input
              type="range"
              min={1}
              max={100}
              step={1}
              value={options.minComponentArea}
              onChange={(event) => updateOption(
                'minComponentArea',
                Number(event.target.value),
              )}
            />
          </label>

          <label>
            <span>{t('traceSimplify')}: {options.simplifyTolerance.toFixed(1)}</span>
            <input
              type="range"
              min={0.5}
              max={8}
              step={0.5}
              value={options.simplifyTolerance}
              onChange={(event) => updateOption(
                'simplifyTolerance',
                Number(event.target.value),
              )}
            />
          </label>

          <label>
            <span>{t('traceMaxDimension')}</span>
            <select
              value={options.maxDimension}
              onChange={(event) => updateOption(
                'maxDimension',
                Number(event.target.value),
              )}
            >
              <option value={1000}>1000 px</option>
              <option value={2000}>2000 px</option>
              <option value={3000}>3000 px</option>
            </select>
          </label>

          <label className="trace-check">
            <input
              type="checkbox"
              checked={options.medianRadius > 0}
              onChange={(event) => updateOption(
                'medianRadius',
                event.target.checked ? 1 : 0,
              )}
            />
            <span>{t('traceMedian')}</span>
          </label>

          <label className="trace-check">
            <input
              type="checkbox"
              checked={options.forceCenterline}
              onChange={(event) => updateOption(
                'forceCenterline',
                event.target.checked,
              )}
            />
            <span>{t('traceLineArt')}</span>
          </label>

          <label className="trace-check">
            <input
              type="checkbox"
              checked={groupResult}
              onChange={(event) => setGroupResult(event.target.checked)}
            />
            <span>{t('traceGroup')}</span>
          </label>
        </section>
      </div>

      <div className="trace-actions">
        {processing && (
          <button type="button" className="toolbar-btn" onClick={cancel}>
            {t('traceCancel')}
          </button>
        )}
        <button type="button" className="toolbar-btn nm-cancel" onClick={close}>
          {t('close')}
        </button>
        <button
          type="button"
          className="toolbar-btn trace-insert"
          onClick={insert}
          disabled={!drawing || busy || !canvas}
        >
          {t('traceInsert')}
        </button>
      </div>
    </Dialog>
  );
}
