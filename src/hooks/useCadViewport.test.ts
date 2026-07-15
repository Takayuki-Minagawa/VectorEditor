import { act, renderHook } from '@testing-library/react';
import type * as fabric from 'fabric';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../store/useEditorStore';
import { getAdaptiveGridStep, isEditableKeyboardTarget } from './useCadViewport';
import { useCadViewport } from './useCadViewport';

function createCanvasDouble(width = 800, height = 600, zoom = 1) {
  const state = { width, height, zoom };
  const setDimensions = vi.fn((dimensions: { width: number; height: number }) => {
    state.width = dimensions.width;
    state.height = dimensions.height;
    canvasDouble.width = dimensions.width;
    canvasDouble.height = dimensions.height;
  });
  const canvasDouble = {
    width,
    height,
    backgroundColor: '#fff',
    viewportTransform: [1, 0, 0, 1, 0, 0],
    setDimensions,
    setZoom: vi.fn((nextZoom: number) => { state.zoom = nextZoom; }),
    getZoom: vi.fn(() => state.zoom),
    setViewportTransform: vi.fn((transform: number[]) => {
      canvasDouble.viewportTransform = transform;
      state.zoom = transform[0];
    }),
    zoomToPoint: vi.fn((_point: fabric.Point, nextZoom: number) => { state.zoom = nextZoom; }),
    requestRenderAll: vi.fn(),
    on: vi.fn(() => vi.fn()),
    getActiveObject: vi.fn(() => null),
    getContext: vi.fn(),
  };
  return {
    canvas: canvasDouble as unknown as fabric.Canvas,
    canvasDouble,
    setDimensions,
  };
}

function createWrapperRef(width: number, height: number) {
  const wrapper = document.createElement('div');
  wrapper.getBoundingClientRect = () => ({
    width,
    height,
    x: 0,
    y: 0,
    top: 0,
    right: width,
    bottom: height,
    left: 0,
    toJSON: () => undefined,
  });
  return { current: wrapper };
}

afterEach(() => {
  useEditorStore.setState({ isRestoring: false, zoom: 1 });
});

describe('CAD viewport helpers', () => {
  it('thins the grid at small zoom while keeping the base grid multiple', () => {
    const step = getAdaptiveGridStep(20, 0.001, 1200, 800);
    expect(step % 20).toBe(0);
    expect(step * 0.001).toBeGreaterThanOrEqual(10);
    expect((1200 + 800) / 0.001 / step).toBeLessThanOrEqual(500);
  });

  it('does not reserve Space while editing form or contenteditable controls', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    editable.appendChild(child);

    expect(isEditableKeyboardTarget(input)).toBe(true);
    expect(isEditableKeyboardTarget(textarea)).toBe(true);
    expect(isEditableKeyboardTarget(child)).toBe(true);
    expect(isEditableKeyboardTarget(document.body)).toBe(false);
  });

  it('reapplies zoom-scaled illustration dimensions after a history restore', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    useEditorStore.setState({ isRestoring: false });
    const { canvas, canvasDouble, setDimensions } = createCanvasDouble();
    const { unmount } = renderHook(() => useCadViewport({
      canvas,
      wrapperRef: createWrapperRef(1200, 700),
      drawingMode: 'illustration',
      zoom: 2,
      canvasWidth: 800,
      canvasHeight: 600,
      backgroundColor: '#abcdef',
      cadWidth: 10_000,
      cadHeight: 8_000,
      gridVisible: false,
      gridSize: 20,
    }));

    expect(setDimensions).toHaveBeenLastCalledWith({ width: 1600, height: 1200 });
    expect(canvasDouble.backgroundColor).toBe('#abcdef');

    // Simulate a restore implementation touching the live canvas after the
    // queue started. The final queue transition must repair it even when the
    // snapshot width/height values themselves did not change.
    act(() => useEditorStore.setState({ isRestoring: true }));
    canvasDouble.width = 800;
    canvasDouble.height = 600;
    setDimensions.mockClear();
    act(() => useEditorStore.setState({ isRestoring: false }));
    expect(setDimensions).toHaveBeenLastCalledWith({ width: 1600, height: 1200 });

    unmount();
  });

  it('reapplies the CAD wrapper dimensions after a history restore', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    useEditorStore.setState({ isRestoring: false });
    const { canvas, canvasDouble, setDimensions } = createCanvasDouble();
    const wrapperRef = createWrapperRef(1200, 700);
    const { unmount } = renderHook(() => useCadViewport({
      canvas,
      wrapperRef,
      drawingMode: 'cad',
      zoom: 0.1,
      canvasWidth: 800,
      canvasHeight: 600,
      backgroundColor: '#ffffff',
      cadWidth: 10_000,
      cadHeight: 8_000,
      gridVisible: false,
      gridSize: 20,
    }));

    expect(setDimensions).toHaveBeenLastCalledWith({ width: 1200, height: 700 });
    act(() => useEditorStore.setState({ isRestoring: true }));
    canvasDouble.width = 800;
    canvasDouble.height = 600;
    setDimensions.mockClear();
    act(() => useEditorStore.setState({ isRestoring: false }));
    expect(setDimensions).toHaveBeenLastCalledWith({ width: 1200, height: 700 });

    unmount();
  });
});
