import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fabric from 'fabric';
import { setFabricMetadataValues } from '../utils/fabricObjectMetadata';
import type { CanvasSnapshot } from '../utils/documentSerializer';
import { historyService } from '../utils/historyService';
import { useEditorStore } from './useEditorStore';

function snapshotAt(left: number): CanvasSnapshot {
  return {
    canvas: { width: 800, height: 600, backgroundColor: '#ffffff' },
    objects: {
      version: '7.4.0',
      objects: [{ type: 'Rect', left, top: 0, width: 20, height: 20 }],
    },
    drawingMode: 'illustration',
  };
}

function createHistoryCanvas(left = 0) {
  let objects: fabric.FabricObject[] = [
    new fabric.Rect({ left, top: 0, width: 20, height: 20 }),
  ];
  const toObject = vi.fn((properties: string[]) => ({
    version: '7.4.0',
    objects: objects.map((object) => object.toObject(properties)),
  }));
  const loadFromJSON = vi.fn(async (data: { objects?: Array<{ left?: number }> }) => {
    objects = (data.objects ?? []).map((item) => new fabric.Rect({
      left: item.left ?? 0,
      top: 0,
      width: 20,
      height: 20,
    }));
  });
  const canvas = {
    upperCanvasEl: { style: {} },
    renderOnAddRemove: true,
    selection: true,
    getActiveObject: () => null,
    discardActiveObject: vi.fn(),
    requestRenderAll: vi.fn(),
    getObjects: () => objects,
    forEachObject: (visitor: (object: fabric.FabricObject) => void) => objects.forEach(visitor),
    toObject,
    loadFromJSON,
  } as unknown as fabric.Canvas;
  return {
    canvas,
    loadFromJSON,
    objects: () => objects,
    toObject,
  };
}

