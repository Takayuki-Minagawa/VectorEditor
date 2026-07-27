import { act, fireEvent, render, screen } from '@testing-library/react';
import type * as fabric from 'fabric';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_TRACE_COORDINATE_SNAP,
  type TracedDrawing,
} from '../domain/trace/tracedDrawing';
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
const originalInsertTracedDrawing = useEditorStore.getState().insertTracedDrawing;
const originalShowToast = useEditorStore.getState().showToast;

function polygonDrawing(): TracedDrawing {
  return {
    version: 1,
    sourceWidth: 100,
    sourceHeight: 100,
    shapes: [{
      kind: 'polygon',
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
      closed: true,
    }],
    stats: {
      componentCount: 1,
      vertexCount: 8,
      droppedCount: 0,
    },
  };
}

function primitiveDrawing(): TracedDrawing {
  return {
    version: 1,
    sourceWidth: 100,
    sourceHeight: 100,
    shapes: [
      {
        kind: 'rect',
        x: 10,
        y: 10,
        width: 30,
        height: 20,
        angle: 0,
        strokeWidth: 4,
      },
      { kind: 'circle', cx: 60, cy: 20, r: 10 },
      {
        kind: 'ellipse',
        cx: 80,
        cy: 70,
        rx: 12,
        ry: 8,
        angle: 0,
        strokeWidth: 6,
      },
    ],
    stats: {
      componentCount: 3,
      vertexCount: 12,
      droppedCount: 0,
    },
  };
}

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
    localStorage.clear();
    useEditorStore.setState({
      canvas: null,
      insertTracedDrawing: originalInsertTracedDrawing,
      showToast: originalShowToast,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    useI18n.getState().setLang(previousLanguage);
    mocks.serviceStart.mockReset();
    mocks.fabricImageToImageData.mockClear();
    localStorage.clear();
    useEditorStore.setState({
      canvas: null,
      insertTracedDrawing: originalInsertTracedDrawing,
      showToast: originalShowToast,
    });
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
    const result = Promise.resolve(polygonDrawing());
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

  it('previews measured primitive widths and the legacy 2px default', async () => {
    const result = Promise.resolve(primitiveDrawing());
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
    expect(preview.querySelector('rect')).toHaveAttribute('stroke-width', '4');
    expect(preview.querySelector('circle')).toHaveAttribute('stroke-width', '2');
    expect(preview.querySelector('ellipse')).toHaveAttribute('stroke-width', '6');
  });

  it('uses the current line color for both preview and insertion', async () => {
    localStorage.setItem('vectoreditor-current-style-v2-line', JSON.stringify({
      fill: '',
      stroke: '#C85A17',
    }));
    const drawing = polygonDrawing();
    const result = Promise.resolve(drawing);
    mocks.serviceStart.mockReturnValue({
      jobId: 1,
      result,
      cancel: vi.fn(),
    });
    const insertTracedDrawing = vi.fn(() => [{} as fabric.FabricObject]);
    useEditorStore.setState({
      canvas: {} as fabric.Canvas,
      insertTracedDrawing,
      showToast: vi.fn(),
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

    expect(screen.getByRole('img', { name: 'プレビュー' }).parentElement)
      .toHaveStyle({ color: '#C85A17' });
    fireEvent.click(screen.getByRole('button', { name: 'キャンバスに挿入' }));
    expect(insertTracedDrawing).toHaveBeenCalledWith(drawing, {
      group: false,
      color: '#C85A17',
    });
  });

  it('exposes cleanup snap strengths and sends their values to the Worker', () => {
    const neverSettles = new Promise<TracedDrawing>(() => {});
    mocks.serviceStart.mockImplementation(() => ({
      jobId: mocks.serviceStart.mock.calls.length,
      result: neverSettles,
      cancel: vi.fn(),
    }));

    render(
      <TraceDialog
        sourceImage={{} as fabric.Image}
        onClose={vi.fn()}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(300);
    });

    fireEvent.change(screen.getByLabelText('変換モード'), {
      target: { value: 'cleanup' },
    });
    fireEvent.change(screen.getByLabelText(/角度スナップ/), {
      target: { value: '4.5' },
    });
    const coordinateSnap = screen.getByLabelText(/座標スナップ/);
    expect(coordinateSnap).toHaveAttribute(
      'max',
      String(MAX_TRACE_COORDINATE_SNAP),
    );
    fireEvent.change(coordinateSnap, {
      target: { value: '1.5' },
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    const latestOptions = mocks.serviceStart.mock.calls.at(-1)?.[1];
    expect(latestOptions).toMatchObject({
      mode: 'cleanup',
      angleSnapDeg: 4.5,
      coordinateSnap: 1.5,
    });
  });
});
