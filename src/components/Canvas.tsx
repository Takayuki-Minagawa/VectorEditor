import { useEffect, useRef, useCallback, useState } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import { mmToUnit, unitToMm, formatReal } from '../types';
import type { ToolType } from '../types';
import {
  ensureObjectId,
  generateObjectId,
  reassignObjectIdsRecursive,
} from '../utils/objectIds';
import LatexDialog from './LatexDialog';

interface MeasureResult {
  x: number;
  y: number;
  width: number;
  height: number;
}

function snapVal(v: number, gridSize: number): number {
  return Math.round(v / gridSize) * gridSize;
}

function StretchDialog({
  stretchDx, stretchDy, setStretchDx, setStretchDy, onApply, onCancel,
}: {
  stretchDx: number; stretchDy: number;
  setStretchDx: (v: number) => void; setStretchDy: (v: number) => void;
  onApply: () => void; onCancel: () => void;
}) {
  const drawingMode = useEditorStore((s) => s.drawingMode);
  const cadUnit = useEditorStore((s) => s.cadUnit);
  const t = useI18n((s) => s.t);
  const isCad = drawingMode === 'cad';
  const unit = isCad ? cadUnit : 'px';
  const step = isCad ? (cadUnit === 'mm' ? 1 : cadUnit === 'cm' ? 0.1 : 0.001) : 1;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content nm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t('stretchTitle')}</span>
          <button className="modal-close" onClick={onCancel}>&times;</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>{t('stretchDesc')}</p>
          <div className="nm-row">
            <label>{t('stretchOffsetX')} ({unit})</label>
            <input type="number" value={stretchDx} onChange={(e) => setStretchDx(Number(e.target.value))} step={step} autoFocus />
          </div>
          <div className="nm-row">
            <label>{t('stretchOffsetY')} ({unit})</label>
            <input type="number" value={stretchDy} onChange={(e) => setStretchDy(Number(e.target.value))} step={step} />
          </div>
        </div>
        <div className="nm-actions">
          <button className="toolbar-btn nm-btn" onClick={onApply}>{t('stretchApply')}</button>
          <button className="toolbar-btn nm-btn nm-cancel" onClick={onCancel}>{t('cancel')}</button>
        </div>
      </div>
    </div>
  );
}

