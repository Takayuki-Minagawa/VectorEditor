import { useEffect, useRef, useCallback, useState } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import type { ToolType } from '../types';

interface MeasureResult {
  x: number;
  y: number;
  width: number;
  height: number;
}

let objectCounter = 0;
function generateId(type: string): string {
  return `${type}_${++objectCounter}_${Date.now()}`;
}

export default function Canvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const isDrawing = useRef(false);
  const drawStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const currentShape = useRef<fabric.FabricObject | null>(null);
  const polygonPoints = useRef<{ x: number; y: number }[]>([]);
  const polygonLines = useRef<fabric.Line[]>([]);

  const {
    setCanvas,
    canvasWidth,
    canvasHeight,
    backgroundColor,
    zoom,
    gridVisible,
    pushHistory,
    setSelectedObjectIds,
  } = useEditorStore();

  const activeTool = useEditorStore((s) => s.activeTool);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const t = useI18n((s) => s.t);
  const [measureResult, setMeasureResult] = useState<MeasureResult | null>(null);
  const [measureCopied, setMeasureCopied] = useState(false);
  const measureShape = useRef<fabric.Rect | null>(null);

  const applyDefaults = useCallback((obj: fabric.FabricObject, id: string) => {
    obj.set({
      id,
      strokeUniform: true,
      cornerColor: '#2196F3',
      cornerStyle: 'circle',
      cornerSize: 8,
      transparentCorners: false,
      borderColor: '#2196F3',
      borderScaleFactor: 1.5,
      padding: 4,
    } as Partial<fabric.FabricObject>);
  }, []);

  const finishDrawing = useCallback(
    (obj: fabric.FabricObject) => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      obj.setCoords();
      canvas.setActiveObject(obj);
      canvas.requestRenderAll();
      setActiveTool('select');
      pushHistory();
    },
    [setActiveTool, pushHistory],
  );

  const createShapeOnDrag = useCallback(
    (tool: ToolType, startX: number, startY: number, endX: number, endY: number): fabric.FabricObject | null => {
      const left = Math.min(startX, endX);
      const top = Math.min(startY, endY);
      const width = Math.abs(endX - startX);
      const height = Math.abs(endY - startY);
      if (width < 2 && height < 2) return null;

      const common = {
        left,
        top,
        fill: '#D9EAF7',
        stroke: '#1F4E79',
        strokeWidth: 2,
        opacity: 1,
      };

      let obj: fabric.FabricObject;
      const id = generateId(tool);

      switch (tool) {
        case 'rect':
          obj = new fabric.Rect({ ...common, width, height });
          break;
        case 'roundedRect':
          obj = new fabric.Rect({ ...common, width, height, rx: 10, ry: 10 });
          break;
        case 'circle': {
          const radius = Math.max(width, height) / 2;
          obj = new fabric.Circle({
            ...common,
            radius,
            left: startX < endX ? startX : startX - radius * 2,
            top: startY < endY ? startY : startY - radius * 2,
          });
          break;
        }
        case 'ellipse':
          obj = new fabric.Ellipse({
            ...common,
            rx: width / 2,
            ry: height / 2,
          });
          break;
        case 'triangle':
          obj = new fabric.Triangle({ ...common, width, height });
          break;
        case 'diamond':
          obj = new fabric.Polygon(
            [
              { x: width / 2, y: 0 },
              { x: width, y: height / 2 },
              { x: width / 2, y: height },
              { x: 0, y: height / 2 },
            ],
            { ...common, left, top },
          );
          break;
        case 'line':
          obj = new fabric.Line([startX, startY, endX, endY], {
            stroke: '#1F4E79',
            strokeWidth: 2,
            fill: '',
          });
          break;
        case 'arrow': {
          const angle = Math.atan2(endY - startY, endX - startX);
          const headLen = 14;
          const line = new fabric.Line([startX, startY, endX, endY], {
            stroke: '#1F4E79',
            strokeWidth: 2,
            fill: '',
          });
          const headPoints = [
            { x: endX, y: endY },
            {
              x: endX - headLen * Math.cos(angle - Math.PI / 6),
              y: endY - headLen * Math.sin(angle - Math.PI / 6),
            },
            {
              x: endX - headLen * Math.cos(angle + Math.PI / 6),
              y: endY - headLen * Math.sin(angle + Math.PI / 6),
            },
          ];
          const head = new fabric.Polygon(headPoints, {
            fill: '#1F4E79',
            stroke: '#1F4E79',
            strokeWidth: 1,
          });
          obj = new fabric.Group([line, head]);
          break;
        }
        default:
          return null;
      }

      applyDefaults(obj, id);
      return obj;
    },
    [applyDefaults],
  );

  // Initialize canvas
  useEffect(() => {
    if (!canvasRef.current || fabricRef.current) return;

    const canvas = new fabric.Canvas(canvasRef.current, {
      width: canvasWidth,
      height: canvasHeight,
      backgroundColor,
      selection: true,
      preserveObjectStacking: true,
      controlsAboveOverlay: true,
    });

    // Customize default controls for rotation handle
    fabric.FabricObject.prototype.set({
      cornerColor: '#2196F3',
      cornerStyle: 'circle',
      cornerSize: 8,
      transparentCorners: false,
      borderColor: '#2196F3',
      borderScaleFactor: 1.5,
      padding: 4,
    });

    fabricRef.current = canvas;
    setCanvas(canvas);

    // Initial history
    setTimeout(() => {
      useEditorStore.getState().pushHistory();
    }, 100);

    return () => {
      canvas.dispose();
      fabricRef.current = null;
      setCanvas(null);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Selection events
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const updateSelection = () => {
      const active = canvas.getActiveObjects();
      const ids = active.map((o) => (o as fabric.FabricObject & { id?: string }).id || '').filter(Boolean);
      setSelectedObjectIds(ids);
    };

    canvas.on('selection:created', updateSelection);
    canvas.on('selection:updated', updateSelection);
    canvas.on('selection:cleared', () => setSelectedObjectIds([]));

    // Push history on object modification
    canvas.on('object:modified', () => pushHistory());

    // Alt+drag to duplicate
    let altClone: fabric.FabricObject | null = null;
    canvas.on('object:moving', (opt) => {
      if (opt.e.altKey && !altClone) {
        const original = opt.target;
        if (!original) return;
        original.clone().then((cloned: fabric.FabricObject) => {
          cloned.set({ left: original.left, top: original.top, opacity: 0.5 });
          canvas.add(cloned);
          altClone = cloned;
        });
      }
    });
    canvas.on('mouse:up', () => {
      if (altClone) {
        altClone.set({ opacity: altClone.opacity === 0.5 ? 1 : altClone.opacity });
        altClone = null;
        canvas.requestRenderAll();
        pushHistory();
      }
    });

    // Shift: constrain rotation to 15-degree steps
    canvas.on('object:rotating', (opt) => {
      if (opt.e.shiftKey && opt.target) {
        const angle = opt.target.angle || 0;
        opt.target.set({ angle: Math.round(angle / 15) * 15 });
      }
    });

    return () => {
      canvas.off('selection:created', updateSelection);
      canvas.off('selection:updated', updateSelection);
      canvas.off('selection:cleared');
      canvas.off('object:modified');
      canvas.off('object:moving');
      canvas.off('object:rotating');
      canvas.off('mouse:up');
    };
  }, [setSelectedObjectIds, pushHistory]);

  // Drawing logic
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const handleMouseDown = (opt: fabric.TPointerEventInfo) => {
      if (activeTool === 'select') return;
      const pointer = canvas.getScenePoint(opt.e);

      // Measure tool: start drawing a temporary rectangle
      if (activeTool === 'measure') {
        isDrawing.current = true;
        drawStart.current = { x: pointer.x, y: pointer.y };
        canvas.selection = false;
        return;
      }

      // Polygon/Polyline tool: accumulate points
      if (activeTool === 'polygon' || activeTool === 'polyline') {
        polygonPoints.current.push({ x: pointer.x, y: pointer.y });
        if (polygonPoints.current.length > 1) {
          const pts = polygonPoints.current;
          const line = new fabric.Line(
            [pts[pts.length - 2].x, pts[pts.length - 2].y, pts[pts.length - 1].x, pts[pts.length - 1].y],
            { stroke: '#999', strokeWidth: 1, selectable: false, evented: false },
          );
          canvas.add(line);
          polygonLines.current.push(line);
          canvas.requestRenderAll();
        }
        return;
      }

      // Text tool: place text on click
      if (activeTool === 'text') {
        const id = generateId('text');
        const textbox = new fabric.Textbox(t('defaultText'), {
          left: pointer.x,
          top: pointer.y,
          width: 200,
          fontSize: 24,
          fontFamily: 'sans-serif',
          fill: '#333333',
          editable: true,
        });
        applyDefaults(textbox, id);
        canvas.add(textbox);
        finishDrawing(textbox);
        return;
      }

      // Standard shape drawing
      isDrawing.current = true;
      drawStart.current = { x: pointer.x, y: pointer.y };
      canvas.selection = false;
    };

    const handleMouseMove = (opt: fabric.TPointerEventInfo) => {
      if (!isDrawing.current || activeTool === 'select') return;
      const pointer = canvas.getScenePoint(opt.e);

      // Measure tool preview
      if (activeTool === 'measure') {
        if (measureShape.current) {
          canvas.remove(measureShape.current);
        }
        const left = Math.min(drawStart.current.x, pointer.x);
        const top = Math.min(drawStart.current.y, pointer.y);
        const w = Math.abs(pointer.x - drawStart.current.x);
        const h = Math.abs(pointer.y - drawStart.current.y);
        const rect = new fabric.Rect({
          left, top, width: w, height: h,
          fill: 'rgba(66,133,244,0.15)',
          stroke: '#4285f4',
          strokeWidth: 1,
          strokeDashArray: [4, 4],
          selectable: false,
          evented: false,
        });
        canvas.add(rect);
        measureShape.current = rect;
        canvas.requestRenderAll();
        return;
      }

      // Remove previous preview
      if (currentShape.current) {
        canvas.remove(currentShape.current);
      }

      const shape = createShapeOnDrag(
        activeTool,
        drawStart.current.x,
        drawStart.current.y,
        pointer.x,
        pointer.y,
      );

      if (shape) {
        shape.selectable = false;
        shape.evented = false;
        canvas.add(shape);
        currentShape.current = shape;
        canvas.requestRenderAll();
      }
    };

    const handleMouseUp = (opt: fabric.TPointerEventInfo) => {
      if (!isDrawing.current || activeTool === 'select') return;
      isDrawing.current = false;
      const pointer = canvas.getScenePoint(opt.e);

      // Measure tool: calculate LaTeX coordinates and show popup
      if (activeTool === 'measure') {
        if (measureShape.current) {
          canvas.remove(measureShape.current);
          measureShape.current = null;
        }
        const left = Math.min(drawStart.current.x, pointer.x);
        const top = Math.min(drawStart.current.y, pointer.y);
        const w = Math.abs(pointer.x - drawStart.current.x);
        const h = Math.abs(pointer.y - drawStart.current.y);
        if (w >= 2 || h >= 2) {
          const ch = useEditorStore.getState().canvasHeight;
          // LaTeX: origin bottom-left, y upward
          const latexX = Math.round(left);
          const latexY = Math.round(ch - (top + h));
          setMeasureResult({ x: latexX, y: latexY, width: Math.round(w), height: Math.round(h) });
          setMeasureCopied(false);
        }
        canvas.selection = true;
        canvas.requestRenderAll();
        setActiveTool('select');
        return;
      }

      // Remove preview
      if (currentShape.current) {
        canvas.remove(currentShape.current);
        currentShape.current = null;
      }

      const shape = createShapeOnDrag(
        activeTool,
        drawStart.current.x,
        drawStart.current.y,
        pointer.x,
        pointer.y,
      );

      if (shape) {
        canvas.add(shape);
        finishDrawing(shape);
      }

      canvas.selection = true;
    };

    const handleDblClick = () => {
      // Finish polygon/polyline on double-click
      if (
        (activeTool === 'polygon' || activeTool === 'polyline') &&
        polygonPoints.current.length >= 2
      ) {
        // Remove preview lines
        polygonLines.current.forEach((l) => canvas.remove(l));
        polygonLines.current = [];

        const points = [...polygonPoints.current];
        polygonPoints.current = [];

        const id = generateId(activeTool);
        let obj: fabric.FabricObject;

        if (activeTool === 'polygon') {
          obj = new fabric.Polygon(points, {
            fill: '#D9EAF7',
            stroke: '#1F4E79',
            strokeWidth: 2,
          });
        } else {
          obj = new fabric.Polyline(points, {
            fill: '',
            stroke: '#1F4E79',
            strokeWidth: 2,
          });
        }

        applyDefaults(obj, id);
        canvas.add(obj);
        finishDrawing(obj);
      }
    };

    canvas.on('mouse:down', handleMouseDown);
    canvas.on('mouse:move', handleMouseMove);
    canvas.on('mouse:up', handleMouseUp);
    canvas.on('mouse:dblclick', handleDblClick);

    return () => {
      canvas.off('mouse:down', handleMouseDown);
      canvas.off('mouse:move', handleMouseMove);
      canvas.off('mouse:up', handleMouseUp);
      canvas.off('mouse:dblclick', handleDblClick);
    };
  }, [activeTool, applyDefaults, createShapeOnDrag, finishDrawing, setActiveTool, pushHistory, t]);

  // Zoom handling
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.setZoom(zoom);
    canvas.setDimensions({
      width: canvasWidth * zoom,
      height: canvasHeight * zoom,
    });
    canvas.requestRenderAll();
  }, [zoom, canvasWidth, canvasHeight]);

  // Draw grid overlay
  const renderGrid = () => {
    if (!gridVisible) return null;
    const step = 20;
    const lines: React.ReactElement[] = [];
    for (let x = 0; x <= canvasWidth; x += step) {
      lines.push(
        <line
          key={`v${x}`}
          x1={x * zoom}
          y1={0}
          x2={x * zoom}
          y2={canvasHeight * zoom}
          stroke="#ddd"
          strokeWidth={0.5}
        />,
      );
    }
    for (let y = 0; y <= canvasHeight; y += step) {
      lines.push(
        <line
          key={`h${y}`}
          x1={0}
          y1={y * zoom}
          x2={canvasWidth * zoom}
          y2={y * zoom}
          stroke="#ddd"
          strokeWidth={0.5}
        />,
      );
    }
    return (
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: canvasWidth * zoom,
          height: canvasHeight * zoom,
          pointerEvents: 'none',
        }}
      >
        {lines}
      </svg>
    );
  };

  const handleCopyMeasure = () => {
    if (!measureResult) return;
    const text = `x=${measureResult.x}, y=${measureResult.y}, width=${measureResult.width}, height=${measureResult.height}`;
    navigator.clipboard.writeText(text).then(() => {
      setMeasureCopied(true);
      setTimeout(() => setMeasureCopied(false), 1500);
    });
  };

  return (
    <div className="canvas-wrapper" ref={wrapperRef}>
      <div
        className="canvas-container"
        style={{
          width: canvasWidth * zoom,
          height: canvasHeight * zoom,
          position: 'relative',
        }}
      >
        <canvas ref={canvasRef} />
        {renderGrid()}
      </div>

      {measureResult && (
        <div className="modal-overlay" onClick={() => setMeasureResult(null)}>
          <div className="measure-popup" onClick={(e) => e.stopPropagation()}>
            <div className="measure-popup-title">{t('measureResult')}</div>
            <div className="measure-popup-body">
              <div className="measure-row"><span className="measure-label">{t('measureX')}</span><span className="measure-val">{measureResult.x} px</span></div>
              <div className="measure-row"><span className="measure-label">{t('measureY')}</span><span className="measure-val">{measureResult.y} px</span></div>
              <div className="measure-row"><span className="measure-label">{t('measureWidth')}</span><span className="measure-val">{measureResult.width} px</span></div>
              <div className="measure-row"><span className="measure-label">{t('measureHeight')}</span><span className="measure-val">{measureResult.height} px</span></div>
            </div>
            <div className="measure-popup-actions">
              <button className="toolbar-btn" onClick={handleCopyMeasure}>
                {measureCopied ? t('measureCopied') : t('measureCopy')}
              </button>
              <button className="toolbar-btn" onClick={() => setMeasureResult(null)}>
                {t('measureClose')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
