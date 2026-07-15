import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fabric from 'fabric';
import { setFabricMetadataValues } from '../utils/fabricObjectMetadata';
import type { CanvasSnapshot } from '../utils/documentSerializer';
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

describe('editor history transactions', () => {
  afterEach(() => {
    useEditorStore.getState().cancelHistoryTransaction();
    useEditorStore.setState({
      canvas: null,
      history: [],
      historyIndex: -1,
      isRestoring: false,
      _skipHistoryPush: false,
    });
  });

  it('commits only the final Alt-clone opacity state', () => {
    const objects: fabric.FabricObject[] = [];
    const canvas = {
      getObjects: () => objects,
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
  });
});
