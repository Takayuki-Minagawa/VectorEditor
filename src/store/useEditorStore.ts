import { create } from 'zustand';
import * as fabric from 'fabric';
import type { ToolType, DrawingMode, CadUnit } from '../types';
import { ensureObjectIdsRecursive } from '../utils/objectIds';

interface EditorStore {
  // Tool
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;

  // Drawing mode
  drawingMode: DrawingMode;
  setDrawingMode: (mode: DrawingMode) => void;
  cadUnit: CadUnit;
  setCadUnit: (unit: CadUnit) => void;

  // Canvas
  canvas: fabric.Canvas | null;
  setCanvas: (canvas: fabric.Canvas | null) => void;
  canvasWidth: number;
  canvasHeight: number;
  setCanvasSize: (w: number, h: number) => void;
  backgroundColor: string;
  setBackgroundColor: (color: string) => void;

  // Zoom
  zoom: number;
  setZoom: (zoom: number) => void;

  // Grid
  gridVisible: boolean;
  toggleGrid: () => void;
  gridSize: number;
  setGridSize: (size: number) => void;
  snapToGrid: boolean;
  toggleSnap: () => void;

  // Scale (display label)
  scale: string;
  setScale: (scale: string) => void;

  // CAD document size (mm, 1:1 mode)
  cadWidth: number;
  cadHeight: number;
  setCadSize: (w: number, h: number) => void;

  // Selection tracking
  selectedObjectIds: string[];
  setSelectedObjectIds: (ids: string[]) => void;

  // History (Undo/Redo)
  history: string[];
  historyIndex: number;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  _skipHistoryPush: boolean;

  // Clipboard
  clipboard: fabric.FabricObject[] | null;
  setClipboard: (objects: fabric.FabricObject[] | null) => void;
}

const MAX_HISTORY = 50;

export const useEditorStore = create<EditorStore>((set, get) => ({
  drawingMode: 'illustration',
  setDrawingMode: (mode) => set({ drawingMode: mode }),
  cadUnit: 'mm',
  setCadUnit: (unit) => set({ cadUnit: unit }),

  activeTool: 'select',
  setActiveTool: (tool) => {
    const { canvas } = get();
    if (canvas) {
      canvas.isDrawingMode = false;
      canvas.selection = tool === 'select';
      canvas.defaultCursor = tool === 'select' ? 'default' : 'crosshair';
      canvas.forEachObject((obj) => {
        obj.selectable = tool === 'select';
        obj.evented = tool === 'select';
      });
      if (tool !== 'select') {
        canvas.discardActiveObject();
        canvas.requestRenderAll();
      }
    }
    set({ activeTool: tool });
  },

  canvas: null,
  setCanvas: (canvas) => set({ canvas }),

  canvasWidth: 800,
  canvasHeight: 600,
  setCanvasSize: (w, h) => {
    const { canvas } = get();
    if (canvas) {
      canvas.setDimensions({ width: w, height: h });
    }
    set({ canvasWidth: w, canvasHeight: h });
  },

  backgroundColor: '#FFFFFF',
  setBackgroundColor: (color) => {
    const { canvas } = get();
    if (canvas) {
      canvas.backgroundColor = color;
      canvas.requestRenderAll();
    }
    set({ backgroundColor: color });
  },

  zoom: 1,
  setZoom: (zoom) => set({ zoom }),

  gridVisible: false,
  toggleGrid: () => set((s) => ({ gridVisible: !s.gridVisible })),
  gridSize: 20,
  setGridSize: (size) => set({ gridSize: Math.max(5, size) }),
  snapToGrid: false,
  toggleSnap: () => set((s) => ({ snapToGrid: !s.snapToGrid })),

  scale: '1:1',
  setScale: (scale) => set({ scale }),

  cadWidth: 10000,   // 10m default
  cadHeight: 8000,   // 8m default
  setCadSize: (w, h) => set({ cadWidth: w, cadHeight: h }),

  selectedObjectIds: [],
  setSelectedObjectIds: (ids) => set({ selectedObjectIds: ids }),

  history: [],
  historyIndex: -1,
  _skipHistoryPush: false,
  pushHistory: () => {
    const { canvas, history, historyIndex, _skipHistoryPush } = get();
    if (!canvas || _skipHistoryPush) return;
    const json = JSON.stringify(canvas.toObject(['id', 'name', 'selectable', 'evented']));
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(json);
    if (newHistory.length > MAX_HISTORY) newHistory.shift();
    set({ history: newHistory, historyIndex: newHistory.length - 1 });
  },
  undo: () => {
    const { canvas, history, historyIndex } = get();
    if (!canvas || historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    set({ _skipHistoryPush: true, historyIndex: newIndex });
    canvas.loadFromJSON(JSON.parse(history[newIndex])).then(() => {
      canvas.getObjects().forEach((obj) => ensureObjectIdsRecursive(obj));
      canvas.requestRenderAll();
      set({ _skipHistoryPush: false });
    });
  },
  redo: () => {
    const { canvas, history, historyIndex } = get();
    if (!canvas || historyIndex >= history.length - 1) return;
    const newIndex = historyIndex + 1;
    set({ _skipHistoryPush: true, historyIndex: newIndex });
    canvas.loadFromJSON(JSON.parse(history[newIndex])).then(() => {
      canvas.getObjects().forEach((obj) => ensureObjectIdsRecursive(obj));
      canvas.requestRenderAll();
      set({ _skipHistoryPush: false });
    });
  },

  clipboard: null,
  setClipboard: (objects) => set({ clipboard: objects }),
}));
