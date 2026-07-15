import { describe, expect, it, vi } from 'vitest';
import * as fabric from 'fabric';
import {
  deleteSelected,
  duplicateActive,
  executeCanvasCommand,
  executeCanvasTransaction,
  groupSelection,
  moveActiveBy,
  stackActive,
  toggleActiveLock,
  ungroupActive,
} from './canvasCommands';
import { getFabricMetadata, setFabricMetadataValues } from './fabricObjectMetadata';
import { historyService } from './historyService';
import { createSemanticConnector } from './semanticObjects';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function commandContext() {
  const requestRenderAll = vi.fn();
  const pushHistory = vi.fn();
  const canvas = { requestRenderAll, getObjects: () => [] } as unknown as fabric.Canvas;
  return { canvas, requestRenderAll, pushHistory };
}

describe('canvas command transactions', () => {
  it('commits render and history exactly once after a synchronous mutation', () => {
    const context = commandContext();
    const result = executeCanvasCommand(context, () => 'changed');

    expect(result).toBe('changed');
    expect(context.requestRenderAll).toHaveBeenCalledTimes(1);
    expect(context.pushHistory).toHaveBeenCalledTimes(1);
  });

  it('does not commit when a command reports no change or throws', () => {
    const unchanged = commandContext();
    expect(executeCanvasCommand(unchanged, () => false)).toBe(false);
    expect(unchanged.requestRenderAll).not.toHaveBeenCalled();
    expect(unchanged.pushHistory).not.toHaveBeenCalled();

    const failed = commandContext();
    expect(() => executeCanvasCommand(failed, () => {
      throw new Error('mutation failed');
    })).toThrow('mutation failed');
    expect(failed.requestRenderAll).not.toHaveBeenCalled();
    expect(failed.pushHistory).not.toHaveBeenCalled();
  });

  it('waits for async work before committing', async () => {
    const context = commandContext();
    const mutation = vi.fn(async () => 42);

    await expect(executeCanvasCommand(context, mutation)).resolves.toBe(42);
    expect(context.requestRenderAll).toHaveBeenCalledTimes(1);
    expect(context.pushHistory).toHaveBeenCalledTimes(1);
  });

  it('groups multiple low-level mutations into one transaction commit', () => {
    const context = commandContext();
    const mutations: string[] = [];
    executeCanvasTransaction(context, () => {
      mutations.push('one');
      mutations.push('two');
      return true;
    });

    expect(mutations).toEqual(['one', 'two']);
    expect(context.requestRenderAll).toHaveBeenCalledTimes(1);
    expect(context.pushHistory).toHaveBeenCalledTimes(1);
  });

  it('refreshes linked objects before recording a programmatic move', () => {
    const source = new fabric.Rect({ left: 50, top: 50, width: 20, height: 20 });
    setFabricMetadataValues(source, { id: 'source', objectKind: 'rect' });
    source.setCoords();
    const initialCenter = source.getCenterPoint();
    const connector = createSemanticConnector({
      from: { ...initialCenter, objectId: 'source', anchor: 'center' },
      to: { x: 200, y: 50 },
      route: 'straight',
    })!;
    const pushHistory = vi.fn();
    const canvas = {
      getActiveObject: () => source,
      getObjects: () => [source, connector],
      requestRenderAll: vi.fn(),
    } as unknown as fabric.Canvas;

    expect(moveActiveBy(canvas, 10, 15, pushHistory)).toBe(true);
    expect(getFabricMetadata(connector).connectorData?.from).toMatchObject({
      x: initialCenter.x + 10,
      y: initialCenter.y + 15,
    });
    expect(pushHistory).toHaveBeenCalledOnce();
  });

  it('propagates every child ID when moving an ActiveSelection', () => {
    const first = new fabric.Rect({ left: 20, top: 20, width: 20, height: 20 });
    const second = new fabric.Rect({ left: 80, top: 30, width: 20, height: 20 });
    setFabricMetadataValues(first, { id: 'selected-first', objectKind: 'rect' });
    setFabricMetadataValues(second, { id: 'selected-second', objectKind: 'rect' });
    const selection = new fabric.ActiveSelection([first, second]);
    const firstConnector = createSemanticConnector({
      from: { ...first.getCenterPoint(), objectId: 'selected-first', anchor: 'center' },
      to: { x: 20, y: 120 },
      route: 'straight',
    })!;
    const secondConnector = createSemanticConnector({
      from: { ...second.getCenterPoint(), objectId: 'selected-second', anchor: 'center' },
      to: { x: 80, y: 120 },
      route: 'straight',
    })!;
    const canvas = {
      getActiveObject: () => selection,
      getObjects: () => [first, second, firstConnector, secondConnector],
      requestRenderAll: vi.fn(),
    } as unknown as fabric.Canvas;

    expect(moveActiveBy(canvas, 15, 10, vi.fn())).toBe(true);
    expect(getFabricMetadata(firstConnector).connectorData?.from)
      .toMatchObject({ x: 35, y: 30 });
    expect(getFabricMetadata(secondConnector).connectorData?.from)
      .toMatchObject({ x: 95, y: 40 });
  });

  it('expands a deeply nested changed group only once', () => {
    const leaf = new fabric.Rect({ left: 10, top: 10, width: 10, height: 10 });
    setFabricMetadataValues(leaf, { objectKind: 'rect' });
    const nestedObjects: fabric.FabricObject[] = [leaf];
    let root: fabric.FabricObject = leaf;
    for (let depth = 0; depth < 40; depth += 1) {
      root = new fabric.Group([root]);
      setFabricMetadataValues(root, { objectKind: 'group' });
      nestedObjects.push(root);
    }
    const idReads = nestedObjects.map(() => 0);
    nestedObjects.forEach((object, index) => {
      Object.defineProperty(object, 'id', {
        configurable: true,
        get: () => {
          idReads[index] += 1;
          return `nested-${index}`;
        },
      });
    });
    const initialCenter = leaf.getCenterPoint();
    const connector = createSemanticConnector({
      from: { ...initialCenter, objectId: 'nested-0', anchor: 'center' },
      to: { x: initialCenter.x + 100, y: initialCenter.y },
      route: 'straight',
    })!;
    const canvas = {
      getActiveObject: () => root,
      getObjects: () => [root, connector],
      requestRenderAll: vi.fn(),
    } as unknown as fabric.Canvas;

    expect(moveActiveBy(canvas, 5, 7, vi.fn())).toBe(true);
    const movedCenter = leaf.getCenterPoint();
    expect(getFabricMetadata(connector).connectorData?.from.x).toBeCloseTo(movedCenter.x);
    expect(getFabricMetadata(connector).connectorData?.from.y).toBeCloseTo(movedCenter.y);
    // One root-ID read in the command, then one index pass and one subtree
    // expansion, plus a constant number of reads while deriving leaf snap
    // candidates. Passing every descendant ID would grow toward O(N * depth).
    expect(idReads.reduce((total, reads) => total + reads, 0))
      .toBeLessThanOrEqual(nestedObjects.length * 2 + 16);
  });

  it('skips semantic tree work for stacking and lock-only commands', () => {
    const active = new fabric.Rect({ width: 20, height: 20 });
    const getObjects = vi.fn(() => [active]);
    const stackCanvas = {
      getActiveObject: () => active,
      getObjects,
      bringObjectForward: vi.fn(),
      requestRenderAll: vi.fn(),
    } as unknown as fabric.Canvas;
    const stackHistory = vi.fn();

    expect(stackActive(stackCanvas, 'bringForward', stackHistory)).toBe(true);
    expect(getObjects).not.toHaveBeenCalled();
    expect(stackHistory).toHaveBeenCalledOnce();

    const lockCanvas = {
      getActiveObject: () => active,
      getObjects,
      requestRenderAll: vi.fn(),
    } as unknown as fabric.Canvas;
    const lockHistory = vi.fn();
    expect(toggleActiveLock(lockCanvas, lockHistory)).toBe(true);
    expect(getObjects).not.toHaveBeenCalled();
    expect(lockHistory).toHaveBeenCalledOnce();
  });

  it('keeps linked fallback geometry stable when deleting multiple sources', () => {
    const first = new fabric.Rect({ left: 20, top: 20, width: 20, height: 20 });
    const second = new fabric.Rect({ left: 80, top: 30, width: 20, height: 20 });
    setFabricMetadataValues(first, { id: 'delete-first', objectKind: 'rect' });
    setFabricMetadataValues(second, { id: 'delete-second', objectKind: 'rect' });
    const connector = createSemanticConnector({
      from: { ...first.getCenterPoint(), objectId: 'delete-first', anchor: 'center' },
      to: { ...second.getCenterPoint(), objectId: 'delete-second', anchor: 'center' },
      route: 'straight',
    })!;
    const roots: fabric.FabricObject[] = [first, second, connector];
    const canvas = {
      getActiveObjects: () => [first, second],
      getObjects: () => roots,
      remove: vi.fn((object: fabric.FabricObject) => {
        const index = roots.indexOf(object);
        if (index >= 0) roots.splice(index, 1);
      }),
      discardActiveObject: vi.fn(),
      requestRenderAll: vi.fn(),
    } as unknown as fabric.Canvas;
    const pushHistory = vi.fn();

    expect(deleteSelected(canvas, pushHistory)).toBe(true);
    expect(getFabricMetadata(connector).connectorData).toMatchObject({
      from: { x: 20, y: 20, objectId: 'delete-first' },
      to: { x: 80, y: 30, objectId: 'delete-second' },
    });
    expect(pushHistory).toHaveBeenCalledOnce();
  });

  it('preserves child-linked connector geometry across group and ungroup', () => {
    const source = new fabric.Rect({ left: 20, top: 20, width: 20, height: 20 });
    const peer = new fabric.Rect({ left: 80, top: 30, width: 20, height: 20 });
    setFabricMetadataValues(source, { id: 'group-source', objectKind: 'rect' });
    setFabricMetadataValues(peer, { id: 'group-peer', objectKind: 'rect' });
    const connector = createSemanticConnector({
      from: { ...source.getCenterPoint(), objectId: 'group-source', anchor: 'center' },
      to: { x: 150, y: 100 },
      route: 'straight',
    })!;
    const selection = new fabric.ActiveSelection([source, peer]);
    const roots: fabric.FabricObject[] = [source, peer, connector];
    let active: fabric.FabricObject = selection;
    const canvas = {
      getActiveObject: () => active,
      getObjects: () => roots,
      remove: vi.fn((object: fabric.FabricObject) => {
        const index = roots.indexOf(object);
        if (index >= 0) roots.splice(index, 1);
      }),
      add: vi.fn((object: fabric.FabricObject) => roots.push(object)),
      setActiveObject: vi.fn((object: fabric.FabricObject) => {
        active = object;
      }),
      discardActiveObject: vi.fn(),
      fire: vi.fn(),
      requestRenderAll: vi.fn(),
    } as unknown as fabric.Canvas;
    const pushHistory = vi.fn();

    expect(groupSelection(canvas, pushHistory)).toBe(true);
    expect(active).toBeInstanceOf(fabric.Group);
    expect(getFabricMetadata(connector).connectorData?.from)
      .toMatchObject({ x: 20, y: 20 });

    expect(ungroupActive(canvas, pushHistory)).toBe(true);
    expect(active).toBeInstanceOf(fabric.ActiveSelection);
    expect(getFabricMetadata(connector).connectorData?.from)
      .toMatchObject({ x: 20, y: 20 });
    expect(pushHistory).toHaveBeenCalledTimes(2);
  });

  it('discards an asynchronous clone that began before a document restore', async () => {
    const source = new fabric.Rect({ width: 20, height: 20 });
    const clone = new fabric.Rect({ width: 20, height: 20 });
    const cloneReady = deferred<fabric.Rect>();
    vi.spyOn(source, 'clone').mockImplementation(() => cloneReady.promise);
    const dispose = vi.spyOn(clone, 'dispose');
    const canvas = {
      destroyed: false,
      disposed: false,
      getActiveObject: () => source,
      getObjects: () => [],
      add: vi.fn(),
      setActiveObject: vi.fn(),
      requestRenderAll: vi.fn(),
    } as unknown as fabric.Canvas;
    const pushHistory = vi.fn();

    expect(duplicateActive(canvas, pushHistory)).toBe(true);
    await historyService.runDocumentRestore(async () => undefined);
    cloneReady.resolve(clone);
    await Promise.resolve();
    await Promise.resolve();

    expect(dispose).toHaveBeenCalledOnce();
    expect(canvas.add).not.toHaveBeenCalled();
    expect(canvas.requestRenderAll).not.toHaveBeenCalled();
    expect(pushHistory).not.toHaveBeenCalled();
  });
});
