import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as fabric from 'fabric';
import { useDrawingSession } from './useDrawingSession';

describe('DrawingSession', () => {
  it('keeps a single preview outside the document object list and cleans up', () => {
    const add = vi.fn();
    const requestRenderAll = vi.fn();
    const canvas = {
      selection: true,
      viewportTransform: [1, 0, 0, 1, 0, 0],
      add,
      requestRenderAll,
    } as unknown as fabric.Canvas;
    const { result } = renderHook(() => useDrawingSession(canvas));

    act(() => {
      result.current.startDragging('rect', { x: 10, y: 20 });
      result.current.setPreview(new fabric.Rect({ width: 30, height: 40 }));
    });
    expect(result.current.sessionRef.current.kind).toBe('dragging');
    expect(canvas.selection).toBe(false);
    expect(add).not.toHaveBeenCalled();

    act(() => {
      result.current.cancelSession();
    });
    expect(result.current.sessionRef.current.kind).toBe('idle');
    expect(canvas.selection).toBe(true);
  });

  it('models polygon point accumulation as one cancellable session', () => {
    const canvas = {
      selection: true,
      requestRenderAll: vi.fn(),
    } as unknown as fabric.Canvas;
    const { result } = renderHook(() => useDrawingSession(canvas));

    act(() => {
      result.current.startPolyline('polygon', { x: 0, y: 0 }, { x: 0, y: 0 });
      result.current.startPolyline('polygon', { x: 10, y: 0 }, { x: 10, y: 0 });
    });
    const session = result.current.sessionRef.current;
    expect(session.kind).toBe('polyline');
    if (session.kind === 'polyline') expect(session.points).toHaveLength(2);

    act(() => {
      result.current.finishSession();
    });
    expect(result.current.sessionRef.current.kind).toBe('idle');
  });
});