function MeasureBody({ result }: { result: MeasureResult }) {
  const drawingMode = useEditorStore((s) => s.drawingMode);
  const cadUnit = useEditorStore((s) => s.cadUnit);
  const t = useI18n((s) => s.t);
  const isCad = drawingMode === 'cad';

  const fmt = (val: number) =>
    isCad
      ? `${formatReal(mmToUnit(val, cadUnit), cadUnit)} ${cadUnit}`
      : `${val} px`;

  return (
    <div className="measure-popup-body">
      <div className="measure-row"><span className="measure-label">{t('measureX')}</span><span className="measure-val">{fmt(result.x)}</span></div>
      <div className="measure-row"><span className="measure-label">{t('measureY')}</span><span className="measure-val">{fmt(result.y)}</span></div>
      <div className="measure-row"><span className="measure-label">{t('measureWidth')}</span><span className="measure-val">{fmt(result.width)}</span></div>
      <div className="measure-row"><span className="measure-label">{t('measureHeight')}</span><span className="measure-val">{fmt(result.height)}</span></div>
    </div>
  );
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

  // CAD viewport refs
  const isPanning = useRef(false);
  const lastPanPoint = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const spacePressed = useRef(false);
  const zoomFromWheel = useRef(false);
  const cadInitDone = useRef(false);

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
  const gridSize = useEditorStore((s) => s.gridSize);
  const snapToGrid = useEditorStore((s) => s.snapToGrid);
  const drawingMode = useEditorStore((s) => s.drawingMode);
  const cadWidth = useEditorStore((s) => s.cadWidth);
  const cadHeight = useEditorStore((s) => s.cadHeight);
  const t = useI18n((s) => s.t);
  const [measureResult, setMeasureResult] = useState<MeasureResult | null>(null);
  const [measureCopied, setMeasureCopied] = useState(false);
  const measureShape = useRef<fabric.Rect | null>(null);
  const [latexPlacement, setLatexPlacement] = useState<{ x: number; y: number } | null>(null);

  // Stretch tool state
  const stretchPreview = useRef<fabric.Rect | null>(null);
  const [stretchBox, setStretchBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [stretchDx, setStretchDx] = useState(0);
  const [stretchDy, setStretchDy] = useState(0);

  const snap = useCallback(
    (v: number) => (snapToGrid ? snapVal(v, gridSize) : v),
    [snapToGrid, gridSize],
  );

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
      const id = generateObjectId(tool);

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
        case 'wall':
          obj = new fabric.Rect({
            left,
            top,
            width: Math.max(width, 4),
            height: Math.max(height, 4),
            fill: '#555555',
            stroke: '#333333',
            strokeWidth: 1,
            opacity: 1,
          });
          break;
        case 'dimension': {
          const dx = endX - startX;
          const dy = endY - startY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 5) return null;

          const mainLine = new fabric.Line([startX, startY, endX, endY], {
            stroke: '#333333',
            strokeWidth: 1,
            fill: '',
          });

          // Tick marks perpendicular to the line
          const ang = Math.atan2(dy, dx);
          const perpAng = ang + Math.PI / 2;
          const tickLen = 6;
          const tick1 = new fabric.Line([
            startX + tickLen * Math.cos(perpAng),
            startY + tickLen * Math.sin(perpAng),
            startX - tickLen * Math.cos(perpAng),
            startY - tickLen * Math.sin(perpAng),
          ], { stroke: '#333333', strokeWidth: 1, fill: '' });

          const tick2 = new fabric.Line([
            endX + tickLen * Math.cos(perpAng),
            endY + tickLen * Math.sin(perpAng),
            endX - tickLen * Math.cos(perpAng),
            endY - tickLen * Math.sin(perpAng),
          ], { stroke: '#333333', strokeWidth: 1, fill: '' });

          // Label
          const midX = (startX + endX) / 2;
          const midY = (startY + endY) / 2;
          const { drawingMode: dm, cadUnit: cu } = useEditorStore.getState();
          const labelText = dm === 'cad'
            ? `${formatReal(mmToUnit(dist, cu), cu)} ${cu}`
            : Math.round(dist).toString();
          const label = new fabric.Text(labelText, {
            left: midX,
            top: midY - 14,
            fontSize: 12,
            fontFamily: 'sans-serif',
            fill: '#333333',
            originX: 'center',
            originY: 'bottom',
          });

          obj = new fabric.Group([mainLine, tick1, tick2, label]);
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
      const ids = active.map((obj) => ensureObjectId(obj));
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
          reassignObjectIdsRecursive(cloned);
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

  // Grid snap on object moving
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleMoving = (opt: any) => {
      if (!snapToGrid || !opt.target) return;
      const obj = opt.target as fabric.FabricObject;
      obj.set({
        left: snapVal(obj.left || 0, gridSize),
        top: snapVal(obj.top || 0, gridSize),
      });
      obj.setCoords();
    };

    canvas.on('object:moving', handleMoving);
    return () => {
      canvas.off('object:moving', handleMoving);
    };
  }, [snapToGrid, gridSize]);

  // Drawing logic
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const handleMouseDown = (opt: fabric.TPointerEventInfo) => {
      // CAD pan: Space+left click or middle mouse button
      const currentMode = useEditorStore.getState().drawingMode;
      if (currentMode === 'cad' && (spacePressed.current || (opt.e as MouseEvent).button === 1)) {
        isPanning.current = true;
        lastPanPoint.current = { x: (opt.e as MouseEvent).clientX, y: (opt.e as MouseEvent).clientY };
        canvas.defaultCursor = 'grabbing';
        return;
      }

      if (activeTool === 'select') return;
      const rawPointer = canvas.getScenePoint(opt.e);
      const pointer = { x: snap(rawPointer.x), y: snap(rawPointer.y) };

      // Measure tool: start drawing a temporary rectangle
      if (activeTool === 'measure') {
        isDrawing.current = true;
        drawStart.current = { x: pointer.x, y: pointer.y };
        canvas.selection = false;
        return;
      }

      // Stretch tool: start drawing crossing window
      if (activeTool === 'stretch') {
        isDrawing.current = true;
        drawStart.current = { x: pointer.x, y: pointer.y };
        canvas.selection = false;
        return;
      }

      // LaTeX tool: click to open dialog
      if (activeTool === 'latex') {
        setLatexPlacement({ x: pointer.x, y: pointer.y });
        return;
      }

      // Column tool: click to place
      if (activeTool === 'column') {
        const sz = gridSize > 0 ? gridSize : 20;
        const id = generateObjectId('column');
        const col = new fabric.Rect({
          left: snap(rawPointer.x) - sz / 2,
          top: snap(rawPointer.y) - sz / 2,
          width: sz,
          height: sz,
          fill: '#333333',
          stroke: '#111111',
          strokeWidth: 1,
        });
        applyDefaults(col, id);
        canvas.add(col);
        finishDrawing(col);
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
        const id = generateObjectId('text');
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
      // CAD panning
      if (isPanning.current) {
        const vpt = canvas.viewportTransform;
        if (vpt) {
          vpt[4] += (opt.e as MouseEvent).clientX - lastPanPoint.current.x;
          vpt[5] += (opt.e as MouseEvent).clientY - lastPanPoint.current.y;
          lastPanPoint.current = { x: (opt.e as MouseEvent).clientX, y: (opt.e as MouseEvent).clientY };
          canvas.setViewportTransform(vpt);
        }
        return;
      }

      if (!isDrawing.current || activeTool === 'select') return;
      const rawPointer = canvas.getScenePoint(opt.e);
      const pointer = { x: snap(rawPointer.x), y: snap(rawPointer.y) };

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

      // Stretch tool preview
      if (activeTool === 'stretch') {
        if (stretchPreview.current) {
          canvas.remove(stretchPreview.current);
        }
        const left = Math.min(drawStart.current.x, pointer.x);
        const top = Math.min(drawStart.current.y, pointer.y);
        const w = Math.abs(pointer.x - drawStart.current.x);
        const h = Math.abs(pointer.y - drawStart.current.y);
        const rect = new fabric.Rect({
          left, top, width: w, height: h,
          fill: 'rgba(255,152,0,0.15)',
          stroke: '#ff9800',
          strokeWidth: 1,
          strokeDashArray: [4, 4],
          selectable: false,
          evented: false,
        });
        canvas.add(rect);
        stretchPreview.current = rect;
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
      // CAD pan end
      if (isPanning.current) {
        isPanning.current = false;
        const tool = useEditorStore.getState().activeTool;
        canvas.defaultCursor = spacePressed.current ? 'grab' : (tool === 'select' ? 'default' : 'crosshair');
        return;
      }

      if (!isDrawing.current || activeTool === 'select') return;
      isDrawing.current = false;
      const rawPointer = canvas.getScenePoint(opt.e);
      const pointer = { x: snap(rawPointer.x), y: snap(rawPointer.y) };

      // Stretch tool: save box and show dialog
      if (activeTool === 'stretch') {
        if (stretchPreview.current) {
          canvas.remove(stretchPreview.current);
          stretchPreview.current = null;
        }
        const left = Math.min(drawStart.current.x, pointer.x);
        const top = Math.min(drawStart.current.y, pointer.y);
        const w = Math.abs(pointer.x - drawStart.current.x);
        const h = Math.abs(pointer.y - drawStart.current.y);
        if (w >= 2 || h >= 2) {
          setStretchBox({ left, top, width: w, height: h });
          setStretchDx(0);
          setStretchDy(0);
        }
        canvas.selection = true;
        canvas.requestRenderAll();
        return;
      }

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
          const {
            drawingMode: mode,
            canvasHeight: currentCanvasHeight,
            cadHeight: currentCadHeight,
          } = useEditorStore.getState();
          const docHeight = mode === 'cad' ? currentCadHeight : currentCanvasHeight;
          // LaTeX: origin bottom-left, y upward
          const latexX = Math.round(left);
          const latexY = Math.round(docHeight - (top + h));
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

        const id = generateObjectId(activeTool);
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
  }, [activeTool, applyDefaults, createShapeOnDrag, finishDrawing, setActiveTool, pushHistory, t, snap, gridSize]);

  // Combined mode switch + zoom handling
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    if (drawingMode === 'cad') {
      if (!cadInitDone.current) {
        // First time in CAD mode: set up viewport
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
        // Zoom from StatusBar — zoom toward canvas center
        const center = new fabric.Point(canvas.width! / 2, canvas.height! / 2);
        canvas.zoomToPoint(center, zoom);
      }
      zoomFromWheel.current = false;
    } else {
      if (cadInitDone.current) {
        // Leaving CAD mode: restore
        cadInitDone.current = false;
        canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        canvas.backgroundColor = useEditorStore.getState().backgroundColor;
      }
      canvas.setZoom(zoom);
      canvas.setDimensions({
        width: canvasWidth * zoom,
        height: canvasHeight * zoom,
      });
    }
    canvas.requestRenderAll();
  }, [zoom, canvasWidth, canvasHeight, drawingMode, cadWidth, cadHeight]);

  // CAD mode: ResizeObserver to keep canvas filling wrapper
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
  }, [drawingMode]);

  // CAD mode: mouse wheel zoom
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

    canvas.on('mouse:wheel', handleWheel);
    return () => { canvas.off('mouse:wheel', handleWheel); };
  }, [drawingMode]);

  // CAD mode: Space key for panning cursor
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
  }, [drawingMode]);

  // CAD mode: render grid and document bounds via after:render
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
      const cw = useEditorStore.getState().cadWidth;
      const ch = useEditorStore.getState().cadHeight;

      // Draw document bounds (dashed border only, no fill to avoid covering objects)
      const dx0 = panX;
      const dy0 = panY;
      const dw = cw * z;
      const dh = ch * z;
      ctx.save();
      ctx.strokeStyle = '#bbb';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(dx0, dy0, dw, dh);
      ctx.setLineDash([]);
      ctx.restore();

      // Draw grid
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

    canvas.on('after:render', handler);
    canvas.requestRenderAll();
    return () => {
      canvas.off('after:render', handler);
      canvas.requestRenderAll();
    };
  }, [drawingMode, gridVisible, gridSize]);

  // Draw grid overlay (illustration mode only)
  const renderGrid = () => {
    if (!gridVisible || drawingMode === 'cad') return null;
    const step = gridSize;
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

  const handleLatexPlace = useCallback(
    (dataUrl: string) => {
      const canvas = fabricRef.current;
      if (!canvas || !latexPlacement) return;

      fabric.Image.fromURL(dataUrl).then((img) => {
        img.set({
          left: latexPlacement.x,
          top: latexPlacement.y,
          scaleX: 1 / 3,
          scaleY: 1 / 3,
        });
        const id = generateObjectId('latex');
        applyDefaults(img, id);
        canvas.add(img);
        finishDrawing(img);
        setLatexPlacement(null);
      });
    },
    [latexPlacement, applyDefaults, finishDrawing],
  );

  const handleLatexCancel = useCallback(() => {
    setLatexPlacement(null);
    setActiveTool('select');
  }, [setActiveTool]);

  const handleStretchApply = () => {
    const canvas = fabricRef.current;
    if (!canvas || !stretchBox) return;

    const { drawingMode: dm, cadUnit: cu } = useEditorStore.getState();
    const isCad = dm === 'cad';

    const dx = isCad ? unitToMm(stretchDx, cu) : stretchDx;
    const dy = isCad ? unitToMm(stretchDy, cu) : stretchDy;

    if (dx === 0 && dy === 0) {
      setStretchBox(null);
      setActiveTool('select');
      return;
    }

    const box = stretchBox;
    const boxRight = box.left + box.width;
    const boxBottom = box.top + box.height;

    const pointIn = (px: number, py: number) =>
      px >= box.left && px <= boxRight && py >= box.top && py <= boxBottom;

    canvas.getObjects().forEach((obj) => {
      const bounds = obj.getBoundingRect();
      const objRight = bounds.left + bounds.width;
      const objBottom = bounds.top + bounds.height;

      const tlIn = pointIn(bounds.left, bounds.top);
      const trIn = pointIn(objRight, bounds.top);
      const blIn = pointIn(bounds.left, objBottom);
      const brIn = pointIn(objRight, objBottom);

      const count = [tlIn, trIn, blIn, brIn].filter(Boolean).length;

      if (count === 0) return;

      if (count === 4) {
        obj.set({ left: (obj.left || 0) + dx, top: (obj.top || 0) + dy });
        obj.setCoords();
        return;
      }

      // Partially inside — stretch logic
      if (obj instanceof fabric.Rect && (obj.angle || 0) === 0) {
        const leftSideIn = tlIn || blIn;
        const rightSideIn = trIn || brIn;
        const topSideIn = tlIn || trIn;
        const bottomSideIn = blIn || brIn;

        // X direction
        if (dx !== 0) {
          if (leftSideIn && rightSideIn) {
            obj.set({ left: (obj.left || 0) + dx });
          } else if (rightSideIn) {
            const dw = (obj.width || 1) * (obj.scaleX || 1);
            const newDw = dw + dx;
            if (newDw > 1) obj.set({ scaleX: newDw / (obj.width || 1) });
          } else if (leftSideIn) {
            const dw = (obj.width || 1) * (obj.scaleX || 1);
            const newDw = dw - dx;
            if (newDw > 1) {
              obj.set({ left: (obj.left || 0) + dx, scaleX: newDw / (obj.width || 1) });
            }
          }
        }

        // Y direction
        if (dy !== 0) {
          if (topSideIn && bottomSideIn) {
            obj.set({ top: (obj.top || 0) + dy });
          } else if (bottomSideIn) {
            const dh = (obj.height || 1) * (obj.scaleY || 1);
            const newDh = dh + dy;
            if (newDh > 1) obj.set({ scaleY: newDh / (obj.height || 1) });
          } else if (topSideIn) {
            const dh = (obj.height || 1) * (obj.scaleY || 1);
            const newDh = dh - dy;
            if (newDh > 1) {
              obj.set({ top: (obj.top || 0) + dy, scaleY: newDh / (obj.height || 1) });
            }
          }
        }

        obj.setCoords();
      } else {
        // For non-Rect objects: move if center is inside the box
        const cx = bounds.left + bounds.width / 2;
        const cy = bounds.top + bounds.height / 2;
        if (pointIn(cx, cy)) {
          obj.set({ left: (obj.left || 0) + dx, top: (obj.top || 0) + dy });
          obj.setCoords();
        }
      }
    });

    canvas.requestRenderAll();
    pushHistory();
    setStretchBox(null);
    setActiveTool('select');
  };

  const handleStretchCancel = () => {
    setStretchBox(null);
    setActiveTool('select');
  };

  const handleCopyMeasure = () => {
    if (!measureResult) return;
    const text = `x=${measureResult.x}, y=${measureResult.y}, width=${measureResult.width}, height=${measureResult.height}`;
    navigator.clipboard.writeText(text).then(() => {
      setMeasureCopied(true);
      setTimeout(() => setMeasureCopied(false), 1500);
    });
  };

  const isCadMode = drawingMode === 'cad';

  return (
    <div className={`canvas-wrapper ${isCadMode ? 'cad-mode' : ''}`} ref={wrapperRef}>
      <div
        className="canvas-container"
        style={isCadMode ? {
          width: '100%',
          height: '100%',
          position: 'relative',
        } : {
          width: canvasWidth * zoom,
          height: canvasHeight * zoom,
          position: 'relative',
        }}
      >
        <canvas ref={canvasRef} />
        {renderGrid()}
      </div>

      {latexPlacement && (
        <LatexDialog
          onPlace={handleLatexPlace}
          onCancel={handleLatexCancel}
        />
      )}

      {stretchBox && (
        <StretchDialog
          stretchDx={stretchDx}
          stretchDy={stretchDy}
          setStretchDx={setStretchDx}
          setStretchDy={setStretchDy}
          onApply={handleStretchApply}
          onCancel={handleStretchCancel}
        />
      )}

      {measureResult && (
        <div className="modal-overlay" onClick={() => setMeasureResult(null)}>
          <div className="measure-popup" onClick={(e) => e.stopPropagation()}>
            <div className="measure-popup-title">{t('measureResult')}</div>
            <MeasureBody result={measureResult} />
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
