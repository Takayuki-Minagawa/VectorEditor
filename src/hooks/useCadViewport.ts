import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../store/useEditorStore';

const MIN_GRID_SPACING_PX = 10;
const MAX_GRID_LINES = 500;
const MIN_CAD_ZOOM = 0.001;
const MAX_CAD_ZOOM = 100;

function setCanvasBackground(canvas: fabric.Canvas, backgroundColor: string): void {
  canvas.backgroundColor = backgroundColor;
}

export interface CanvasViewportSnapshot {
  zoom: number;
  panX: number;
  panY: number;
  width: number;
  height: number;
  revision: number;
}

interface UseCadViewportProps {
  canvas: fabric.Canvas | null;
  wrapperRef: RefObject<HTMLDivElement | null>;
  drawingMode: 'illustration' | 'cad';
  zoom: number;
  canvasWidth: number;
  canvasHeight: number;
  backgroundColor: string;
  cadWidth: number;
  cadHeight: number;
  gridVisible: boolean;
  gridSize: number;
}

function niceMultiplier(minimum: number): number {
  if (minimum <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(minimum));
  const normalized = minimum / power;
  if (normalized <= 1) return power;
  if (normalized <= 2) return 2 * power;
  if (normalized <= 5) return 5 * power;
  return 10 * power;
}

