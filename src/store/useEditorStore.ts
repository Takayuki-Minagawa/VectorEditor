import { defaultCadLayers, validateCadLayers, type CadLayer } from '../domain/cadLayer';
import { applyCadLayers, setCanvasLayerContext } from '../utils/cadLayers';
import { create } from 'zustand';
import * as fabric from 'fabric';
import type {
  CadUnit,
  DrawingMode,
  Guide,
  DocumentPage,
  SerializedCanvasData,
  ToolType,
} from '../types';
import { setDefaultCanvasCommandHistory } from '../utils/canvasCommands';
import {
  createCanvasSnapshot,
  MAX_DOCUMENT_PAGES,
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
import { toFabricObjects } from '../domain/trace/toFabricObjects';
import type { TracedDrawing } from '../domain/trace/tracedDrawing';

export interface InsertTracedDrawingOptions {
  group?: boolean;
  color?: string;
}

export interface EditorStore {
  cadLayers: CadLayer[];
  activeCadLayerId: string;
  setCadLayers: (layers: CadLayer[], activeId?: string, record?: boolean) => void;
  // Tool
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;

  // Drawing mode
  drawingMode: DrawingMode;
  setDrawingMode: (mode: DrawingMode) => void;
  cadUnit: CadUnit;
  setCadUnit: (unit: CadUnit) => void;

  // Canvas
  pages: DocumentPage[];
  activePageId: string;
  switchPage: (id: string) => Promise<void>;
  addPage: () => Promise<void>;
  duplicatePage: () => Promise<void>;
  deletePage: (id: string) => Promise<void>;
  renamePage: (id: string, name: string) => void;
  movePage: (id: string, direction: -1 | 1) => void;
  canvas: fabric.Canvas | null;
  setCanvas: (canvas: fabric.Canvas | null) => void;
  canvasWidth: number;
  canvasHeight: number;
  setCanvasSize: (w: number, h: number) => void;
  backgroundColor: string;
  setBackgroundColor: (color: string) => void;
  insertTracedDrawing: (
    drawing: TracedDrawing,
    options?: InsertTracedDrawingOptions,
  ) => fabric.FabricObject[];

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
  selectedPathNode: number | null;
  setSelectedPathNode: (index: number | null) => void;

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
let transactionChange: HistoryChange | null = null;
let historyRequestId = 0;
const serializedObjectSizes = new WeakMap<SerializedCanvasData, number>();

type HistoryChange = 'settings' | 'objects';

function snapshotSettingsJson(snapshot: CanvasSnapshot): string {
  // Overriding instead of manually listing settings keeps comparisons correct
  // when CanvasSnapshot gains another setting, without traversing objects.
  return JSON.stringify({ ...snapshot, objects: undefined, pages: snapshot.pages?.map((page) => ({ ...page, objects: undefined })) });
}

function snapshotsEqual(left: CanvasSnapshot, right: CanvasSnapshot): boolean {
  if (left.objects === right.objects) {
    return snapshotSettingsJson(left) === snapshotSettingsJson(right);
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function serializedObjectsSize(objects: SerializedCanvasData): number {
  const cached = serializedObjectSizes.get(objects);
  if (cached !== undefined) return cached;
  const size = JSON.stringify(objects).length * 2;
  serializedObjectSizes.set(objects, size);
  return size;
}

function historySize(history: CanvasSnapshot[]): number {
  const uniqueObjects = new Set<SerializedCanvasData>();
  let totalBytes = 0;
  history.forEach((snapshot) => {
    totalBytes += snapshotSettingsJson(snapshot).length * 2;
    uniqueObjects.add(snapshot.objects);
    snapshot.pages?.forEach((page) => uniqueObjects.add(page.objects));
  });
  uniqueObjects.forEach((objects) => {
    totalBytes += serializedObjectsSize(objects);
  });
  return totalBytes;
}

function trimHistory(history: CanvasSnapshot[]): CanvasSnapshot[] {
  while (
    history.length > 1
    && (history.length > MAX_HISTORY || historySize(history) > MAX_HISTORY_BYTES)
  ) {
    history.shift();
  }
  return history;
}

function captureSnapshot(
  state: EditorStore,
  reusableObjects?: SerializedCanvasData,
): CanvasSnapshot | null {
  if (!state.canvas) return null;
  const input = {
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
    cadLayers: state.cadLayers,
    activeCadLayerId: state.activeCadLayerId,
    pages: state.pages,
    activePageId: state.activePageId,
  };
  const snapshot = reusableObjects
    ? createCanvasSnapshot(input, reusableObjects)
    : serializeCanvasSnapshot(input);
  if (!reusableObjects) serializedObjectsSize(snapshot.objects);
  return snapshot;
}

export const useEditorStore = create<EditorStore>((set, get) => {
  const recordHistoryChange = (change: HistoryChange): void => {
    const state = get();
    if (
      !state.canvas
      || state._skipHistoryPush
      || historyService.isHistorySuspended
    ) {
      return;
    }
    if (transactionDepth > 0) {
      if (change === 'objects' || transactionChange === null) {
        transactionChange = change;
      }
      return;
    }

    // A settings-only entry can share the current immutable-by-convention
    // serialized payload. The live Fabric objects have not changed, so another
    // full canvas.toObject() traversal would only reproduce the same data.
    if (change === 'objects') {
      applyCadLayers(state.canvas);
      // Node editing owns its selection and custom handles throughout a gesture.
      if (state.activeTool === 'select') configureCanvasForTool(state.canvas, state.activeTool);
    }
    const reusableObjects = change === 'settings'
      ? state.history[state.historyIndex]?.objects
      : undefined;
    const snapshot = captureSnapshot(state, reusableObjects);
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
      pages: snapshot.pages ?? state.pages,
    });
  };

  const recordSettingChange = (): void => recordHistoryChange('settings');

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
      cadLayers: structuredClone(snapshot.cadLayers ?? defaultCadLayers()),
      activeCadLayerId: snapshot.activeCadLayerId ?? '0',
      selectedObjectIds: [],
      pages: snapshot.pages ?? [{ id: 'page_1', name: 'Page 1', canvas: snapshot.canvas, objects: snapshot.objects }],
      activePageId: snapshot.activePageId ?? 'page_1',
      selectedPathNode: null,
    });
  };

  const applyHistorySnapshot = async (
    canvas: fabric.Canvas,
    snapshot: CanvasSnapshot,
    signal: AbortSignal,
    restoreObjects: boolean,
  ): Promise<void> => {
    await historyService.withHistorySuspended(async () => {
      applySnapshotSettings(snapshot);
      if (restoreObjects) {
        await restoreCanvasObjects(canvas, snapshot.objects, signal);
      }
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
    // Object identity is shared only by settings-only history entries. A
    // forced restore still reloads the payload because an open gesture may
    // have mutated the live canvas without committing a new snapshot.
    const restoreObjects = force || previousSnapshot.objects !== targetSnapshot.objects;

    const requestId = ++historyRequestId;
    set({ historyIndex: targetIndex });

    try {
      const result = await historyService.enqueue(async (signal) => {
        try {
          await applyHistorySnapshot(canvas, targetSnapshot, signal, restoreObjects);
        } catch (error) {
          // A genuine load failure can leave Fabric partially mutated. Restore
          // the last known-good snapshot before surfacing the error.
          if (!signal.aborted) {
            await applyHistorySnapshot(canvas, previousSnapshot, signal, restoreObjects);
          }
          throw error;
        }
      });
      if (result.status === 'skipped') {
        // Document restores invalidate queued history work. If that document
        // restore later fails and rolls the live canvas back, this request is
        // still responsible for undoing its optimistic index update.
        if (requestId === historyRequestId) {
          set({ historyIndex: previousIndex });
        }
        return;
      }
      set((state) => ({ revision: state.revision + 1 }));
    } catch {
      if (requestId === historyRequestId) {
        set({ historyIndex: previousIndex });
      }
      get().showToast('Undo/Redo の復元に失敗しました。', 'error');
    }
  };

  const performPageChange = async (
    update: (pages: DocumentPage[], activeId: string) => { pages: DocumentPage[]; targetId: string } | null,
  ): Promise<void> => {
    const result = await historyService.enqueue(async (signal) => {
      const state = get();
      const canvas = state.canvas;
      if (!canvas || state.drawingMode !== 'illustration') return false;
      const before = captureSnapshot(state);
      if (!before?.pages) return false;
      const change = update(before.pages, state.activePageId);
      if (!change) return false;
      const target = change.pages.find((page) => page.id === change.targetId);
      if (!target) return false;
      if (change.targetId !== state.activePageId) {
        try {
          await restoreCanvasObjects(canvas, target.objects, signal);
        } catch (error) {
          if (!signal.aborted) await restoreCanvasObjects(canvas, before.objects, signal);
          throw error;
        }
      }
      if (signal.aborted) return false;
      set({
        pages: change.pages,
        activePageId: target.id,
        canvasWidth: target.canvas.width,
        canvasHeight: target.canvas.height,
        backgroundColor: target.canvas.backgroundColor,
        selectedObjectIds: [],
        selectedPathNode: null,
      });
      configureCanvasForTool(canvas, get().activeTool);
      return true;
    });
    if (result.status === 'completed' && result.value) recordHistoryChange('objects');
  };

  return {
    pages: [{ id: 'page_1', name: 'Page 1', canvas: { width: 800, height: 600, backgroundColor: '#FFFFFF' }, objects: { objects: [] } }],
    activePageId: 'page_1',
    switchPage: async (id) => {
      if (id === get().activePageId) return;
      await performPageChange((pages) => pages.some((page) => page.id === id) ? { pages, targetId: id } : null);
    },
    addPage: async () => performPageChange((pages) => {
      if (pages.length >= MAX_DOCUMENT_PAGES) return null;
      const id = `page_${crypto.randomUUID()}`;
      const state = get();
      return { pages: [...pages, { id, name: `Page ${pages.length + 1}`, canvas: { width: state.canvasWidth, height: state.canvasHeight, backgroundColor: state.backgroundColor }, objects: { objects: [] } }], targetId: id };
    }),
    duplicatePage: async () => performPageChange((pages, activeId) => {
      if (pages.length >= MAX_DOCUMENT_PAGES) return null;
      const source = pages.find((page) => page.id === activeId);
      if (!source) return null;
      const id = `page_${crypto.randomUUID()}`;
      const copy = structuredClone(source);
      copy.id = id; copy.name = `${source.name} copy`;
      const index = pages.indexOf(source);
      return { pages: [...pages.slice(0, index + 1), copy, ...pages.slice(index + 1)], targetId: id };
    }),
    deletePage: async (id) => performPageChange((pages, activeId) => {
      if (pages.length <= 1 || !pages.some((page) => page.id === id)) return null;
      const index = pages.findIndex((page) => page.id === id);
      const remaining = pages.filter((page) => page.id !== id);
      return { pages: remaining, targetId: id === activeId ? remaining[Math.min(index, remaining.length - 1)].id : activeId };
    }),
    renamePage: (id, name) => {
      const clean = name.trim().slice(0, 100);
      if (!clean || !get().pages.some((page) => page.id === id)) return;
      set({ pages: get().pages.map((page) => page.id === id ? { ...page, name: clean } : page) });
      recordSettingChange();
    },
    movePage: (id, direction) => {
      const pages = [...get().pages];
      const index = pages.findIndex((page) => page.id === id);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= pages.length) return;
      [pages[index], pages[next]] = [pages[next], pages[index]];
      set({ pages });
      recordSettingChange();
    },
    cadLayers: defaultCadLayers(),
    activeCadLayerId: '0',
    setCadLayers: (layers, activeId = get().activeCadLayerId, record = true) => {
      const validated = validateCadLayers(layers);
      if (!validated.some((l) => l.id === activeId)) throw new Error('Active CAD layer is missing');
      set({ cadLayers: validated, activeCadLayerId: activeId });
      if (record) get().pushHistory();
    },
    drawingMode: 'illustration',
    setDrawingMode: (mode) => {
      if (mode === get().drawingMode) return;
      if (mode === 'cad' && get().pages.length > 1) {
        get().showToast('複数ページの文書はCADモードに切り替えられません。', 'error');
        return;
      }
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
    insertTracedDrawing: (drawing, options = {}) => {
      const canvas = get().canvas;
      if (!canvas) return [];
      const objects = toFabricObjects(drawing, {
        canvas,
        group: options.group,
        color: options.color,
      });
      if (objects.length === 0) return [];

      const added: fabric.FabricObject[] = [];
      get().beginHistoryTransaction();
      try {
        canvas.discardActiveObject();
        objects.forEach((object) => {
          canvas.add(object);
          added.push(object);
        });
        if (objects.length === 1) {
          canvas.setActiveObject(objects[0]);
        } else {
          canvas.setActiveObject(new fabric.ActiveSelection(objects, { canvas }));
        }
        canvas.requestRenderAll();
        get().pushHistory();
        get().endHistoryTransaction();
        return objects;
      } catch (error) {
        canvas.discardActiveObject();
        added.forEach((object) => canvas.remove(object));
        get().cancelHistoryTransaction();
        canvas.requestRenderAll();
        throw error;
      }
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
    selectedPathNode: null,
    setSelectedPathNode: (index) => set({ selectedPathNode: index }),

    history: [],
    historyIndex: -1,
    isRestoring: false,
    revision: 0,
    _skipHistoryPush: false,
    pushHistory: () => recordHistoryChange('objects'),
    resetHistory: (initialSnapshot) => {
      historyRequestId += 1;
      historyService.invalidate();
      transactionDepth = 0;
      transactionChange = null;
      const snapshot = initialSnapshot ?? captureSnapshot(get());
      if (snapshot) serializedObjectsSize(snapshot.objects);
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
        transactionChange = null;
        return restoreHistoryIndex(get().historyIndex, true);
      }
      return restoreHistoryIndex(get().historyIndex - 1);
    },
    redo: () => {
      if (transactionDepth > 0) {
        transactionDepth = 0;
        transactionChange = null;
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
      if (transactionDepth === 0 && transactionChange) {
        const change = transactionChange;
        transactionChange = null;
        recordHistoryChange(change);
      }
    },
    cancelHistoryTransaction: () => {
      transactionDepth = 0;
      transactionChange = null;
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

// Keep derived layer presentation attached to the canvas, including document restores.
useEditorStore.subscribe((state, previous) => {
  if (!state.canvas) return;
  if (state.canvas !== previous.canvas || state.cadLayers !== previous.cadLayers || state.activeCadLayerId !== previous.activeCadLayerId) {
    setCanvasLayerContext(state.canvas, { layers: state.cadLayers, activeId: state.activeCadLayerId,
      replace: (layers) => useEditorStore.getState().setCadLayers(layers, useEditorStore.getState().activeCadLayerId, false) });
    applyCadLayers(state.canvas);
    configureCanvasForTool(state.canvas, state.activeTool);
  }
});
