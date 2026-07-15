import { create } from 'zustand';
import * as fabric from 'fabric';
import type { CadUnit, DrawingMode, Guide, ToolType } from '../types';
import { setDefaultCanvasCommandHistory } from '../utils/canvasCommands';
import {
  restoreCanvasObjects,
  serializeCanvasSnapshot,
  type CanvasSnapshot,
} from '../utils/documentSerializer';
import { historyService } from '../utils/historyService';
import {
  applyThemeToDom,
  loadThemePreference,
  saveThemePreference,
} from '../utils/themePreference';
import type { Theme } from '../utils/themePreference';
import { configureCanvasForTool } from '../utils/toolActivation';
import { createToastId, scheduleToastRemoval } from '../utils/toastScheduler';

export interface EditorStore {
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
  history: CanvasSnapshot[];
  historyIndex: number;
  isRestoring: boolean;
  revision: number;
  pushHistory: () => void;
  resetHistory: (initialSnapshot?: CanvasSnapshot) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  beginHistoryTransaction: () => void;
  endHistoryTransaction: () => void;
  cancelHistoryTransaction: () => void;
  restoreEditorSettings: (snapshot: CanvasSnapshot) => void;
  /** @deprecated Use isRestoring. Kept for existing event handlers. */
  _skipHistoryPush: boolean;

  // Smart guides (object-to-object snap)
  snapToObjects: boolean;
  toggleSnapToObjects: () => void;