export function getAdaptiveGridStep(
  gridSize: number,
  zoom: number,
  viewportWidth: number,
  viewportHeight: number,
): number {
  if (gridSize <= 0 || zoom <= 0) return 0;
  const minimumForPixels = MIN_GRID_SPACING_PX / zoom;
  const visibleSceneSpan = (viewportWidth + viewportHeight) / zoom;
  const minimumForLineLimit = visibleSceneSpan / MAX_GRID_LINES;
  const minimumStep = Math.max(gridSize, minimumForPixels, minimumForLineLimit);
  return gridSize * niceMultiplier(minimumStep / gridSize);
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable
    || target.closest('[contenteditable="true"]') !== null
    || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function isCanvasTextEditing(canvas: fabric.Canvas): boolean {
  const active = canvas.getActiveObject();
  return active instanceof fabric.IText && active.isEditing;
}

export function useCadViewport({
  canvas,
  wrapperRef,
  drawingMode,
  zoom,
  canvasWidth,
  canvasHeight,
  backgroundColor,
  cadWidth,
  cadHeight,
  gridVisible,
  gridSize,
}: UseCadViewportProps) {
  const isPanning = useRef(false);
  const lastPanPoint = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const spacePressed = useRef(false);
  const zoomFromWheel = useRef(false);
  const cadInitDone = useRef(false);
  const viewportFrame = useRef<number | null>(null);
  // The snapshot settings can be identical across an object-only restore, so
  // width/height props alone cannot trigger layout repair. Tracking the queue
  // boundary guarantees a final mode-aware viewport application after
  // loadFromJSON settles.
  const isRestoring = useEditorStore((state) => state.isRestoring);
  const [viewport, setViewport] = useState<CanvasViewportSnapshot>({
    zoom,
    panX: 0,
    panY: 0,
    width: canvasWidth * zoom,
    height: canvasHeight * zoom,
    revision: 0,
  });

  const publishViewport = useCallback(() => {
    if (viewportFrame.current !== null) return;
    viewportFrame.current = window.requestAnimationFrame(() => {
      viewportFrame.current = null;
      if (!canvas) return;
      const transform = canvas.viewportTransform;
      setViewport((previous) => ({
        zoom: canvas.getZoom(),
        panX: transform?.[4] ?? 0,
        panY: transform?.[5] ?? 0,
        width: canvas.width ?? 0,
        height: canvas.height ?? 0,
        revision: previous.revision + 1,
      }));
    });
  }, [canvas]);

  useEffect(() => () => {
    if (viewportFrame.current !== null) window.cancelAnimationFrame(viewportFrame.current);
  }, []);

  useEffect(() => {
    const activeCanvas = canvas;
    if (!activeCanvas) return;

    if (drawingMode === 'cad') {
      const wrapper = wrapperRef.current;
      if (wrapper) {
        const rect = wrapper.getBoundingClientRect();
        const width = rect.width || 800;
        const height = rect.height || 600;
        // CAD uses the visible wrapper as its viewport. Reapply it on every
        // relevant state/restore transition because Fabric JSON restoration
        // may otherwise leave document-sized backing canvases behind.
        activeCanvas.setDimensions({ width, height });
        setCanvasBackground(activeCanvas, '#f5f5f5');

        if (!cadInitDone.current) {
          cadInitDone.current = true;
          const fitZoom = Math.min(width / cadWidth, height / cadHeight) * 0.9;
          const panX = (width - cadWidth * fitZoom) / 2;
          const panY = (height - cadHeight * fitZoom) / 2;
          activeCanvas.setViewportTransform([fitZoom, 0, 0, fitZoom, panX, panY]);

          zoomFromWheel.current = true;
          useEditorStore.setState({ zoom: fitZoom });
        } else if (!zoomFromWheel.current) {
          const center = new fabric.Point(width / 2, height / 2);
          activeCanvas.zoomToPoint(center, zoom);
        }
      }
      zoomFromWheel.current = false;
    } else {
      if (cadInitDone.current) {
        cadInitDone.current = false;
        activeCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
      }
      setCanvasBackground(activeCanvas, backgroundColor);
      activeCanvas.setZoom(zoom);
      activeCanvas.setDimensions({
        width: canvasWidth * zoom,
        height: canvasHeight * zoom,
      });
    }
    activeCanvas.requestRenderAll();
    publishViewport();
  }, [
    canvas,
    wrapperRef,
    zoom,
    canvasWidth,
    canvasHeight,
    backgroundColor,
    drawingMode,
    cadWidth,
    cadHeight,
    isRestoring,
    publishViewport,
  ]);

  useEffect(() => {
    if (drawingMode !== 'cad') return;
    const activeCanvas = canvas;
    const wrapper = wrapperRef.current;
    if (!activeCanvas || !wrapper) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        activeCanvas.setDimensions({ width, height });
        activeCanvas.requestRenderAll();
        publishViewport();
      }
    });

    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [canvas, wrapperRef, drawingMode, publishViewport]);

  useEffect(() => {
    if (drawingMode !== 'cad') return;
    const activeCanvas = canvas;
    if (!activeCanvas) return;

    const handleWheel = (opt: fabric.TPointerEventInfo<WheelEvent>) => {
      const event = opt.e;
      event.preventDefault();
      event.stopPropagation();

      const zoomFactor = Math.exp(-event.deltaY / 300);
      const nextZoom = Math.max(
        MIN_CAD_ZOOM,
        Math.min(MAX_CAD_ZOOM, activeCanvas.getZoom() * zoomFactor),
      );

      // zoomToPoint expects a viewport point.  Passing a scene point causes
      // the cursor focus to drift as soon as the viewport has been panned.
      const viewportPoint = activeCanvas.getViewportPoint(event);
      activeCanvas.zoomToPoint(viewportPoint, nextZoom);

      zoomFromWheel.current = true;
      useEditorStore.setState({ zoom: nextZoom });
      activeCanvas.requestRenderAll();
      publishViewport();
    };

    return activeCanvas.on('mouse:wheel', handleWheel);
  }, [canvas, drawingMode, publishViewport]);

  useEffect(() => {
    if (drawingMode !== 'cad') {
      spacePressed.current = false;
      return;
    }
    const activeCanvas = canvas;
    if (!activeCanvas) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (useEditorStore.getState().isRestoring) return;
      if (
        event.code !== 'Space'
        || event.repeat
        || document.querySelector('[role="dialog"][aria-modal="true"]')
        || isEditableKeyboardTarget(event.target)
        || isCanvasTextEditing(activeCanvas)
      ) return;
      event.preventDefault();
      spacePressed.current = true;
      activeCanvas.defaultCursor = 'grab';
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      spacePressed.current = false;
      const tool = useEditorStore.getState().activeTool;
      activeCanvas.defaultCursor = tool === 'select' ? 'default' : 'crosshair';
    };
    const handleBlur = () => {
      spacePressed.current = false;
      isPanning.current = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      spacePressed.current = false;
      isPanning.current = false;
    };
  }, [canvas, drawingMode]);

  useEffect(() => {
    const activeCanvas = canvas;
    if (!activeCanvas) return;
    if (drawingMode !== 'cad') {
      activeCanvas.requestRenderAll();
      return;
    }

    const handler = () => {
      const ctx = activeCanvas.getContext();
      const transform = activeCanvas.viewportTransform;
      if (!transform) return;

      const activeZoom = activeCanvas.getZoom();
      const panX = transform[4];
      const panY = transform[5];
      const width = activeCanvas.width ?? 0;
      const height = activeCanvas.height ?? 0;

      ctx.save();
      ctx.strokeStyle = '#bbb';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(panX, panY, cadWidth * activeZoom, cadHeight * activeZoom);
      ctx.setLineDash([]);
      ctx.restore();

      if (gridVisible && gridSize > 0) {
        const left = -panX / activeZoom;
        const top = -panY / activeZoom;
        const right = left + width / activeZoom;
        const bottom = top + height / activeZoom;
        const step = getAdaptiveGridStep(gridSize, activeZoom, width, height);
        if (step <= 0) return;
        const startX = Math.floor(left / step) * step;
        const startY = Math.floor(top / step) * step;

        ctx.save();
        ctx.strokeStyle = 'rgba(200,200,200,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = startX; x <= right + step / 2; x += step) {
          const screenX = x * activeZoom + panX;
          ctx.moveTo(screenX, 0);
          ctx.lineTo(screenX, height);
        }
        for (let y = startY; y <= bottom + step / 2; y += step) {
          const screenY = y * activeZoom + panY;
          ctx.moveTo(0, screenY);
          ctx.lineTo(width, screenY);
        }
        ctx.stroke();
        ctx.restore();
      }
    };

    const dispose = activeCanvas.on('after:render', handler);
    activeCanvas.requestRenderAll();
    return () => {
      dispose();
      activeCanvas.requestRenderAll();
    };
  }, [canvas, drawingMode, gridVisible, gridSize, cadWidth, cadHeight]);

  return {
    isPanning,
    lastPanPoint,
    spacePressed,
    viewport,
    notifyViewportChange: publishViewport,
  };
}
