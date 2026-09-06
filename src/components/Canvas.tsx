import { useEffect, useRef, useCallback, useState } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import { mmToUnit, unitToMm, formatReal } from '../types';
import type { ToolType } from '../types';
import { TOOL_DEFINITIONS } from '../domain/tools';
import {
  ensureObjectId,
  generateObjectId,
  reassignObjectIdsAndReferences,
} from '../utils/objectIds';
import { releaseActiveSelectionObjects } from '../utils/fabricObjectTree';
import { disposeAll } from '../utils/disposers';
import {
  createAsyncCanvasMutationGuard,
  executeCanvasTransaction,
} from '../utils/canvasCommands';
import {
  attachNodeEditControls,
  convertLineToPolylineWithNode,
  deletePathNode,
  deletePolylineNode,
  detachNodeEditControls,
  findNodeAtScenePoint,
  hasNodeEditControls,
  insertPathNode,
  insertPolylineNode,
  isNodeEditableObject,
  refreshNodeEditControls,
  remapLineAnchorsToPolyline,
  retargetVertexAnchorsAfterDelete,
  shiftVertexAnchorsAfterInsert,
} from '../utils/nodeEditing';
import { applyOrtho, ORTHO_TOOLS, snapVal } from '../utils/drawingGeometry';
import {
  applyObjectDefaults as applyDefaults,
  createShapeOnDrag,
  type ShapeSemanticOptions,
} from '../utils/shapeFactory';
import { useCadViewport } from '../hooks/useCadViewport';
import { useDrawingSession } from '../hooks/useDrawingSession';
import { useRafCursorPosition } from '../hooks/useRafCursorPosition';
import {
  findCadSnap,
  snapCandidateToAnchor,
  type CadSnapCandidate,
} from '../utils/cadSnapping';
import type { SemanticAnchor } from '../utils/fabricObjectMetadata';
import { setFabricMetadataValues } from '../utils/fabricObjectMetadata';
import { updateLinkedSemanticObjects } from '../utils/semanticObjects';
import { applyEditorStyle, loadCurrentEditorStyle } from '../utils/stylePresets';
import { configureCanvasForTool } from '../utils/toolActivation';
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
  const setCanvas = useEditorStore((s) => s.setCanvas);
  const storeCanvas = useEditorStore((s) => s.canvas);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const backgroundColor = useEditorStore((s) => s.backgroundColor);
  const zoom = useEditorStore((s) => s.zoom);
  const gridVisible = useEditorStore((s) => s.gridVisible);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  const setSelectedObjectIds = useEditorStore((s) => s.setSelectedObjectIds);
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
  const osnapMarker = useRef<CadSnapCandidate | null>(null);
  const [measureResult, setMeasureResult] = useState<MeasureResult | null>(null);
  const [latexPlacement, setLatexPlacement] = useState<{ x: number; y: number } | null>(null);
  const latexOperationToken = useRef(0);
  // Wrapper element exposed as state so rulers receive it without reading a ref during render
  const [wrapperEl, setWrapperEl] = useState<HTMLDivElement | null>(null);
  const setWrapperRef = useCallback((el: HTMLDivElement | null) => {
    wrapperRef.current = el;
    setWrapperEl(el);
  }, []);

  // Stretch tool state
  const [stretchBox, setStretchBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const {
    isPanning,
    lastPanPoint,
    spacePressed,
    viewport,
    notifyViewportChange,
  } = useCadViewport({
    canvas: storeCanvas,
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
  });

  const drawingSession = useDrawingSession(storeCanvas);
  const {
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
  } = drawingSession;
  const { scheduleCursorPosition, clearCursorPosition } = useRafCursorPosition();
  const previousTool = useRef(activeTool);

  useEffect(() => useEditorStore.subscribe((state, previous) => {
    if (state.activeTool !== previous.activeTool && state.activeTool !== 'latex') {
      latexOperationToken.current += 1;
      setLatexPlacement(null);
    }
  }), []);

  useEffect(() => {
    if (previousTool.current === activeTool) return;
    cancelSession();
    if (fabricRef.current) fabricRef.current.selection = activeTool === 'select';
    osnapMarker.current = null;
    if (activeTool !== 'latex') {
      latexOperationToken.current += 1;
    }
    previousTool.current = activeTool;
  }, [activeTool, cancelSession]);

  const snap = useCallback(
    (v: number) => (snapToGrid ? snapVal(v, gridSize) : v),
    [snapToGrid, gridSize],
  );

  const resolveDrawingPoint = useCallback((
    canvas: fabric.Canvas,
    rawPoint: { x: number; y: number },
    allowObjectSnap = true,
  ): { point: { x: number; y: number }; anchor: SemanticAnchor } => {
    if (drawingMode === 'cad' && allowObjectSnap) {
      const candidate = findCadSnap(canvas.getObjects(), rawPoint, 10 / canvas.getZoom());
      osnapMarker.current = candidate;
      if (candidate) {
        return { point: candidate.point, anchor: snapCandidateToAnchor(candidate) };
      }
    } else {
      osnapMarker.current = null;
    }

    const point = { x: snap(rawPoint.x), y: snap(rawPoint.y) };
    return { point, anchor: { x: point.x, y: point.y } };
  }, [drawingMode, snap]);

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
    (
      tool: ToolType,
      startX: number,
      startY: number,
      endX: number,
      endY: number,
      semanticOptions?: ShapeSemanticOptions,
    ) => {
      const state = useEditorStore.getState();
      const dimensionUnit = tool === 'dimension' && state.drawingMode === 'cad'
        ? state.cadUnit
        : undefined;
      const dimensionPrecision = dimensionUnit === 'm' ? 3 : dimensionUnit === 'cm' ? 1 : 0;
      return createShapeOnDrag(
        tool,
        startX,
        startY,
        endX,
        endY,
        getDimensionLabel,
        {
          ...semanticOptions,
          dimensionUnit,
          dimensionPrecision: tool === 'dimension' ? dimensionPrecision : undefined,
        },
      );
    },
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
    const historyTimer = window.setTimeout(() => {
      useEditorStore.getState().pushHistory();
    }, 100);

    return () => {
      window.clearTimeout(historyTimer);
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

    // Keep linked dimensions/connectors current before committing history.
    const handleObjectModified = (opt: { target?: fabric.FabricObject }) => {
      const changedId = opt.target
        && !(opt.target instanceof fabric.Group || opt.target instanceof fabric.ActiveSelection)
        ? ensureObjectId(opt.target)
        : undefined;
      updateLinkedSemanticObjects(canvas, getDimensionLabel, changedId);
      pushHistory();
    };

    // Freehand pencil: assign id and record history when a stroke is finished
    const handlePathCreated = (opt: { path?: fabric.FabricObject }) => {
      const path = opt.path as fabric.FabricObject | undefined;
      if (!path) return;
      path.set({ id: generateObjectId('pencil') } as Partial<fabric.FabricObject>);
      setFabricMetadataValues(path, {
        id: (path as fabric.FabricObject & { id: string }).id,
        objectKind: TOOL_DEFINITIONS.pencil.objectKind,
      });
      pushHistory();
    };

    // Alt+drag to duplicate
    let altClonePreviews: Array<{
      object: fabric.FabricObject;
      opacity: number;
    }> = [];
    let cloneRequested = false;
    let cloneGeneration = 0;
    let dragActive = false;
    let altHistoryTransactionActive = false;
    let altCloneCanCommit: (() => boolean) | null = null;

    const beginAltHistoryTransaction = () => {
      if (altHistoryTransactionActive) return;
      useEditorStore.getState().beginHistoryTransaction();
      altHistoryTransactionActive = true;
    };

    const finishAltCloneGesture = () => {
      const hadClone = altClonePreviews.length > 0;
      const canCommit = altCloneCanCommit?.() ?? true;
      if (!canCommit) {
        if (!canvas.destroyed && !canvas.disposed) {
          canvas.remove(...altClonePreviews.map(({ object }) => object));
        }
        altClonePreviews.forEach(({ object }) => object.dispose());
        altClonePreviews = [];
      }
      altClonePreviews.forEach(({ object, opacity }) => {
        object.set({ opacity });
        object.setCoords();
      });
      altClonePreviews = [];
      altCloneCanCommit = null;
      if (hadClone && canCommit && !canvas.destroyed && !canvas.disposed) {
        canvas.requestRenderAll();
        // This marks the open history transaction dirty after preview opacity
        // has been restored, so only the final clone state is committed.
        pushHistory();
      }
      if (altHistoryTransactionActive) {
        useEditorStore.getState().endHistoryTransaction();
        altHistoryTransactionActive = false;
      }
    };

    const handleAltCloneMoving = (opt: fabric.BasicTransformEvent & { target: fabric.FabricObject }) => {
      dragActive = true;
      if (opt.e.altKey && altClonePreviews.length === 0 && !cloneRequested) {
        const original = opt.target;
        if (!original) return;
        beginAltHistoryTransaction();
        cloneRequested = true;
        const generation = cloneGeneration;
        const clonePosition = { left: original.left, top: original.top };
        const canCommit = createAsyncCanvasMutationGuard(canvas);
        altCloneCanCommit = canCommit;
        original.clone().then((cloned: fabric.FabricObject) => {
          if (!dragActive || generation !== cloneGeneration || !canCommit()) {
            cloned.dispose();
            return;
          }
          cloned.set(clonePosition);
          const clones = releaseActiveSelectionObjects(cloned);
          reassignObjectIdsAndReferences(clones);
          altClonePreviews = clones.map((object) => {
            const opacity = object.opacity ?? 1;
            object.set({ opacity: opacity * 0.5 });
            object.setCoords();
            return { object, opacity };
          });
          canvas.add(...clones);
        }).catch(() => {
          // A failed clone must not leave the gesture permanently armed.
        }).finally(() => {
          if (generation === cloneGeneration) cloneRequested = false;
        });
      }
    };
    const handleAltCloneMouseUp = () => {
      dragActive = false;
      cloneGeneration += 1;
      cloneRequested = false;
      finishAltCloneGesture();
    };

    // Shift: constrain rotation to 15-degree steps
    const handleObjectRotating = (opt: fabric.BasicTransformEvent & { target: fabric.FabricObject }) => {
      if (opt.e.shiftKey && opt.target) {
        const angle = opt.target.angle || 0;
        opt.target.set({ angle: Math.round(angle / 15) * 15 });
      }
    };

    const disposeEvents = disposeAll([
      canvas.on('selection:created', updateSelection),
      canvas.on('selection:updated', updateSelection),
      canvas.on('selection:cleared', clearSelection),
      canvas.on('object:modified', handleObjectModified),
      canvas.on('path:created', handlePathCreated),
      canvas.on('object:moving', handleAltCloneMoving),
      canvas.on('mouse:up', handleAltCloneMouseUp),
      canvas.on('object:rotating', handleObjectRotating),
    ]);
    return () => {
      dragActive = false;
      cloneGeneration += 1;
      if (canvas.destroyed) {
        if (altHistoryTransactionActive) useEditorStore.getState().cancelHistoryTransaction();
      } else {
        finishAltCloneGesture();
      }
      disposeEvents();
    };
  }, [setSelectedObjectIds, pushHistory, getDimensionLabel]);

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

    const SNAP_THRESHOLD_PX = 6;

    const handleMoving = (opt: fabric.BasicTransformEvent & { target: fabric.FabricObject }) => {
      const target = opt.target as fabric.FabricObject | undefined;
      if (!target) return;
      const snapThreshold = SNAP_THRESHOLD_PX / Math.max(canvas.getZoom(), 0.001);

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
              if (Math.abs(tVal - oVal) < snapThreshold) {
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
              if (Math.abs(tVal - oVal) < snapThreshold) {
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
              if (Math.abs(edge - g.position) < snapThreshold) {
                snapDx = g.position - edge;
                snappedX = true;
                break;
              }
            }
          }
          if (g.orientation === 'h' && !snappedY) {
            const yEdges = [tTop, tBottom, tCenterY];
            for (const edge of yEdges) {
              if (Math.abs(edge - g.position) < snapThreshold) {
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

  // Associative dimensions and connectors follow their referenced shapes
  // during the gesture, not only after mouse-up.
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const updateLinked = (opt: { target?: fabric.FabricObject }) => {
      const target = opt.target;
      if (!target) return;
      target.setCoords();
      const changedId = target instanceof fabric.Group || target instanceof fabric.ActiveSelection
        ? undefined
        : ensureObjectId(target);
      updateLinkedSemanticObjects(canvas, getDimensionLabel, changedId);
    };
    return disposeAll([
      canvas.on('object:moving', updateLinked),
      canvas.on('object:scaling', updateLinked),
      canvas.on('object:rotating', updateLinked),
    ]);
  }, [getDimensionLabel]);

  // Drawing logic
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const constrainPoint = (
      tool: ToolType,
      start: { x: number; y: number },
      resolved: { point: { x: number; y: number }; anchor: SemanticAnchor },
      event: MouseEvent,
    ) => {
      const ortho = useEditorStore.getState().orthoMode || event.shiftKey;
      if (!ortho || !ORTHO_TOOLS.includes(tool)) return resolved;
      const constrained = applyOrtho(start.x, start.y, resolved.point.x, resolved.point.y);
      if (constrained.x === resolved.point.x && constrained.y === resolved.point.y) return resolved;
      osnapMarker.current = null;
      return { point: constrained, anchor: { x: constrained.x, y: constrained.y } };
    };

    const handleMouseDown = (opt: fabric.TPointerEventInfo) => {
      // CAD pan: Space+left click or middle mouse button
      const currentMode = useEditorStore.getState().drawingMode;
      if (currentMode === 'cad' && (spacePressed.current || (opt.e as MouseEvent).button === 1)) {
        isPanning.current = true;
        lastPanPoint.current = { x: (opt.e as MouseEvent).clientX, y: (opt.e as MouseEvent).clientY };
        canvas.defaultCursor = 'grabbing';
        return;
      }

      if (activeTool === 'select' || activeTool === 'nodeEdit' || activeTool === 'pencil' || activeTool === 'calibrate' || activeTool === 'distanceMeasure' || activeTool === 'angleMeasure') return;
      const rawPointer = canvas.getScenePoint(opt.e);
      const resolved = resolveDrawingPoint(canvas, rawPointer);
      const pointer = resolved.point;

      if (activeTool === 'measure') {
        startMeasuring(pointer);
        return;
      }

      if (activeTool === 'stretch') {
        startStretching(pointer);
        return;
      }

      if (activeTool === 'latex') {
        startLatexPlacement(pointer);
        setLatexPlacement({ x: pointer.x, y: pointer.y });
        return;
      }

      if (activeTool === 'column') {
        const editorStyle = loadCurrentEditorStyle('shape');
        const sz = gridSize > 0 ? gridSize : 20;
        const id = generateObjectId('column');
        const col = new fabric.Rect({
          left: pointer.x - sz / 2,
          top: pointer.y - sz / 2,
          width: sz,
          height: sz,
          fill: '#333333',
          stroke: '#111111',
          strokeWidth: 1,
        });
        applyEditorStyle(col, editorStyle);
        applyDefaults(col, id, TOOL_DEFINITIONS.column.objectKind);
        canvas.add(col);
        finishDrawing(col);
        return;
      }

      if (activeTool === 'polygon' || activeTool === 'polyline') {
        startPolyline(activeTool, pointer, resolved.anchor);
        return;
      }

      if (activeTool === 'text') {
        const editorStyle = loadCurrentEditorStyle('text');
        const id = generateObjectId('text');
        const textbox = new fabric.Textbox(t('defaultText'), {
          left: pointer.x,
          top: pointer.y,
          width: 200,
          fontSize: editorStyle.fontSize,
          fontFamily: editorStyle.fontFamily,
          fontWeight: editorStyle.fontWeight,
          fontStyle: editorStyle.fontStyle as '' | 'normal' | 'italic' | 'oblique',
          fill: editorStyle.fill,
          editable: true,
        });
        applyDefaults(textbox, id, TOOL_DEFINITIONS.text.objectKind);
        canvas.add(textbox);
        finishDrawing(textbox);
        return;
      }

      startDragging(activeTool, pointer, resolved.anchor);
    };

    const handleMouseMove = (opt: fabric.TPointerEventInfo) => {
      if (isPanning.current) {
        const vpt = canvas.viewportTransform;
        if (vpt) {
          vpt[4] += (opt.e as MouseEvent).clientX - lastPanPoint.current.x;
          vpt[5] += (opt.e as MouseEvent).clientY - lastPanPoint.current.y;
          lastPanPoint.current = { x: (opt.e as MouseEvent).clientX, y: (opt.e as MouseEvent).clientY };
          canvas.setViewportTransform(vpt);
          notifyViewportChange();
        }
        return;
      }

      const cursorPoint = canvas.getScenePoint(opt.e);
      scheduleCursorPosition(cursorPoint);

      const session = sessionRef.current;
      if (session.kind === 'idle') {
        if (activeTool !== 'select' && activeTool !== 'nodeEdit' && activeTool !== 'pencil') {
          resolveDrawingPoint(canvas, cursorPoint);
          canvas.requestRenderAll();
        } else {
          osnapMarker.current = null;
        }
        return;
      }
      if (session.kind === 'placingLatex') {
        osnapMarker.current = null;
        return;
      }
      let resolved = resolveDrawingPoint(canvas, cursorPoint);

      if (session.kind === 'polyline') {
        const preview = new fabric.Polyline([...session.points, resolved.point], {
          fill: '',
          stroke: '#1F4E79',
          strokeWidth: 2,
          strokeDashArray: [5, 4],
          selectable: false,
          evented: false,
          objectCaching: false,
        });
        setPreview(preview);
        return;
      }

      if (session.kind === 'measuring' || session.kind === 'stretching') {
        const left = Math.min(session.start.x, resolved.point.x);
        const top = Math.min(session.start.y, resolved.point.y);
        const width = Math.abs(resolved.point.x - session.start.x);
        const height = Math.abs(resolved.point.y - session.start.y);
        setPreview(new fabric.Rect({
          left,
          top,
          width,
          height,
          fill: session.kind === 'measuring'
            ? 'rgba(66,133,244,0.15)'
            : 'rgba(255,152,0,0.15)',
          stroke: session.kind === 'measuring' ? '#4285f4' : '#ff9800',
          strokeWidth: 1,
          strokeDashArray: [4, 4],
          selectable: false,
          evented: false,
          objectCaching: false,
        }));
        return;
      }

      resolved = constrainPoint(session.tool, session.start, resolved, opt.e as MouseEvent);
      const preview = createDraggedShape(
        session.tool,
        session.start.x,
        session.start.y,
        resolved.point.x,
        resolved.point.y,
        {
          start: session.startAnchor,
          end: resolved.anchor,
          connectorRoute: (opt.e as MouseEvent).altKey ? 'elbow' : 'straight',
        },
      );
      if (preview) {
        preview.set({ selectable: false, evented: false, objectCaching: false });
      }
      setPreview(preview);
    };

    const handleMouseUp = (opt: fabric.TPointerEventInfo) => {
      if (isPanning.current) {
        isPanning.current = false;
        const tool = useEditorStore.getState().activeTool;
        canvas.defaultCursor = spacePressed.current ? 'grab' : (tool === 'select' ? 'default' : 'crosshair');
        notifyViewportChange();
        return;
      }

      const session = sessionRef.current;
      if (session.kind === 'idle' || session.kind === 'polyline' || session.kind === 'placingLatex') return;
      let resolved = resolveDrawingPoint(canvas, canvas.getScenePoint(opt.e));

      if (session.kind === 'stretching') {
        finishSession();
        const left = Math.min(session.start.x, resolved.point.x);
        const top = Math.min(session.start.y, resolved.point.y);
        const width = Math.abs(resolved.point.x - session.start.x);
        const height = Math.abs(resolved.point.y - session.start.y);
        if (width >= 2 || height >= 2) {
          setStretchBox({ left, top, width, height });
        }
        return;
      }

      if (session.kind === 'measuring') {
        finishSession();
        const left = Math.min(session.start.x, resolved.point.x);
        const top = Math.min(session.start.y, resolved.point.y);
        const width = Math.abs(resolved.point.x - session.start.x);
        const height = Math.abs(resolved.point.y - session.start.y);
        if (width >= 2 || height >= 2) {
          const {
            drawingMode: mode,
            canvasHeight: currentCanvasHeight,
            cadHeight: currentCadHeight,
          } = useEditorStore.getState();
          const docHeight = mode === 'cad' ? currentCadHeight : currentCanvasHeight;
          const latexX = Math.round(left);
          const latexY = Math.round(docHeight - (top + height));
          setMeasureResult({
            x: latexX,
            y: latexY,
            width: Math.round(width),
            height: Math.round(height),
          });
        }
        setActiveTool('select');
        return;
      }

      resolved = constrainPoint(session.tool, session.start, resolved, opt.e as MouseEvent);
      finishSession();
      const shape = createDraggedShape(
        session.tool,
        session.start.x,
        session.start.y,
        resolved.point.x,
        resolved.point.y,
        {
          start: session.startAnchor,
          end: resolved.anchor,
          connectorRoute: (opt.e as MouseEvent).altKey ? 'elbow' : 'straight',
        },
      );

      if (shape) {
        canvas.add(shape);
        finishDrawing(shape);
      }
    };

    const handleDblClick = () => {
      const session = sessionRef.current;
      if (session.kind !== 'polyline') return;
      const epsilon = 1 / Math.max(canvas.getZoom(), 0.001);
      const points = session.points.filter((point, index, values) => {
        if (index === 0) return true;
        const previous = values[index - 1];
        return Math.hypot(point.x - previous.x, point.y - previous.y) > epsilon;
      });
      const minimumPoints = session.tool === 'polygon' ? 3 : 2;
      if (points.length >= minimumPoints) {
        const id = generateObjectId(session.tool);
        let obj: fabric.FabricObject;
        if (session.tool === 'polygon') {
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
        applyEditorStyle(obj, loadCurrentEditorStyle(session.tool === 'polyline' ? 'line' : 'shape'));
        applyDefaults(obj, id, TOOL_DEFINITIONS[session.tool].objectKind);
        finishSession();
        canvas.add(obj);
        finishDrawing(obj);
      }
    };

    const handleMouseOut = () => {
      osnapMarker.current = null;
      clearCursorPosition();
      canvas.requestRenderAll();
    };

    return disposeAll([
      canvas.on('mouse:down', handleMouseDown),
      canvas.on('mouse:move', handleMouseMove),
      canvas.on('mouse:up', handleMouseUp),
      canvas.on('mouse:dblclick', handleDblClick),
      canvas.on('mouse:out', handleMouseOut),
    ]);
  }, [
    activeTool,
    createDraggedShape,
    finishDrawing,
    setActiveTool,
    t,
    gridSize,
    isPanning,
    lastPanPoint,
    spacePressed,
    notifyViewportChange,
    resolveDrawingPoint,
    sessionRef,
    startDragging,
    startPolyline,
    startMeasuring,
    startStretching,
    startLatexPlacement,
    setPreview,
    finishSession,
    scheduleCursorPosition,
    clearCursorPosition,
  ]);

  // Node edit tool: per-node drag handles plus double-click insert/delete.
  // Double-clicking a segment inserts a node (a line becomes a polyline, curve
  // segments are de Casteljau split so the shape is unchanged); double-clicking
  // an existing node deletes it.
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || activeTool !== 'nodeEdit') return;

    const snapNodePointer = (point: { x: number; y: number }) => {
      const { snapToGrid: snapping, gridSize: grid } = useEditorStore.getState();
      return snapping
        ? { x: snapVal(point.x, grid), y: snapVal(point.y, grid) }
        : point;
    };

    const syncNodeControls = () => {
      const active = canvas.getActiveObject();
      canvas.getObjects().forEach((obj) => {
        if (obj !== active) detachNodeEditControls(obj);
      });
      if (active && isNodeEditableObject(active)) {
        attachNodeEditControls(active, snapNodePointer);
      }
      canvas.requestRenderAll();
    };

    const handleNodeDblClick = (opt: fabric.TPointerEventInfo) => {
      const active = canvas.getActiveObject();
      if (!active || !isNodeEditableObject(active)) return;
      const scenePoint = canvas.getScenePoint(opt.e);
      const tolerance = 12 / Math.max(canvas.getZoom(), 0.001);
      const id = ensureObjectId(active);
      const { showToast } = useEditorStore.getState();

      const nodeRef = findNodeAtScenePoint(active, scenePoint, tolerance * 0.75);
      if (nodeRef) {
        const deleted = executeCanvasTransaction(
          { canvas, pushHistory },
          () => {
            if (nodeRef.type === 'poly' && active instanceof fabric.Polyline) {
              if (!deletePolylineNode(active, nodeRef.index)) return false;
              retargetVertexAnchorsAfterDelete(canvas, id, nodeRef.index, {
                closed: active instanceof fabric.Polygon,
                pointCountBefore: active.points.length + 1,
              });
            } else if (nodeRef.type === 'path' && active instanceof fabric.Path) {
              if (!deletePathNode(active, nodeRef.commandIndex)) return false;
            } else {
              // A plain line always keeps both endpoints.
              return false;
            }
            refreshNodeEditControls(active, snapNodePointer);
            return true;
          },
          { semanticUpdate: [id] },
        );
        if (deleted) showToast(t('nodeDeleteDone'), 'success');
        else showToast(t('nodeDeleteMinPoints'), 'error');
        return;
      }

      if (active instanceof fabric.Line) {
        const replacement = convertLineToPolylineWithNode(active, scenePoint, tolerance);
        if (!replacement) return;
        executeCanvasTransaction(
          { canvas, pushHistory },
          () => {
            detachNodeEditControls(active);
            const stackIndex = canvas.getObjects().indexOf(active);
            canvas.remove(active);
            canvas.insertAt(stackIndex, replacement);
            remapLineAnchorsToPolyline(canvas, id, replacement.points.length - 1);
            canvas.setActiveObject(replacement);
            return true;
          },
          { semanticUpdate: [id] },
        );
        showToast(t('nodeInsertDone'), 'success');
        return;
      }

      const inserted = executeCanvasTransaction(
        { canvas, pushHistory },
        () => {
          if (active instanceof fabric.Polyline) {
            const insertedIndex = insertPolylineNode(active, scenePoint, tolerance);
            if (insertedIndex === null) return false;
            shiftVertexAnchorsAfterInsert(canvas, id, insertedIndex);
          } else if (insertPathNode(active, scenePoint, tolerance) === null) {
            return false;
          }
          refreshNodeEditControls(active, snapNodePointer);
          return true;
        },
        { semanticUpdate: [id] },
      );
      if (inserted) showToast(t('nodeInsertDone'), 'success');
    };

    // While the node-edit tool is active, body drags on the node-edited object
    // must not translate it. Lock flags cannot be used for this: the legacy
    // lock bridge would persist them as metadata.locked in the next snapshot.
    const blockBodyDrag = (opt: fabric.BasicTransformEvent & { target: fabric.FabricObject }) => {
      const target = opt.target;
      if (!target || !hasNodeEditControls(target)) return;
      const original = opt.transform?.original as { left?: number; top?: number } | undefined;
      if (!original || typeof original.left !== 'number' || typeof original.top !== 'number') return;
      target.set({ left: original.left, top: original.top });
      target.setCoords();
    };

    syncNodeControls();
    const disposeNodeEvents = disposeAll([
      canvas.on('selection:created', syncNodeControls),
      canvas.on('selection:updated', syncNodeControls),
      canvas.on('selection:cleared', syncNodeControls),
      canvas.on('mouse:dblclick', handleNodeDblClick),
      canvas.on('object:moving', blockBodyDrag),
    ]);
    return () => {
      disposeNodeEvents();
      if (!canvas.destroyed && !canvas.disposed) {
        canvas.getObjects().forEach(detachNodeEditControls);
        // The store configures the canvas for the next tool synchronously in
        // setActiveTool, i.e. before this cleanup restores the saved control
        // state. Re-apply the current tool's interaction state so switching
        // straight to the select tool shows the normal transform handles.
        configureCanvasForTool(canvas, useEditorStore.getState().activeTool);
        canvas.requestRenderAll();
      }
    };
  }, [activeTool, pushHistory, t]);

  // Render smart guide lines and stored guide lines via after:render
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const handler = () => {
      const ctx = canvas.getContext();
      const vpt = canvas.viewportTransform;
      const z = canvas.getZoom();
      const panX = vpt?.[4] ?? 0;
      const panY = vpt?.[5] ?? 0;
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

      renderPreview(ctx);

      const marker = osnapMarker.current;
      if (marker && useEditorStore.getState().drawingMode === 'cad') {
        const x = marker.point.x * z + panX;
        const y = marker.point.y * z + panY;
        const radius = 5;
        ctx.save();
        ctx.strokeStyle = '#e91e63';
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (marker.kind === 'endpoint') {
          ctx.rect(x - radius, y - radius, radius * 2, radius * 2);
        } else if (marker.kind === 'midpoint') {
          ctx.moveTo(x, y - radius);
          ctx.lineTo(x + radius, y + radius);
          ctx.lineTo(x - radius, y + radius);
          ctx.closePath();
        } else if (marker.kind === 'center') {
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.moveTo(x - radius - 2, y);
          ctx.lineTo(x + radius + 2, y);
          ctx.moveTo(x, y - radius - 2);
          ctx.lineTo(x, y + radius + 2);
        } else {
          ctx.moveTo(x - radius, y - radius);
          ctx.lineTo(x + radius, y + radius);
          ctx.moveTo(x + radius, y - radius);
          ctx.lineTo(x - radius, y + radius);
        }
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    };

    return canvas.on('after:render', handler);
  }, [renderPreview]);

  const handleLatexPlace = useCallback(
    (dataUrl: string, latexSource: string, latexFontSize: number) => {
      const canvas = fabricRef.current;
      if (!canvas || !latexPlacement) return;
      const placement = { ...latexPlacement };
      const operationToken = ++latexOperationToken.current;
      const canCommit = createAsyncCanvasMutationGuard(canvas);

      fabric.Image.fromURL(dataUrl).then((img) => {
        if (
          operationToken !== latexOperationToken.current
          || !fabricRef.current
          || !canCommit()
        ) {
          img.dispose();
          return;
        }
        img.set({
          left: placement.x,
          top: placement.y,
          scaleX: 1 / 3,
          scaleY: 1 / 3,
        });
        const id = generateObjectId('latex');
        applyDefaults(img, id, TOOL_DEFINITIONS.latex.objectKind);
        setFabricMetadataValues(img, { latexSource, latexFontSize });
        finishSession();
        canvas.add(img);
        finishDrawing(img);
        setLatexPlacement(null);
      }).catch(() => {
        if (operationToken === latexOperationToken.current && canCommit()) {
          cancelSession();
          setLatexPlacement(null);
          setActiveTool('select');
        }
      });
    },
    [latexPlacement, finishDrawing, finishSession, cancelSession, setActiveTool],
  );

  const handleLatexCancel = useCallback(() => {
    latexOperationToken.current += 1;
    cancelSession();
    setLatexPlacement(null);
    setActiveTool('select');
  }, [cancelSession, setActiveTool]);

  const handleStretchApply = (inputDx: number, inputDy: number) => {
    const canvas = fabricRef.current;
    if (!canvas || !stretchBox) return;

    const { drawingMode: dm, cadUnit: cu } = useEditorStore.getState();
    const isCad = dm === 'cad';

    const dx = isCad ? unitToMm(inputDx, cu) : inputDx;
    const dy = isCad ? unitToMm(inputDy, cu) : inputDy;

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

    updateLinkedSemanticObjects(canvas, getDimensionLabel);
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
          <Ruler
            orientation="h"
            canvasEl={wrapperEl}
            fabricCanvas={storeCanvas}
            viewport={viewport}
          />
          <Ruler
            orientation="v"
            canvasEl={wrapperEl}
            fabricCanvas={storeCanvas}
            viewport={viewport}
          />
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

      {latexPlacement
        && activeTool === 'latex'
        && (
        <LatexDialog
          onPlace={handleLatexPlace}
          onCancel={handleLatexCancel}
        />
      )}

      {stretchBox && (
        <StretchDialog
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
