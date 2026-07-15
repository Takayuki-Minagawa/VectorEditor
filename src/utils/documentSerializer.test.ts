import * as fabric from 'fabric';
import { describe, expect, it, vi } from 'vitest';
import {
  DOCUMENT_VERSION,
  DocumentRestoreSupersededError,
  parseAutoSaveData,
  parseDocumentData,
  restoreDocumentData,
} from './documentSerializer';
import type { CanvasSnapshot } from './documentSerializer';
import {
  applyPersistentObjectState,
  FABRIC_CUSTOM_PROPERTIES,
  prepareObjectMetadataForSerialization,
  type FabricObjectWithMetadata,
} from './fabricObjectMetadata';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function legacyDocument(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    documentId: 'doc_legacy',
    version: 1,
    canvas: { width: 800, height: 600, backgroundColor: '#ffffff' },
    objects: JSON.stringify({
      version: '7.2.0',
      objects: [{ type: 'Rect', width: 20, height: 10 }],
    }),
    drawingMode: 'cad',
    cadUnit: 'mm',
    scale: '1:100',
    cadWidth: 10_000,
    cadHeight: 8_000,
    ...overrides,
  });
}

describe('document schema', () => {
  it('migrates v1 double-encoded Fabric JSON to the structured v2 schema', () => {
    const parsed = parseDocumentData(legacyDocument());

    expect(parsed.version).toBe(DOCUMENT_VERSION);
    expect(typeof parsed.objects).toBe('object');
    expect(parsed.objects.objects).toEqual([
      expect.objectContaining({ type: 'Rect', width: 20, height: 10 }),
    ]);
    expect(parsed).toMatchObject({
      gridVisible: false,
      gridSize: 20,
      snapToGrid: false,
      snapToObjects: false,
      showRulers: false,
      guides: [],
      snapToGuides: false,
      orthoMode: false,
    });
  });

  it('migrates an unversioned legacy autosave', () => {
    const raw = JSON.stringify({
      canvas: { width: 800, height: 600, backgroundColor: '#fff' },
      objects: JSON.stringify({ objects: [] }),
      savedAt: '2026-07-15T00:00:00.000Z',
    });

    const parsed = parseAutoSaveData(raw);
    expect(parsed.version).toBe(DOCUMENT_VERSION);
    expect(parsed.objects.objects).toEqual([]);
  });

  it.each([
    ['a future version', { version: 99 }],
    ['an invalid drawing mode', { drawingMode: 'sketch' }],
    ['a zero canvas width', { canvas: { width: 0, height: 600, backgroundColor: '#fff' } }],
    ['an unsupported CAD unit', { cadUnit: 'inch' }],
    ['an invalid scale', { scale: 'large' }],
  ])('rejects %s', (_label, overrides) => {
    expect(() => parseDocumentData(legacyDocument(overrides))).toThrow();
  });

  it('rejects malformed Fabric objects before loadFromJSON is called', () => {
    expect(() => parseDocumentData(legacyDocument({
      objects: JSON.stringify({ objects: [{ width: 20 }] }),
    }))).toThrow(/type/);
  });

  it('rolls the live document back when Fabric rejects a validated payload', async () => {
    const previous: CanvasSnapshot = {
      canvas: { width: 800, height: 600, backgroundColor: '#ffffff' },
      objects: { objects: [] },
      drawingMode: 'illustration',
    };
    const incoming: CanvasSnapshot = {
      canvas: { width: 321, height: 240, backgroundColor: '#abcdef' },
      objects: { objects: [{ type: 'DefinitelyMissingClass' }] },
      drawingMode: 'cad',
    };
    const loadFromJSON = vi.fn()
      .mockImplementationOnce(async () => { throw new Error('No class registered'); })
      .mockResolvedValueOnce(undefined);
    const canvas = {
      renderOnAddRemove: true,
      loadFromJSON,
      getObjects: () => [],
      requestRenderAll: vi.fn(),
    } as unknown as fabric.Canvas;
    const settings = { width: 800, height: 600, background: '#ffffff', mode: 'illustration' };

    await expect(restoreDocumentData(canvas, incoming, {
      setCanvasSize: (width, height) => Object.assign(settings, { width, height }),
      setBackgroundColor: (background) => Object.assign(settings, { background }),
      setDrawingMode: (mode) => Object.assign(settings, { mode }),
      setCadUnit: vi.fn(),
      setScale: vi.fn(),
      setCadSize: vi.fn(),
    }, { rollbackSnapshot: previous })).rejects.toThrow('No class registered');

    expect(loadFromJSON).toHaveBeenCalledTimes(2);
    expect(settings).toMatchObject({
      width: 800,
      height: 600,
      background: '#ffffff',
      mode: 'illustration',
    });
    expect(canvas.renderOnAddRemove).toBe(true);
  });

  it('does not let an older failed restore roll back a newer successful document', async () => {
    const previous: CanvasSnapshot = {
      canvas: { width: 800, height: 600, backgroundColor: '#ffffff' },
      objects: { objects: [] },
      drawingMode: 'illustration',
    };
    const failing: CanvasSnapshot = {
      canvas: { width: 320, height: 240, backgroundColor: '#ff0000' },
      objects: { objects: [] },
      drawingMode: 'cad',
    };
    const replacement: CanvasSnapshot = {
      canvas: { width: 1024, height: 768, backgroundColor: '#00ff00' },
      objects: { objects: [] },
      drawingMode: 'illustration',
    };
    const firstLoad = deferred<void>();
    const loadFromJSON = vi.fn()
      .mockImplementationOnce(() => firstLoad.promise)
      .mockResolvedValueOnce(undefined);
    const canvas = {
      renderOnAddRemove: true,
      loadFromJSON,
      getObjects: () => [],
      requestRenderAll: vi.fn(),
    } as unknown as fabric.Canvas;
    const settings = { width: 800, height: 600, background: '#ffffff', mode: 'illustration' };
    const actions = {
      setCanvasSize: (width: number, height: number) => Object.assign(settings, { width, height }),
      setBackgroundColor: (background: string) => Object.assign(settings, { background }),
      setDrawingMode: (mode: 'illustration' | 'cad') => Object.assign(settings, { mode }),
      setCadUnit: vi.fn(),
      setScale: vi.fn(),
      setCadSize: vi.fn(),
    };

    const failedRestore = restoreDocumentData(
      canvas,
      failing,
      actions,
      { rollbackSnapshot: previous },
    );
    while (loadFromJSON.mock.calls.length === 0) await Promise.resolve();

    firstLoad.reject(new Error('A failed'));
    let replacementRestore: Promise<void> | undefined;
    queueMicrotask(() => queueMicrotask(() => {
      replacementRestore = restoreDocumentData(
        canvas,
        replacement,
        actions,
        { rollbackSnapshot: previous },
      );
    }));

    await expect(failedRestore).rejects.toBeInstanceOf(DocumentRestoreSupersededError);
    while (!replacementRestore) await Promise.resolve();
    await replacementRestore;

    expect(loadFromJSON).toHaveBeenCalledTimes(2);
    expect(settings).toMatchObject({
      width: 1024,
      height: 768,
      background: '#00ff00',
      mode: 'illustration',
    });
  });
});

