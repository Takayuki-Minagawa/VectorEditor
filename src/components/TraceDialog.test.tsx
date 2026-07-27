import { act, fireEvent, render, screen } from '@testing-library/react';
import type * as fabric from 'fabric';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useI18n } from '../i18n/useI18n';
import { useEditorStore } from '../store/useEditorStore';
import TraceDialog from './TraceDialog';

const mocks = vi.hoisted(() => ({
  serviceStart: vi.fn(),
  fabricImageToImageData: vi.fn(() => ({
    width: 2,
    height: 2,
    data: new Uint8ClampedArray(16),
  } as ImageData)),
}));

vi.mock('../services/traceService', () => {
  class TraceServiceError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    traceService: { start: mocks.serviceStart },
    TraceServiceError,
  };
});

vi.mock('../utils/traceImageData', () => ({
  TRACE_ACCEPTED_IMAGE_TYPES: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  blobToImageData: vi.fn(),
  fabricImageToImageData: mocks.fabricImageToImageData,
  firstClipboardImage: vi.fn(() => null),
  isAcceptedTraceImage: vi.fn(() => true),
}));

let previousLanguage = useI18n.getState().lang;

describe('TraceDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('ImageData', class {
      readonly data: Uint8ClampedArray;
      readonly width: number;
      readonly height: number;

      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    });
    previousLanguage = useI18n.getState().lang;
    useI18n.getState().setLang('ja');
    useEditorStore.setState({ canvas: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    useI18n.getState().setLang(previousLanguage);
    mocks.serviceStart.mockReset();
    mocks.fabricImageToImageData.mockClear();
  });

  it('cancels a pending debounced trace before a Worker job starts', () => {
    render(
      <TraceDialog
        sourceImage={{} as fabric.Image}
        onClose={vi.fn()}
      />,
    );

    expect(mocks.fabricImageToImageData).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '処理をキャンセル' }));
    expect(screen.getByRole('alert')).toHaveTextContent('ベクター化をキャンセルしました。');

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(mocks.serviceStart).not.toHaveBeenCalled();
  });

  it('renders polygon holes with the same even-odd fill used for insertion', async () => {
    const result = Promise.resolve({
      version: 1 as const,
      sourceWidth: 100,
      sourceHeight: 100,
      shapes: [{
        kind: 'polygon' as const,
        points: [
          { x: 10, y: 10 },
          { x: 90, y: 10 },
          { x: 90, y: 90 },
          { x: 10, y: 90 },
        ],
        holes: [[
          { x: 35, y: 35 },
          { x: 65, y: 35 },
          { x: 65, y: 65 },
          { x: 35, y: 65 },
        ]],
        closed: true as const,
      }],
      stats: {
        componentCount: 1,
        vertexCount: 8,
        droppedCount: 0,
      },
    });
    mocks.serviceStart.mockReturnValue({
      jobId: 1,
      result,
      cancel: vi.fn(),
    });

    render(
      <TraceDialog
        sourceImage={{} as fabric.Image}
        onClose={vi.fn()}
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(300);
      await result;
    });

    const preview = screen.getByRole('img', { name: 'プレビュー' });
    const path = preview.querySelector('path');
    expect(path).toHaveAttribute('fill-rule', 'evenodd');
    expect(path?.getAttribute('d')?.match(/\bM\b/g)).toHaveLength(2);
  });
});
