import { useCallback, useEffect, useRef } from 'react';
import * as fabric from 'fabric';
import type { ToolType } from '../types';
import type { SemanticAnchor } from '../utils/fabricObjectMetadata';

export type DrawingSession =
  | { kind: 'idle'; preview: null }
  | {
    kind: 'dragging';
    tool: ToolType;
    start: { x: number; y: number };
    startAnchor?: SemanticAnchor;
    preview: fabric.FabricObject | null;
  }
  | {
    kind: 'polyline';
    tool: 'polygon' | 'polyline';
    points: { x: number; y: number }[];
    anchors: SemanticAnchor[];
    preview: fabric.FabricObject | null;
  }
  | {
    kind: 'measuring';
    start: { x: number; y: number };
    preview: fabric.FabricObject | null;
  }
  | {
    kind: 'stretching';
    start: { x: number; y: number };
    preview: fabric.FabricObject | null;
  }
  | {
    kind: 'placingLatex';
    point: { x: number; y: number };
    preview: null;
  };

const IDLE_SESSION: DrawingSession = { kind: 'idle', preview: null };

export function useDrawingSession(canvas: fabric.Canvas | null) {
  const sessionRef = useRef<DrawingSession>(IDLE_SESSION);
  const canvasRef = useRef<fabric.Canvas | null>(null);

  useEffect(() => {
    canvasRef.current = canvas;
    return () => {
      if (canvasRef.current === canvas) canvasRef.current = null;
    };
  }, [canvas]);

  const requestRender = useCallback(() => {
    canvasRef.current?.requestRenderAll();
  }, []);

  const replaceSession = useCallback((next: DrawingSession) => {
    sessionRef.current = next;
    requestRender();
  }, [requestRender]);

  const startDragging = useCallback((
    tool: ToolType,
    start: { x: number; y: number },
    startAnchor?: SemanticAnchor,
  ) => {
    replaceSession({ kind: 'dragging', tool, start, startAnchor, preview: null });
    if (canvasRef.current) canvasRef.current.selection = false;
  }, [replaceSession]);

  const startPolyline = useCallback((
    tool: 'polygon' | 'polyline',
    point: { x: number; y: number },
    anchor: SemanticAnchor,
  ) => {
    const current = sessionRef.current;
    if (current.kind === 'polyline' && current.tool === tool) {
      current.points.push(point);
      current.anchors.push(anchor);
      requestRender();
      return;
    }
    replaceSession({
      kind: 'polyline',
      tool,
      points: [point],
      anchors: [anchor],
      preview: null,
    });
    if (canvasRef.current) canvasRef.current.selection = false;
  }, [replaceSession, requestRender]);

  const startMeasuring = useCallback((start: { x: number; y: number }) => {
    replaceSession({ kind: 'measuring', start, preview: null });
    if (canvasRef.current) canvasRef.current.selection = false;
  }, [replaceSession]);

  const startStretching = useCallback((start: { x: number; y: number }) => {
    replaceSession({ kind: 'stretching', start, preview: null });
    if (canvasRef.current) canvasRef.current.selection = false;
  }, [replaceSession]);

  const startLatexPlacement = useCallback((point: { x: number; y: number }) => {
    replaceSession({ kind: 'placingLatex', point, preview: null });
  }, [replaceSession]);

  const setPreview = useCallback((preview: fabric.FabricObject | null) => {
    const current = sessionRef.current;
    if (current.kind === 'idle' || current.kind === 'placingLatex') return;
    current.preview = preview;
    requestRender();
  }, [requestRender]);

  const finishSession = useCallback((): DrawingSession => {
    const finished = sessionRef.current;
    sessionRef.current = IDLE_SESSION;
    if (canvasRef.current) canvasRef.current.selection = true;
    requestRender();
    return finished;
  }, [requestRender]);

  const cancelSession = useCallback((): boolean => {
    const hadSession = sessionRef.current.kind !== 'idle';
    sessionRef.current = IDLE_SESSION;
    const activeCanvas = canvasRef.current;
    if (activeCanvas) {
      activeCanvas.selection = true;
      activeCanvas.requestRenderAll();
    }
    return hadSession;
  }, []);

  const renderPreview = useCallback((ctx: CanvasRenderingContext2D) => {
    const preview = sessionRef.current.preview;
    const activeCanvas = canvasRef.current;
    if (!preview || !activeCanvas) return;
    const viewport = activeCanvas.viewportTransform;
    ctx.save();
    if (viewport) ctx.transform(...viewport);
    preview.render(ctx);
    ctx.restore();
  }, []);

  useEffect(() => () => {
    sessionRef.current = IDLE_SESSION;
    if (canvasRef.current) canvasRef.current.selection = true;
  }, []);

  return {
    sessionRef,
    startDragging,
    startPolyline,
    startMeasuring,
    startStretching,
    startLatexPlacement,
    setPreview,
    finishSession,
    cancelSession,
    renderPreview,
  };
}