describe('Fabric document metadata', () => {
  it('does not persist transient selectable/evented flags', () => {
    expect(FABRIC_CUSTOM_PROPERTIES).not.toContain('selectable');
    expect(FABRIC_CUSTOM_PROPERTIES).not.toContain('evented');

    const rect = new fabric.Rect({ selectable: false, evented: false, lockMovementX: true });
    (rect as FabricObjectWithMetadata).objectKind = 'column';
    prepareObjectMetadataForSerialization(rect);
    const toObject = rect.toObject.bind(rect) as unknown as (
      properties: string[],
    ) => Record<string, unknown>;
    const serialized = toObject([...FABRIC_CUSTOM_PROPERTIES]);

    expect(serialized).not.toHaveProperty('selectable');
    expect(serialized).not.toHaveProperty('evented');
    expect(serialized).toMatchObject({ objectKind: 'column', locked: true });
  });

  it('derives Fabric lock and interaction flags from persistent metadata', () => {
    const rect = new fabric.Rect({ selectable: false, evented: false });
    (rect as FabricObjectWithMetadata).locked = true;

    applyPersistentObjectState(rect);

    expect(rect.selectable).toBe(true);
    expect(rect.evented).toBe(true);
    expect(rect.lockMovementX).toBe(true);
    expect(rect.lockScalingY).toBe(true);
    expect(rect.hasControls).toBe(false);
  });
});
