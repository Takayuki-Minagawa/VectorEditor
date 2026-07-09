import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../store/useEditorStore';

interface UseCadViewportProps {
  fabricRef: RefObject<fabric.Canvas | null>;
  wrapperRef: RefObject<HTMLDivElement | null>;
  drawingMode: 'illustration' | 'cad';
  zoom: number;
  canvasWidth: number;
  canvasHeight: number;
  cadWidth: number;
  cadHeight: number;
  backgroundColor: string;
  gridVisible: boolean;
  gridSize: number;
}

export function useCadViewport({
  fabricRef,
  wrapperRef,
  drawingMode,
  zoom,
  canvasWidth,
  canvasHeight,
  cadWidth,
  cadHeight,
  backgroundColor,
  gridVisible,
  gridSize,
}: UseCadViewportProps) {
  const isPanning = useRef(false);
  const lastPanPoint = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const spacePressed = useRef(false);
  const zoomFromWheel = useRef(false);
  const cadInitDone = useRef(false);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    if (drawingMode === 'cad') {
      if (!cadInitDone.current) {
        cadInitDone.current = true;
        const wrapper = wrapperRef.current;
        if (wrapper) {
          const rect = wrapper.getBoundingClientRect();
          const w = rect.width || 800;
          const h = rect.height || 600;
          canvas.setDimensions({ width: w, height: h });
          canvas.backgroundColor = '#f5f5f5';

          const fitZoom = Math.min(w / cadWidth, h / cadHeight) * 0.9;
          const panX = (w - cadWidth * fitZoom) / 2;
          const panY = (h - cadHeight * fitZoom) / 2;
          canvas.setViewportTransform([fitZoom, 0, 0, fitZoom, panX, panY]);

          zoomFromWheel.current = true;
          useEditorStore.setState({ zoom: fitZoom });
        }
      } else if (!zoomFromWheel.current) {
        const center = new fabric.Point(canvas.width! / 2, canvas.height! / 2);
        canvas.zoomToPoint(center, zoom);
      }
      zoomFromWheel.current = false;
    } else {
      if (cadInitDone.current) {
        cadInitDone.current = false;
        canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        canvas.backgroundColor = backgroundColor;
      }
      canvas.setZoom(zoom);
      canvas.setDimensions({
        width: canvasWidth * zoom,
        height: canvasHeight * zoom,
      });
    }
    canvas.requestRenderAll();
  }, [fabricRef, wrapperRef, zoom, canvasWidth, canvasHeight, drawingMode, cadWidth, cadHeight, backgroundColor]);

  useEffect(() => {
    if (drawingMode !== 'cad') return;
    const canvas = fabricRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        canvas.setDimensions({ width, height });
        canvas.requestRenderAll();
      }
    });

    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [fabricRef, wrapperRef, drawingMode]);

  useEffect(() => {
    if (drawingMode !== 'cad') return;
    const canvas = fabricRef.current;
    if (!canvas) return;

    const handleWheel = (opt: fabric.TPointerEventInfo<WheelEvent>) => {
      const e = opt.e;
      e.preventDefault();
      e.stopPropagation();

      const delta = e.deltaY;
      let newZoom = canvas.getZoom() * (1 - delta / 300);
      newZoom = Math.max(0.001, Math.min(100, newZoom));

      const point = canvas.getScenePoint(e);
      canvas.zoomToPoint(new fabric.Point(point.x, point.y), newZoom);

      zoomFromWheel.current = true;
      useEditorStore.setState({ zoom: newZoom });
      canvas.requestRenderAll();
    };

    return canvas.on('mouse:wheel', handleWheel);
  }, [fabricRef, drawingMode]);

  useEffect(() => {
    if (drawingMode !== 'cad') {
      spacePressed.current = false;
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        spacePressed.current = true;
        const canvas = fabricRef.current;
        if (canvas) canvas.defaultCursor = 'grab';
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spacePressed.current = false;
        const canvas = fabricRef.current;
        const tool = useEditorStore.getState().activeTool;
        if (canvas) canvas.defaultCursor = tool === 'select' ? 'default' : 'crosshair';
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      spacePressed.current = false;
    };
  }, [fabricRef, drawingMode]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    if (drawingMode !== 'cad') {
      canvas.requestRenderAll();
      return;
    }

    const handler = () => {
      const ctx = canvas.getContext();
      const vpt = canvas.viewportTransform;
      if (!vpt) return;

      const z = canvas.getZoom();
      const panX = vpt[4];
      const panY = vpt[5];
      const w = canvas.width || 0;
      const h = canvas.height || 0;

      const dx0 = panX;
      const dy0 = panY;
      const dw = cadWidth * z;
      const dh = cadHeight * z;
      ctx.save();
      ctx.strokeStyle = '#bbb';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(dx0, dy0, dw, dh);
      ctx.setLineDash([]);
      ctx.restore();

      if (gridVisible && gridSize > 0) {
        const left = -panX / z;
        const top = -panY / z;
        const right = left + w / z;
        const bottom = top + h / z;

        const step = gridSize;
        const startX = Math.floor(left / step) * step;
        const startY = Math.floor(top / step) * step;

        ctx.save();
        ctx.strokeStyle = 'rgba(200,200,200,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();

        for (let x = startX; x <= right; x += step) {
          const sx = x * z + panX;
          ctx.moveTo(sx, 0);
          ctx.lineTo(sx, h);
        }
        for (let y = startY; y <= bottom; y += step) {
          const sy = y * z + panY;
          ctx.moveTo(0, sy);
          ctx.lineTo(w, sy);
        }

        ctx.stroke();
        ctx.restore();
      }
    };

    const dispose = canvas.on('after:render', handler);
    canvas.requestRenderAll();
    return () => {
      dispose();
      canvas.requestRenderAll();
    };
  }, [fabricRef, drawingMode, gridVisible, gridSize, cadWidth, cadHeight]);

  return { isPanning, lastPanPoint, spacePressed };
}
