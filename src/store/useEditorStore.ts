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

  // Smart guides (object-to-object snap)
  snapToObjects: boolean;
  toggleSnapToObjects: () => void;

  // Rulers & Guides
  showRulers: boolean;
  toggleRulers: () => void;
  guides: { orientation: 'h' | 'v'; position: number }[];
  addGuide: (orientation: 'h' | 'v', position: number) => void;
  removeGuide: (index: number) => void;
  clearGuides: () => void;
  snapToGuides: boolean;
  toggleSnapToGuides: () => void;

  // Clipboard
  clipboard: fabric.FabricObject[] | null;
  setClipboard: (objects: fabric.FabricObject[] | null) => void;

  // Ortho / angle constraint while drawing
  orthoMode: boolean;
  toggleOrtho: () => void;

  // Live cursor position (scene coordinates in px)
  cursorPos: { x: number; y: number } | null;
  setCursorPos: (pos: { x: number; y: number } | null) => void;

  // Theme
  theme: Theme;
  toggleTheme: () => void;

  // Toast notifications
  toasts: Toast[];
  showToast: (message: string, type?: ToastType) => void;
  removeToast: (id: number) => void;
}

export type Theme = 'light' | 'dark';
export type ToastType = 'info' | 'success' | 'error';
export interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

const THEME_STORAGE_KEY = 'vectoreditor-theme';

function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* ignore */ }
  return 'light';
}

function applyThemeToDom(theme: Theme) {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme;
  }
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
      const isPencil = tool === 'pencil';
      canvas.isDrawingMode = isPencil;
      if (isPencil) {
        const brush = new fabric.PencilBrush(canvas);
        brush.width = 2;
        brush.color = '#1F4E79';
        canvas.freeDrawingBrush = brush;
      }
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

  snapToObjects: false,
  toggleSnapToObjects: () => set((s) => ({ snapToObjects: !s.snapToObjects })),

  showRulers: false,
  toggleRulers: () => set((s) => ({ showRulers: !s.showRulers })),
  guides: [],
  addGuide: (orientation, position) =>
    set((s) => ({ guides: [...s.guides, { orientation, position }] })),
  removeGuide: (index) =>
    set((s) => ({ guides: s.guides.filter((_, i) => i !== index) })),
  clearGuides: () => set({ guides: [] }),
  snapToGuides: false,
  toggleSnapToGuides: () => set((s) => ({ snapToGuides: !s.snapToGuides })),

  clipboard: null,
  setClipboard: (objects) => set({ clipboard: objects }),

  orthoMode: false,
  toggleOrtho: () => set((s) => ({ orthoMode: !s.orthoMode })),

  cursorPos: null,
  setCursorPos: (pos) => set({ cursorPos: pos }),

  theme: loadTheme(),
  toggleTheme: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* ignore */ }
    applyThemeToDom(next);
    set({ theme: next });
  },

  toasts: [],
  showToast: (message, type = 'info') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((tt) => tt.id !== id) }));
    }, 3000);
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((tt) => tt.id !== id) })),
}));

// Apply persisted theme to the document on load
applyThemeToDom(useEditorStore.getState().theme);