  // Rulers & Guides
  showRulers: boolean;
  toggleRulers: () => void;
  guides: Guide[];
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

export type { Theme } from '../utils/themePreference';
export type ToastType = 'info' | 'success' | 'error';
export interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

const MAX_HISTORY = 50;
const MAX_HISTORY_BYTES = 32 * 1024 * 1024;

let transactionDepth = 0;
let transactionDirty = false;
let historyRequestId = 0;

function snapshotsEqual(left: CanvasSnapshot, right: CanvasSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function trimHistory(history: CanvasSnapshot[]): CanvasSnapshot[] {
  const sizes = history.map((snapshot) => JSON.stringify(snapshot).length * 2);
  let totalBytes = sizes.reduce((sum, size) => sum + size, 0);
  while (
    history.length > 1
    && (history.length > MAX_HISTORY || totalBytes > MAX_HISTORY_BYTES)
  ) {
    history.shift();
    totalBytes -= sizes.shift() ?? 0;
  }
  return history;
}

function captureSnapshot(state: EditorStore): CanvasSnapshot | null {
  if (!state.canvas) return null;
  return serializeCanvasSnapshot({
    canvas: state.canvas,
    canvasWidth: state.canvasWidth,
    canvasHeight: state.canvasHeight,
    backgroundColor: state.backgroundColor,
    drawingMode: state.drawingMode,
    cadUnit: state.cadUnit,
    scale: state.scale,
    cadWidth: state.cadWidth,
    cadHeight: state.cadHeight,
    gridVisible: state.gridVisible,
    gridSize: state.gridSize,
    snapToGrid: state.snapToGrid,
    snapToObjects: state.snapToObjects,
    showRulers: state.showRulers,
    guides: state.guides,
    snapToGuides: state.snapToGuides,
    orthoMode: state.orthoMode,
  });
}

export const useEditorStore = create<EditorStore>((set, get) => {
  const recordSettingChange = (): void => {
    get().pushHistory();
  };

  const applySnapshotSettings = (snapshot: CanvasSnapshot): void => {
    const state = get();
    // Keep the store side-effect free with respect to viewport layout. The
    // live Fabric dimensions depend on mode and display zoom (or the CAD
    // wrapper size), so applying document dimensions here corrupts the
    // viewport during an object-only Undo/Redo. useCadViewport reapplies the
    // correct live layout when restoration starts/finishes.
    set({
      canvasWidth: snapshot.canvas.width,
      canvasHeight: snapshot.canvas.height,
      backgroundColor: snapshot.canvas.backgroundColor,
      drawingMode: snapshot.drawingMode ?? state.drawingMode,
      cadUnit: snapshot.cadUnit ?? state.cadUnit,
      scale: snapshot.scale ?? state.scale,
      cadWidth: snapshot.cadWidth ?? state.cadWidth,
      cadHeight: snapshot.cadHeight ?? state.cadHeight,
      gridVisible: snapshot.gridVisible ?? state.gridVisible,
      gridSize: snapshot.gridSize ?? state.gridSize,
      snapToGrid: snapshot.snapToGrid ?? state.snapToGrid,
      snapToObjects: snapshot.snapToObjects ?? state.snapToObjects,
      showRulers: snapshot.showRulers ?? state.showRulers,
      guides: snapshot.guides?.map((guide) => ({ ...guide })) ?? state.guides,
      snapToGuides: snapshot.snapToGuides ?? state.snapToGuides,
      orthoMode: snapshot.orthoMode ?? state.orthoMode,
      selectedObjectIds: [],
    });
  };

  const applyHistorySnapshot = async (
    canvas: fabric.Canvas,
    snapshot: CanvasSnapshot,
    signal: AbortSignal,
  ): Promise<void> => {
    await historyService.withHistorySuspended(async () => {
      applySnapshotSettings(snapshot);
      await restoreCanvasObjects(canvas, snapshot.objects, signal);
      configureCanvasForTool(canvas, get().activeTool);
    });
  };

  const restoreHistoryIndex = async (targetIndex: number, force = false): Promise<void> => {
    const { canvas, history, historyIndex } = get();
    if (
      !canvas
      || targetIndex < 0
      || targetIndex >= history.length
      || (!force && targetIndex === historyIndex)
    ) {
      return;
    }

    const previousIndex = historyIndex;
    const previousSnapshot = history[previousIndex];
    const targetSnapshot = history[targetIndex];
    if (!previousSnapshot || !targetSnapshot) return;

    const requestId = ++historyRequestId;
    set({ historyIndex: targetIndex });

    try {
      const result = await historyService.enqueue(async (signal) => {
        try {
          await applyHistorySnapshot(canvas, targetSnapshot, signal);
        } catch (error) {
          // A genuine load failure can leave Fabric partially mutated. Restore
          // the last known-good snapshot before surfacing the error.
          if (!signal.aborted) {
            await applyHistorySnapshot(canvas, previousSnapshot, signal);
          }
          throw error;
        }
      });
      if (result.status === 'completed') {
        set((state) => ({ revision: state.revision + 1 }));
      }
    } catch {
      if (requestId === historyRequestId) {
        set({ historyIndex: previousIndex });
      }
      get().showToast('Undo/Redo の復元に失敗しました。', 'error');
    }
  };

  return {
    drawingMode: 'illustration',
    setDrawingMode: (mode) => {
      if (mode === get().drawingMode) return;
      set({ drawingMode: mode });
      recordSettingChange();
    },
    cadUnit: 'mm',
    setCadUnit: (unit) => {
      if (unit === get().cadUnit) return;
      set({ cadUnit: unit });
      recordSettingChange();
    },

    activeTool: 'select',
    setActiveTool: (tool) => {
      const { canvas } = get();
      if (canvas) configureCanvasForTool(canvas, tool);
      set({ activeTool: tool });
    },

    canvas: null,
    setCanvas: (canvas) => set({ canvas }),

    canvasWidth: 800,
    canvasHeight: 600,
    setCanvasSize: (w, h) => {
      if (w === get().canvasWidth && h === get().canvasHeight) return;
      set({ canvasWidth: w, canvasHeight: h });
      recordSettingChange();
    },

    backgroundColor: '#FFFFFF',
    setBackgroundColor: (color) => {
      if (color === get().backgroundColor) return;
      set({ backgroundColor: color });
      recordSettingChange();
    },

    zoom: 1,
    setZoom: (zoom) => set({ zoom }),

    gridVisible: false,
    toggleGrid: () => {
      set((state) => ({ gridVisible: !state.gridVisible }));
      recordSettingChange();
    },
    gridSize: 20,
    setGridSize: (size) => {
      const next = Math.max(5, size);
      if (next === get().gridSize) return;
      set({ gridSize: next });
      recordSettingChange();
    },
    snapToGrid: false,
    toggleSnap: () => {
      set((state) => ({ snapToGrid: !state.snapToGrid }));
      recordSettingChange();
    },

    scale: '1:1',
    setScale: (scale) => {
      if (scale === get().scale) return;
      set({ scale });
      recordSettingChange();
    },

    cadWidth: 10000,
    cadHeight: 8000,
    setCadSize: (w, h) => {
      if (w === get().cadWidth && h === get().cadHeight) return;
      set({ cadWidth: w, cadHeight: h });
      recordSettingChange();
    },

    selectedObjectIds: [],
    setSelectedObjectIds: (ids) => set({ selectedObjectIds: ids }),

    history: [],
    historyIndex: -1,
    isRestoring: false,
    revision: 0,
    _skipHistoryPush: false,
    pushHistory: () => {
      const state = get();
      if (
        !state.canvas
        || state._skipHistoryPush
        || historyService.isHistorySuspended
      ) {
        return;
      }
      if (transactionDepth > 0) {
        transactionDirty = true;
        return;
      }

      const snapshot = captureSnapshot(state);
      if (!snapshot) return;
      const current = state.history[state.historyIndex];
      if (current && snapshotsEqual(current, snapshot)) return;

      const history = state.history.slice(0, state.historyIndex + 1);
      history.push(snapshot);
      trimHistory(history);
      set({
        history,
        historyIndex: history.length - 1,
        revision: state.revision + 1,
      });
    },
    resetHistory: (initialSnapshot) => {
      historyRequestId += 1;
      historyService.invalidate();
      transactionDepth = 0;
      transactionDirty = false;
      const snapshot = initialSnapshot ?? captureSnapshot(get());
      set((state) => ({
        history: snapshot ? [snapshot] : [],
        historyIndex: snapshot ? 0 : -1,
        selectedObjectIds: [],
        revision: state.revision + 1,
      }));
    },
    undo: () => {
      if (transactionDepth > 0) {
        // A gesture can mutate the live canvas before its final history entry
        // is committed (held arrow keys and Alt-drag are examples). Undo must
        // cancel that gesture back to the current baseline instead of skipping
        // over the baseline to an older history entry.
        transactionDepth = 0;
        transactionDirty = false;
        return restoreHistoryIndex(get().historyIndex, true);
      }
      return restoreHistoryIndex(get().historyIndex - 1);
    },
    redo: () => {
      if (transactionDepth > 0) {
        transactionDepth = 0;
        transactionDirty = false;
        return restoreHistoryIndex(get().historyIndex, true);
      }
      return restoreHistoryIndex(get().historyIndex + 1);
    },
    beginHistoryTransaction: () => {
      transactionDepth += 1;
    },
    endHistoryTransaction: () => {
      if (transactionDepth === 0) return;
      transactionDepth -= 1;
      if (transactionDepth === 0 && transactionDirty) {
        transactionDirty = false;
        get().pushHistory();
      }
    },
    cancelHistoryTransaction: () => {
      transactionDepth = 0;
      transactionDirty = false;
    },
    restoreEditorSettings: (snapshot) => applySnapshotSettings(snapshot),

    snapToObjects: false,
    toggleSnapToObjects: () => {
      set((state) => ({ snapToObjects: !state.snapToObjects }));
      recordSettingChange();
    },

    showRulers: false,
    toggleRulers: () => {
      set((state) => ({ showRulers: !state.showRulers }));
      recordSettingChange();
    },
    guides: [],
    addGuide: (orientation, position) => {
      set((state) => ({ guides: [...state.guides, { orientation, position }] }));
      recordSettingChange();
    },
    removeGuide: (index) => {
      if (!get().guides[index]) return;
      set((state) => ({ guides: state.guides.filter((_, itemIndex) => itemIndex !== index) }));
      recordSettingChange();
    },
    clearGuides: () => {
      if (get().guides.length === 0) return;
      set({ guides: [] });
      recordSettingChange();
    },
    snapToGuides: false,
    toggleSnapToGuides: () => {
      set((state) => ({ snapToGuides: !state.snapToGuides }));
      recordSettingChange();
    },

    clipboard: null,
    setClipboard: (objects) => set({ clipboard: objects }),

    orthoMode: false,
    toggleOrtho: () => {
      set((state) => ({ orthoMode: !state.orthoMode }));
      recordSettingChange();
    },

    cursorPos: null,
    setCursorPos: (pos) => set({ cursorPos: pos }),

    theme: loadThemePreference(),
    toggleTheme: () => {
      const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
      saveThemePreference(next);
      applyThemeToDom(next);
      set({ theme: next });
    },

    toasts: [],
    showToast: (message, type = 'info') => {
      const id = createToastId();
      set((state) => ({ toasts: [...state.toasts, { id, message, type }] }));
      scheduleToastRemoval(() => {
        set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
      });
    },
    removeToast: (id) => {
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
    },
  };
});

export function captureCurrentEditorSnapshot(): CanvasSnapshot | null {
  return captureSnapshot(useEditorStore.getState());
}

setDefaultCanvasCommandHistory(useEditorStore.getState().pushHistory);

historyService.setRestoringListener((isRestoring) => {
  const state = useEditorStore.getState();
  if (state.canvas) {
    state.canvas.upperCanvasEl.style.pointerEvents = isRestoring ? 'none' : '';
    if (isRestoring) {
      state.cancelHistoryTransaction();
      const active = state.canvas.getActiveObject();
      if (active instanceof fabric.IText && active.isEditing) active.exitEditing();
      state.canvas.discardActiveObject();
      state.canvas.selection = false;
      state.canvas.requestRenderAll();
    } else {
      configureCanvasForTool(state.canvas, state.activeTool);
    }
  }
  useEditorStore.setState({
    isRestoring,
    _skipHistoryPush: isRestoring,
  });
});

historyService.setDocumentRestoredListener((snapshot) => {
  const validatedSnapshot = snapshot as CanvasSnapshot;
  const state = useEditorStore.getState();
  state.restoreEditorSettings(validatedSnapshot);
  if (state.canvas) configureCanvasForTool(state.canvas, state.activeTool);
  state.resetHistory();
});

// Apply persisted theme to the document on load
applyThemeToDom(useEditorStore.getState().theme);
