import { describe, expect, it, vi } from 'vitest';
import * as fabric from 'fabric';
import {
  duplicateActive,
  executeCanvasCommand,
  executeCanvasTransaction,
  moveActiveBy,
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
