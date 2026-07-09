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
import { disposeAll } from '../utils/disposers';
import { applyOrtho, ORTHO_TOOLS, snapVal } from '../utils/drawingGeometry';
import { applyObjectDefaults as applyDefaults, createShapeOnDrag } from '../utils/shapeFactory';
import { useCadViewport } from '../hooks/useCadViewport';
import LatexDialog from './LatexDialog';
import Ruler, { RulerCorner } from './Rulers';
import StretchDialog from './StretchDialog';
import MeasurePopup from './MeasurePopup';
import type { MeasureResult } from './MeasurePopup';
import IllustrationGrid from './IllustrationGrid';

export default function Canvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const isDrawing = useRef(false);
  const drawStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const currentShape = useRef<fabric.FabricObject | null>(null);
  const polygonPoints = useRef<{ x: number; y: number }[]>([]);
  const polygonLines = useRef<fabric.Line[]>([]);
  const lastCursor = useRef<{ x: number; y: number } | null>(null);

  const {
    setCanvas,
    canvas: storeCanvas,
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
  const showRulers = useEditorStore((s) => s.showRulers);
  const t = useI18n((s) => s.t);

  // Smart guide lines to render (set during object:moving)
  const smartGuideLines = useRef<{ orientation: 'h' | 'v'; position: number }[]>([]);
  const [measureResult, setMeasureResult] = useState<MeasureResult | null>(null);
  const measureShape = useRef<fabric.Rect | null>(null);
  const [latexPlacement, setLatexPlacement] = useState<{ x: number; y: number } | null>(null);
  // Wrapper element exposed as state so rulers receive it without reading a ref during render
  const [wrapperEl, setWrapperEl] = useState<HTMLDivElement | null>(null);
  const setWrapperRef = useCallback((el: HTMLDivElement | null) => {
    wrapperRef.current = el;
    setWrapperEl(el);
  }, []);

  // Stretch tool state
  const stretchPreview = useRef<fabric.Rect | null>(null);
  const [stretchBox, setStretchBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [stretchDx, setStretchDx] = useState(0);
  const [stretchDy, setStretchDy] = useState(0);

  const { isPanning, lastPanPoint, spacePressed } = useCadViewport({
    canvas: storeCanvas,
    wrapperRef,
    drawingMode,
    zoom,
    canvasWidth,
    canvasHeight,
    cadWidth,
    cadHeight,
    gridVisible,
    gridSize,
  });

  const snap = useCallback(
    (v: number) => (snapToGrid ? snapVal(v, gridSize) : v),
    [snapToGrid, gridSize],
  );

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

  const getDimensionLabel = useCallback((distance: number) => {
    const { drawingMode: dm, cadUnit: cu } = useEditorStore.getState();
    return dm === 'cad'
      ? `${formatReal(mmToUnit(distance, cu), cu)} ${cu}`
      : Math.round(distance).toString();
  }, []);

  const createDraggedShape = useCallback(
    (tool: ToolType, startX: number, startY: number, endX: number, endY: number) =>
      createShapeOnDrag(tool, startX, startY, endX, endY, getDimensionLabel),
    [getDimensionLabel],
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

    const clearSelection = () => setSelectedObjectIds([]);

    // Push history on object modification
    const handleObjectModified = () => pushHistory();

    // Freehand pencil: assign id and record history when a stroke is finished
    const handlePathCreated = (opt: { path?: fabric.FabricObject }) => {
      const path = opt.path as fabric.FabricObject | undefined;
      if (!path) return;
      path.set({ id: generateObjectId('pencil') } as Partial<fabric.FabricObject>);
      pushHistory();
    };

    // Alt+drag to duplicate
    let altClone: fabric.FabricObject | null = null;
    const handleAltCloneMoving = (opt: fabric.BasicTransformEvent & { target: fabric.FabricObject }) => {
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
    };
    const handleAltCloneMouseUp = () => {
      if (altClone) {
        altClone.set({ opacity: altClone.opacity === 0.5 ? 1 : altClone.opacity });
        altClone = null;
        canvas.requestRenderAll();
        pushHistory();
      }
    };

    // Shift: constrain rotation to 15-degree steps
    const handleObjectRotating = (opt: fabric.BasicTransformEvent & { target: fabric.FabricObject }) => {
      if (opt.e.shiftKey && opt.target) {
        const angle = opt.target.angle || 0;
        opt.target.set({ angle: Math.round(angle / 15) * 15 });
      }
    };

    return disposeAll([
      canvas.on('selection:created', updateSelection),
      canvas.on('selection:updated', updateSelection),
      canvas.on('selection:cleared', clearSelection),
      canvas.on('object:modified', handleObjectModified),
      canvas.on('path:created', handlePathCreated),
      canvas.on('object:moving', handleAltCloneMoving),
      canvas.on('mouse:up', handleAltCloneMouseUp),
      canvas.on('object:rotating', handleObjectRotating),
    ]);
  }, [setSelectedObjectIds, pushHistory]);

  // Grid snap on object moving
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const handleMoving = (opt: fabric.BasicTransformEvent & { target: fabric.FabricObject }) => {
      if (!snapToGrid || !opt.target) return;
      const obj = opt.target as fabric.FabricObject;
      obj.set({
        left: snapVal(obj.left || 0, gridSize),
        top: snapVal(obj.top || 0, gridSize),
      });
      obj.setCoords();
    };

    return canvas.on('object:moving', handleMoving);
  }, [snapToGrid, gridSize]);

  // Smart guides: snap to other objects' edges/centers + guide lines
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const SNAP_THRESHOLD = 5;

    const handleMoving = (opt: fabric.BasicTransformEvent & { target: fabric.FabricObject }) => {
      const target = opt.target as fabric.FabricObject | undefined;
      if (!target) return;

      const { snapToObjects: doObj, snapToGuides: doGuide, guides: guideList } = useEditorStore.getState();
      if (!doObj && !doGuide) {
        smartGuideLines.current = [];
        return;
      }

      const bound = target.getBoundingRect();
      const tLeft = bound.left;
      const tRight = bound.left + bound.width;
      const tCenterX = bound.left + bound.width / 2;
      const tTop = bound.top;
      const tBottom = bound.top + bound.height;
      const tCenterY = bound.top + bound.height / 2;

      const newGuides: { orientation: 'h' | 'v'; position: number }[] = [];
      let snapDx = 0;
      let snapDy = 0;
      let snappedX = false;
      let snappedY = false;

      // Snap to other objects
      if (doObj) {
        const objects = canvas.getObjects();
        for (const obj of objects) {
          if (obj === target || (target as fabric.ActiveSelection)?.getObjects?.()?.includes(obj)) continue;

          const ob = obj.getBoundingRect();
          const oLeft = ob.left;
          const oRight = ob.left + ob.width;
          const oCenterX = ob.left + ob.width / 2;
          const oTop = ob.top;
          const oBottom = ob.top + ob.height;
          const oCenterY = ob.top + ob.height / 2;

          // Vertical snap lines (X-axis alignment)
          if (!snappedX) {
            const xPairs: [number, number][] = [
              [tLeft, oLeft], [tLeft, oRight], [tLeft, oCenterX],
              [tRight, oLeft], [tRight, oRight], [tRight, oCenterX],
              [tCenterX, oCenterX], [tCenterX, oLeft], [tCenterX, oRight],
            ];
            for (const [tVal, oVal] of xPairs) {
              if (Math.abs(tVal - oVal) < SNAP_THRESHOLD) {
                snapDx = oVal - tVal;
                newGuides.push({ orientation: 'v', position: oVal });
                snappedX = true;
                break;
              }
            }
          }

          // Horizontal snap lines (Y-axis alignment)
          if (!snappedY) {
            const yPairs: [number, number][] = [
              [tTop, oTop], [tTop, oBottom], [tTop, oCenterY],
              [tBottom, oTop], [tBottom, oBottom], [tBottom, oCenterY],
              [tCenterY, oCenterY], [tCenterY, oTop], [tCenterY, oBottom],
            ];
            for (const [tVal, oVal] of yPairs) {
              if (Math.abs(tVal - oVal) < SNAP_THRESHOLD) {
                snapDy = oVal - tVal;
                newGuides.push({ orientation: 'h', position: oVal });
                snappedY = true;
                break;
              }
            }
          }

          if (snappedX && snappedY) break;
        }
      }

      // Snap to guide lines
      if (doGuide && guideList.length > 0) {
        for (const g of guideList) {
          if (g.orientation === 'v' && !snappedX) {
            const xEdges = [tLeft, tRight, tCenterX];
            for (const edge of xEdges) {
              if (Math.abs(edge - g.position) < SNAP_THRESHOLD) {
                snapDx = g.position - edge;
                snappedX = true;
                break;
              }
            }
          }
          if (g.orientation === 'h' && !snappedY) {
            const yEdges = [tTop, tBottom, tCenterY];
            for (const edge of yEdges) {
              if (Math.abs(edge - g.position) < SNAP_THRESHOLD) {
                snapDy = g.position - edge;
                snappedY = true;
                break;
              }
            }
          }
        }
      }

      // Apply snap offset
      if (snapDx !== 0 || snapDy !== 0) {
        target.set({
          left: (target.left || 0) + snapDx,
          top: (target.top || 0) + snapDy,
        });
        target.setCoords();
      }

      smartGuideLines.current = newGuides;
      canvas.requestRenderAll();
    };

    const handleMoveEnd = () => {
      if (smartGuideLines.current.length > 0) {
        smartGuideLines.current = [];
        canvas.requestRenderAll();
      }
    };

    return disposeAll([
      canvas.on('object:moving', handleMoving),
      canvas.on('object:modified', handleMoveEnd),
      canvas.on('selection:cleared', handleMoveEnd),
    ]);
  }, []);

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

      // Pencil uses Fabric's built-in free-drawing; nothing to do on mouse down
      if (activeTool === 'select' || activeTool === 'pencil') return;
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

      // Track live cursor position for the status bar (all tools).
      // Only push to the store when the rounded position changes, to avoid
      // re-rendering the status bar on every sub-pixel mouse move.
      const cursorPoint = canvas.getScenePoint(opt.e);
      const rx = Math.round(cursorPoint.x);
      const ry = Math.round(cursorPoint.y);
      if (!lastCursor.current || lastCursor.current.x !== rx || lastCursor.current.y !== ry) {
        lastCursor.current = { x: rx, y: ry };
        useEditorStore.getState().setCursorPos({ x: cursorPoint.x, y: cursorPoint.y });
      }

      if (!isDrawing.current || activeTool === 'select') return;
      const rawPointer = canvas.getScenePoint(opt.e);
      let pointer = { x: snap(rawPointer.x), y: snap(rawPointer.y) };

      // Ortho / angle constraint for linear tools (toggle or hold Shift)
      const orthoMove = useEditorStore.getState().orthoMode || (opt.e as MouseEvent).shiftKey;
      if (orthoMove && ORTHO_TOOLS.includes(activeTool)) {
        const c = applyOrtho(drawStart.current.x, drawStart.current.y, pointer.x, pointer.y);
        pointer = { x: c.x, y: c.y };
      }

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

      const shape = createDraggedShape(
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
      let pointer = { x: snap(rawPointer.x), y: snap(rawPointer.y) };

      // Ortho / angle constraint for linear tools (toggle or hold Shift)
      const orthoUp = useEditorStore.getState().orthoMode || (opt.e as MouseEvent).shiftKey;
      if (orthoUp && ORTHO_TOOLS.includes(activeTool)) {
        const c = applyOrtho(drawStart.current.x, drawStart.current.y, pointer.x, pointer.y);
        pointer = { x: c.x, y: c.y };
      }

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

      const shape = createDraggedShape(
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

    const handleMouseOut = () => {
      lastCursor.current = null;
      useEditorStore.getState().setCursorPos(null);
    };

    return disposeAll([
      canvas.on('mouse:down', handleMouseDown),
      canvas.on('mouse:move', handleMouseMove),
      canvas.on('mouse:up', handleMouseUp),
      canvas.on('mouse:dblclick', handleDblClick),
      canvas.on('mouse:out', handleMouseOut),
    ]);
  }, [activeTool, createDraggedShape, finishDrawing, setActiveTool, t, snap, gridSize, isPanning, lastPanPoint, spacePressed]);

  // Render smart guide lines and stored guide lines via after:render
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const handler = () => {
      const ctx = canvas.getContext();
      const vpt = canvas.viewportTransform;
      const isCad = useEditorStore.getState().drawingMode === 'cad';
      const z = isCad ? canvas.getZoom() : 1;
      const panX = isCad && vpt ? vpt[4] : 0;
      const panY = isCad && vpt ? vpt[5] : 0;
      const w = canvas.width || 0;
      const h = canvas.height || 0;

      // Draw stored guide lines
      const guideList = useEditorStore.getState().guides;
      if (guideList.length > 0) {
        ctx.save();
        ctx.strokeStyle = '#00bcd4';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        for (const g of guideList) {
          ctx.beginPath();
          if (g.orientation === 'h') {
            const sy = g.position * z + panY;
            ctx.moveTo(0, sy);
            ctx.lineTo(w, sy);
          } else {
            const sx = g.position * z + panX;
            ctx.moveTo(sx, 0);
            ctx.lineTo(sx, h);
          }
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Draw smart guide lines (temporary, during move)
      const lines = smartGuideLines.current;
      if (lines.length > 0) {
        ctx.save();
        ctx.strokeStyle = '#ff4081';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        for (const line of lines) {
          ctx.beginPath();
          if (line.orientation === 'h') {
            const sy = line.position * z + panY;
            ctx.moveTo(0, sy);
            ctx.lineTo(w, sy);
          } else {
            const sx = line.position * z + panX;
            ctx.moveTo(sx, 0);
            ctx.lineTo(sx, h);
          }
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.restore();
      }
    };

    return canvas.on('after:render', handler);
  }, []);

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
    [latexPlacement, finishDrawing],
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

  const isCadMode = drawingMode === 'cad';

  return (
    <div className={`canvas-wrapper ${isCadMode ? 'cad-mode' : ''}`} ref={setWrapperRef}>
      {showRulers && (
        <>
          <RulerCorner />
          <Ruler orientation="h" canvasEl={wrapperEl} />
          <Ruler orientation="v" canvasEl={wrapperEl} />
        </>
      )}
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
        <IllustrationGrid
          visible={gridVisible && !isCadMode}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          zoom={zoom}
          gridSize={gridSize}
        />
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
        <MeasurePopup result={measureResult} onClose={() => setMeasureResult(null)} />
      )}
    </div>
  );
}
