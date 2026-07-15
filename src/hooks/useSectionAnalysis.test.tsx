import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SectionProfileData, SectionProperties } from '../domain/section';
import type {
  SectionAnalysisRequest,
  SectionAnalysisResponse,
} from '../workers/sectionAnalysisProtocol';
import { useSectionAnalysis } from './useSectionAnalysis';

const analysisMocks = vi.hoisted(() => ({
  calculateProperties: vi.fn(),
}));

vi.mock('../utils/sectionProperties', () => ({
  calculateSectionProperties: analysisMocks.calculateProperties,
}));

const PROPERTIES: SectionProperties = {
  area: 10_000,
  centroid: { x: 0, y: 0 },
  ix: 8_000_000,
  iy: 8_000_000,
  ixy: 0,
  principalMax: 8_000_000,
  principalMin: 8_000_000,
  principalAngleDeg: 0,
  cTop: 50,
  cBottom: 50,
  cLeft: 50,
  cRight: 50,
  zxTop: 160_000,
  zxBottom: 160_000,
  zyLeft: 160_000,
  zyRight: 160_000,
};

function largeProfile(pointTotal = 10_000, xOffset = 0): SectionProfileData {
  return {
    version: 1,
    rings: [{
      role: 'outer',
      points: Array.from({ length: pointTotal }, (_, index) => {
        const angle = index / pointTotal * Math.PI * 2;
        return { x: xOffset + Math.cos(angle) * 50, y: Math.sin(angle) * 50 };
      }),
    }],
    analysisToleranceMm: 0.01,
    approximate: true,
  };
}

class FakeSectionWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly requests: SectionAnalysisRequest[] = [];
  readonly terminate = vi.fn();

  postMessage(message: SectionAnalysisRequest): void {
    this.requests.push(message);
  }

  respond(response: SectionAnalysisResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<SectionAnalysisResponse>);
  }
}

function workerHarness() {
  const workers: FakeSectionWorker[] = [];
  const factory = vi.fn(() => {
    const worker = new FakeSectionWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  });
  return { workers, factory };
}

describe('useSectionAnalysis', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    analysisMocks.calculateProperties.mockReset().mockReturnValue(PROPERTIES);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('routes a 10,000-point section through a debounced Worker job', () => {
    const profile = largeProfile();
    const harness = workerHarness();
    const { result } = renderHook(() => useSectionAnalysis(profile, 1, {
      debounceMs: 25,
      workerFactory: harness.factory,
    }));

    expect(result.current).toMatchObject({ analysis: null, pending: true });
    expect(harness.factory).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(24));
    expect(harness.factory).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(harness.factory).toHaveBeenCalledTimes(1);
    expect(harness.workers[0].requests).toHaveLength(1);
    expect(harness.workers[0].requests[0].profile.rings[0].points).toHaveLength(10_000);
    expect(analysisMocks.calculateProperties).not.toHaveBeenCalled();

    const request = harness.workers[0].requests[0];
    act(() => harness.workers[0].respond({
      type: 'section-analysis-success',
      jobId: request.jobId,
      properties: PROPERTIES,
    }));

    expect(result.current.pending).toBe(false);
    expect(result.current.analysis?.properties).toBe(PROPERTIES);
    expect(harness.workers[0].terminate).toHaveBeenCalledTimes(1);
  });

  it('terminates the previous Worker and ignores its late result', () => {
    const profile = largeProfile(10_000, 0);
    const harness = workerHarness();
    const { result, rerender } = renderHook(
      ({ profile, revision }) => useSectionAnalysis(profile, revision, {
        debounceMs: 10,
        workerFactory: harness.factory,
      }),
      { initialProps: { profile, revision: 1 } },
    );

    act(() => vi.advanceTimersByTime(10));
    const firstWorker = harness.workers[0];
    const firstRequest = firstWorker.requests[0];

    // A revision must invalidate the result even when a caller reuses the
    // same detached profile reference.
    rerender({ profile, revision: 2 });
    expect(firstWorker.terminate).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ analysis: null, pending: true });
    act(() => vi.advanceTimersByTime(10));
    const secondWorker = harness.workers[1];
    const secondRequest = secondWorker.requests[0];

    act(() => firstWorker.respond({
      type: 'section-analysis-success',
      jobId: firstRequest.jobId,
      properties: PROPERTIES,
    }));
    expect(result.current).toMatchObject({ analysis: null, pending: true });

    const latestProperties = { ...PROPERTIES, area: 20_000 };
    act(() => secondWorker.respond({
      type: 'section-analysis-success',
      jobId: secondRequest.jobId,
      properties: latestProperties,
    }));
    expect(result.current.analysis?.properties.area).toBe(20_000);
  });

  it('keeps an active Worker when a parent rerenders with the same scoped revision', () => {
    const profile = largeProfile();
    const harness = workerHarness();
    const { rerender } = renderHook(
      ({ unrelatedRevision }) => {
        void unrelatedRevision;
        return useSectionAnalysis(profile, 7, {
          debounceMs: 10,
          workerFactory: harness.factory,
        });
      },
      { initialProps: { unrelatedRevision: 1 } },
    );

    act(() => vi.advanceTimersByTime(10));
    const worker = harness.workers[0];

    rerender({ unrelatedRevision: 2 });
    act(() => vi.advanceTimersByTime(10));

    expect(harness.factory).toHaveBeenCalledTimes(1);
    expect(worker.requests).toHaveLength(1);
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it('falls back after the debounce when Worker is unavailable', () => {
    const profile = largeProfile();
    const { result } = renderHook(() => useSectionAnalysis(profile, 1, {
      debounceMs: 10,
      workerFactory: () => null,
    }));

    expect(analysisMocks.calculateProperties).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(10));

    expect(analysisMocks.calculateProperties).toHaveBeenCalledTimes(1);
    expect(analysisMocks.calculateProperties).toHaveBeenCalledWith(profile);
    expect(result.current.analysis?.properties).toBe(PROPERTIES);
  });

  it('terminates an active Worker when the hook unmounts', () => {
    const harness = workerHarness();
    const { unmount } = renderHook(() => useSectionAnalysis(largeProfile(), 1, {
      debounceMs: 0,
      workerFactory: harness.factory,
    }));
    act(() => vi.runOnlyPendingTimers());

    const worker = harness.workers[0];
    unmount();

    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
