import { useEffect, useMemo, useRef, useState } from 'react';
import {
  sectionProfileBounds,
  type SectionProfileData,
  type SectionProperties,
} from '../domain/section';
import { calculateSectionProperties } from '../utils/sectionProperties';
import {
  isSectionAnalysisResponse,
  type SectionAnalysisRequest,
} from '../workers/sectionAnalysisProtocol';

export const LARGE_SECTION_POINT_THRESHOLD = 5_000;
export const SECTION_ANALYSIS_DEBOUNCE_MS = 75;

export interface SectionAnalysisState {
  profile: SectionProfileData;
  properties: SectionProperties;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SectionAnalysisStatus {
  analysis: SectionAnalysisState | null;
  error: string | null;
  pending: boolean;
}

export interface SectionAnalysisOptions {
  debounceMs?: number;
  workerPointThreshold?: number;
  workerFactory?: () => Worker | null;
}

interface AsyncAnalysisState extends SectionAnalysisStatus {
  source: SectionProfileData | null;
  sourceRevision: number;
}

function createSectionAnalysisWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(
      new URL('../workers/sectionAnalysisWorker.ts', import.meta.url),
      { type: 'module' },
    );
  } catch {
    return null;
  }
}

function pointCount(profile: SectionProfileData): number {
  return profile.rings.reduce((count, ring) => count + ring.points.length, 0);
}

function completeAnalysis(
  profile: SectionProfileData,
  properties: SectionProperties,
): SectionAnalysisState {
  const { minX, minY, maxX, maxY } = sectionProfileBounds(profile, 'outer');
  return { profile, properties, minX, minY, maxX, maxY };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Section analysis failed.';
}

function runImmediateAnalysis(profile: SectionProfileData): SectionAnalysisStatus {
  try {
    return {
      analysis: completeAnalysis(profile, calculateSectionProperties(profile)),
      error: null,
      pending: false,
    };
  } catch (error) {
    return { analysis: null, error: errorMessage(error), pending: false };
  }
}

/**
 * Keeps ordinary sections synchronous while moving large integrations off the
 * UI thread. Every large revision gets an isolated worker and monotonic job ID
 * so a terminated worker cannot publish into a newer selection or commit.
 */
export function useSectionAnalysis(
  profile: SectionProfileData | null,
  revision: number,
  options: SectionAnalysisOptions = {},
): SectionAnalysisStatus {
  const debounceMs = options.debounceMs ?? SECTION_ANALYSIS_DEBOUNCE_MS;
  const workerPointThreshold = options.workerPointThreshold ?? LARGE_SECTION_POINT_THRESHOLD;
  const workerFactory = options.workerFactory ?? createSectionAnalysisWorker;
  const profilePointCount = useMemo(() => profile ? pointCount(profile) : 0, [profile]);
  const requiresWorker = profile !== null && profilePointCount >= workerPointThreshold;
  const immediate = useMemo(() => {
    void revision;
    return profile && !requiresWorker ? runImmediateAnalysis(profile) : null;
  }, [profile, requiresWorker, revision]);
  const [asyncState, setAsyncState] = useState<AsyncAnalysisState>({
    source: null,
    sourceRevision: Number.NaN,
    analysis: null,
    error: null,
    pending: false,
  });
  const activeJobIdRef = useRef(0);
  const activeWorkerRef = useRef<Worker | null>(null);

  useEffect(() => {
    void revision;
    const jobId = activeJobIdRef.current + 1;
    activeJobIdRef.current = jobId;
    activeWorkerRef.current?.terminate();
    activeWorkerRef.current = null;
    if (!profile || !requiresWorker) return undefined;

    let disposed = false;
    let jobWorker: Worker | null = null;
    const publish = (
      next: Omit<AsyncAnalysisState, 'source' | 'sourceRevision'>,
    ): void => {
      if (disposed || activeJobIdRef.current !== jobId) return;
      setAsyncState({ source: profile, sourceRevision: revision, ...next });
    };
    const timer = window.setTimeout(() => {
      if (disposed || activeJobIdRef.current !== jobId) return;
      const worker = workerFactory();
      if (!worker) {
        try {
          publish({
            analysis: completeAnalysis(profile, calculateSectionProperties(profile)),
            error: null,
            pending: false,
          });
        } catch (error) {
          publish({ analysis: null, error: errorMessage(error), pending: false });
        }
        return;
      }

      jobWorker = worker;
      activeWorkerRef.current = worker;
      const finishWorker = (): void => {
        worker.terminate();
        if (activeWorkerRef.current === worker) activeWorkerRef.current = null;
      };
      worker.onmessage = (event: MessageEvent<unknown>) => {
        const response = event.data;
        if (!isSectionAnalysisResponse(response)
            || response.jobId !== jobId
            || disposed
            || activeJobIdRef.current !== jobId) return;
        if (response.type === 'section-analysis-success') {
          publish({
            analysis: completeAnalysis(profile, response.properties),
            error: null,
            pending: false,
          });
        } else {
          publish({ analysis: null, error: response.message, pending: false });
        }
        finishWorker();
      };
      worker.onerror = (event) => {
        publish({
          analysis: null,
          error: event.message || 'Section analysis worker failed.',
          pending: false,
        });
        finishWorker();
      };
      const request: SectionAnalysisRequest = {
        type: 'section-analysis-request',
        jobId,
        profile,
      };
      worker.postMessage(request);
    }, Math.max(0, debounceMs));

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      jobWorker?.terminate();
      if (activeWorkerRef.current === jobWorker) activeWorkerRef.current = null;
    };
  }, [debounceMs, profile, requiresWorker, revision, workerFactory]);

  if (!profile) return { analysis: null, error: null, pending: false };
  if (immediate) return immediate;
  if (asyncState.source === profile && asyncState.sourceRevision === revision) return asyncState;
  return { analysis: null, error: null, pending: true };
}