describe('editor history transactions', () => {
  afterEach(() => {
    useEditorStore.getState().cancelHistoryTransaction();
    useEditorStore.setState({
      activeTool: 'select',
      drawingMode: 'illustration',
      cadUnit: 'mm',
      canvas: null,
      canvasWidth: 800,
      canvasHeight: 600,
      backgroundColor: '#FFFFFF',
      gridVisible: false,
      gridSize: 20,
      snapToGrid: false,
      scale: '1:1',
      cadWidth: 10000,
      cadHeight: 8000,
      snapToObjects: false,
      showRulers: false,
      guides: [],
      snapToGuides: false,
      orthoMode: false,
      history: [],
      historyIndex: -1,
      isRestoring: false,
      revision: 0,
      _skipHistoryPush: false,
    });
    vi.restoreAllMocks();
  });

  it('reuses serialized objects for settings and compares only the settings payload', () => {
    const harness = createHistoryCanvas();
    useEditorStore.setState({
      canvas: harness.canvas,
      history: [],
      historyIndex: -1,
      gridVisible: false,
      snapToGrid: false,
    });
    const state = useEditorStore.getState();
    state.resetHistory();
    const initialObjects = useEditorStore.getState().history[0].objects;
    const stringify = vi.spyOn(JSON, 'stringify');

    state.toggleGrid();
    state.toggleSnap();

    const history = useEditorStore.getState().history;
    expect(harness.toObject).toHaveBeenCalledOnce();
    expect(history).toHaveLength(3);
    expect(history[1].objects).toBe(initialObjects);
    expect(history[2].objects).toBe(initialObjects);
    expect(history[2]).toMatchObject({ gridVisible: true, snapToGrid: true });
    expect(stringify.mock.calls.some(([value]) => (
      value === initialObjects
      || (
        typeof value === 'object'
        && value !== null
        && (value as { objects?: unknown }).objects === initialObjects
      )
    ))).toBe(false);
  });

  it('serializes once when a settings change has no initial history payload', () => {
    const harness = createHistoryCanvas();
    useEditorStore.setState({
      canvas: harness.canvas,
      history: [],
      historyIndex: -1,
      gridVisible: false,
      snapToGrid: false,
    });
    const state = useEditorStore.getState();

    state.toggleGrid();
    const initialObjects = useEditorStore.getState().history[0].objects;
    state.toggleSnap();

    const history = useEditorStore.getState().history;
    expect(harness.toObject).toHaveBeenCalledOnce();
    expect(history).toHaveLength(2);
    expect(history[1].objects).toBe(initialObjects);
  });

  it('undoes and redoes settings without reloading unchanged Fabric objects', async () => {
    const harness = createHistoryCanvas(12);
    useEditorStore.setState({
      canvas: harness.canvas,
      history: [],
      historyIndex: -1,
      gridVisible: false,
    });
    const state = useEditorStore.getState();
    state.resetHistory();
    state.toggleGrid();

    await state.undo();
    expect(useEditorStore.getState()).toMatchObject({ historyIndex: 0, gridVisible: false });
    expect(harness.loadFromJSON).not.toHaveBeenCalled();

    await state.redo();
    expect(useEditorStore.getState()).toMatchObject({ historyIndex: 1, gridVisible: true });
    expect(harness.loadFromJSON).not.toHaveBeenCalled();
    expect(harness.objects()[0].left).toBe(12);
  });

  it('rolls back an optimistic history index when its queued restore is skipped', async () => {
    const harness = createHistoryCanvas(10);
    useEditorStore.setState({
      canvas: harness.canvas,
      history: [snapshotAt(0), snapshotAt(10)],
      historyIndex: 1,
      isRestoring: false,
      _skipHistoryPush: false,
    });
    vi.spyOn(historyService, 'enqueue').mockResolvedValue({ status: 'skipped' });

    await useEditorStore.getState().undo();

    expect(useEditorStore.getState().historyIndex).toBe(1);
    expect(harness.loadFromJSON).not.toHaveBeenCalled();
  });

  it('coalesces settings-only transactions but serializes when objects also changed', () => {
    const harness = createHistoryCanvas();
    useEditorStore.setState({
      canvas: harness.canvas,
      history: [],
      historyIndex: -1,
      gridVisible: false,
      snapToGrid: false,
      orthoMode: false,
    });
    const state = useEditorStore.getState();
    state.resetHistory();
    const initialObjects = useEditorStore.getState().history[0].objects;

    state.beginHistoryTransaction();
    state.toggleGrid();
    state.toggleSnap();
    expect(useEditorStore.getState().history).toHaveLength(1);
    state.endHistoryTransaction();

    let history = useEditorStore.getState().history;
    expect(history).toHaveLength(2);
    expect(history[1].objects).toBe(initialObjects);
    expect(harness.toObject).toHaveBeenCalledOnce();

    state.beginHistoryTransaction();
    state.toggleOrtho();
    harness.objects()[0].set({ left: 42 });
    state.pushHistory();
    state.endHistoryTransaction();

    history = useEditorStore.getState().history;
    expect(history).toHaveLength(3);
    expect(history[2].objects).not.toBe(initialObjects);
    expect(history[2]).toMatchObject({ gridVisible: true, snapToGrid: true, orthoMode: true });
    expect((history[2].objects.objects[0] as { left?: number }).left).toBe(42);
    expect(harness.toObject).toHaveBeenCalledTimes(2);
  });

  it('keeps settings changes out of history while history is suspended', async () => {
    const harness = createHistoryCanvas();
    useEditorStore.setState({
      canvas: harness.canvas,
      history: [],
      historyIndex: -1,
      gridVisible: false,
    });
    const state = useEditorStore.getState();
    state.resetHistory();

    await historyService.withHistorySuspended(async () => state.toggleGrid());

    expect(useEditorStore.getState().gridVisible).toBe(true);
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(harness.toObject).toHaveBeenCalledOnce();
  });

  it('commits only the final Alt-clone opacity state', () => {
    const objects: fabric.FabricObject[] = [];
    const canvas = {
      getObjects: () => objects,
      forEachObject: (callback: (object: fabric.FabricObject) => void) => objects.forEach(callback),
      requestRenderAll: vi.fn(),
      toObject: (properties: string[]) => ({
        version: '7.4.0',
        objects: objects.map((object) => object.toObject(properties)),
      }),
    } as unknown as fabric.Canvas;
    useEditorStore.setState({
      canvas,
      history: [],
      historyIndex: -1,
      isRestoring: false,
      _skipHistoryPush: false,
    });
    const state = useEditorStore.getState();
    state.resetHistory();

    const clone = new fabric.Rect({ width: 20, height: 20, opacity: 1 });
    setFabricMetadataValues(clone, { id: 'clone', objectKind: 'rect' });
    state.beginHistoryTransaction();
    objects.push(clone);
    clone.set({ opacity: 0.5 });
    state.pushHistory();
    clone.set({ opacity: 1 });
    state.pushHistory();
    state.endHistoryTransaction();

    const history = useEditorStore.getState().history;
    expect(history).toHaveLength(2);
    const committedClone = history[1].objects.objects[0] as { opacity?: number };
    expect(committedClone.opacity).toBe(1);
    expect(history.some((snapshot) => (
      snapshot.objects.objects[0] as { opacity?: number } | undefined
    )?.opacity === 0.5)).toBe(false);
  });

  it('undoes an open gesture to its current baseline without skipping a history entry', async () => {
    let objects: fabric.FabricObject[] = [new fabric.Rect({ left: 10, width: 20, height: 20 })];
    const canvas = {
      upperCanvasEl: { style: {} },
      selection: true,
      getActiveObject: () => objects[0],
      discardActiveObject: vi.fn(),
      requestRenderAll: vi.fn(),
      getObjects: () => objects,
      forEachObject: (visitor: (object: fabric.FabricObject) => void) => objects.forEach(visitor),
      toObject: (properties: string[]) => ({
        version: '7.4.0',
        objects: objects.map((object) => object.toObject(properties)),
      }),
      loadFromJSON: vi.fn(async (data: { objects?: Array<{ left?: number }> }) => {
        objects = (data.objects ?? []).map((item) => new fabric.Rect({
          left: item.left ?? 0,
          width: 20,
          height: 20,
        }));
      }),
    } as unknown as fabric.Canvas;
    useEditorStore.setState({
      canvas,
      history: [snapshotAt(0), snapshotAt(10)],
      historyIndex: 1,
      isRestoring: false,
      _skipHistoryPush: false,
    });

    const state = useEditorStore.getState();
    state.beginHistoryTransaction();
    objects[0].set({ left: 20 });
    state.pushHistory();
    await state.undo();

    expect(useEditorStore.getState().historyIndex).toBe(1);
    expect(objects[0].left).toBe(10);
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(canvas.loadFromJSON).toHaveBeenCalledOnce();
  });
});
