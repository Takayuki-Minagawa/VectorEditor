import * as fabric from 'fabric';
import { describe, expect, it, vi } from 'vitest';
import type { SectionProfileData } from '../domain/section';
import {
  DOCUMENT_VERSION,
  DocumentRestoreSupersededError,
  parseAutoSaveData,
  parseDocumentData,
  restoreCanvasObjects,
  restoreDocumentData,
} from './documentSerializer';
import type { CanvasSnapshot } from './documentSerializer';
import { historyService } from './historyService';
import {
  applyPersistentObjectState,
  FABRIC_CUSTOM_PROPERTIES,
  getFabricMetadata,
  prepareObjectMetadataForSerialization,
  setFabricMetadataValues,
  type FabricObjectWithMetadata,
} from './fabricObjectMetadata';

const sectionProfile: SectionProfileData = {
  version: 1,
  analysisToleranceMm: 0.01,
  approximate: false,
  rings: [{
    role: 'outer',
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ],
  }],
};

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

function currentDocument(objects: unknown[]): string {
  return JSON.stringify({
    documentId: 'doc_current',
    version: DOCUMENT_VERSION,
    canvas: { width: 800, height: 600, backgroundColor: '#ffffff' },
    objects: { version: '7.2.0', objects },
    drawingMode: 'cad',
    cadUnit: 'mm',
    scale: '1:1',
    cadWidth: 800,
    cadHeight: 600,
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

  it('round-trips section metadata through the current autosave schema', () => {
    const parsed = parseAutoSaveData(currentDocument([{
      type: 'Path',
      objectKind: 'sectionProfile',
      sectionProfileData: sectionProfile,
    }]));

    expect(parsed.objects.objects[0]).toMatchObject({
      objectKind: 'sectionProfile',
      sectionProfileData: sectionProfile,
    });
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

  it('round-trips section profile metadata through the current document schema', () => {
    const parsed = parseDocumentData(currentDocument([{
      type: 'Rect',
      objectKind: 'sectionProfile',
      sectionProfileData: sectionProfile,
    }]));

    expect(parsed.objects.objects).toEqual([expect.objectContaining({
      objectKind: 'sectionProfile',
      sectionProfileData: sectionProfile,
    })]);
  });

  it('requires section object kind and profile metadata to appear together', () => {
    expect(() => parseDocumentData(currentDocument([{
      type: 'Path',
      objectKind: 'sectionProfile',
    }]))).toThrow(/sectionProfileData is required/);

    expect(() => parseDocumentData(currentDocument([{
      type: 'Path',
      sectionProfileData: sectionProfile,
    }]))).toThrow(/objectKind must be sectionProfile/);
  });

  it('applies the generic depth budget before recursively inspecting group metadata', () => {
    let object: Record<string, unknown> = { type: 'Rect' };
    for (let depth = 0; depth < 110; depth += 1) {
      object = { type: 'Group', objects: [object] };
    }

    expect(() => parseDocumentData(currentDocument([object]))).toThrow(/nested too deeply/);
  });

  it('rejects structurally invalid section profile metadata', () => {
    expect(() => parseDocumentData(currentDocument([{
      type: 'Rect',
      sectionProfileData: { ...sectionProfile, approximate: 'yes' },
    }]))).toThrow(/sectionProfileData is invalid.*boolean/);
  });

  it('rejects section metadata with a hole outside its material boundary', () => {
    expect(() => parseDocumentData(currentDocument([{
      type: 'Path',
      objectKind: 'sectionProfile',
      sectionProfileData: {
        ...sectionProfile,
        rings: [
          ...sectionProfile.rings,
          {
            role: 'hole',
            points: [
              { x: 200, y: 200 },
              { x: 200, y: 210 },
              { x: 210, y: 210 },
              { x: 210, y: 200 },
            ],
          },
        ],
      },
    }]))).toThrow(/hole must be contained/);
  });

  it('rejects non-finite section coordinates before Fabric enlivening', () => {
    const raw = currentDocument([{
      type: 'Rect',
      sectionProfileData: {
        ...sectionProfile,
        rings: [{
          role: 'outer',
          points: [
            { x: '__NON_FINITE__', y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 50 },
          ],
        }],
      },
    }]).replace('"__NON_FINITE__"', '1e309');

    expect(() => parseDocumentData(raw)).toThrow(/sectionProfileData.*non-finite/);
  });

  it('rejects section profiles that exceed the ring or point budgets', () => {
    const ring = sectionProfile.rings[0];
    const excessiveRings = Array.from({ length: 10_001 }, () => ring);
    expect(() => parseDocumentData(currentDocument([{
      type: 'Rect',
      sectionProfileData: { ...sectionProfile, rings: excessiveRings },
    }]))).toThrow(/too many rings/);

    const excessivePoints = Array.from({ length: 100_001 }, () => ({ x: 0, y: 0 }));
    expect(() => parseDocumentData(currentDocument([{
      type: 'Rect',
      sectionProfileData: {
        ...sectionProfile,
        rings: [{ role: 'outer', points: excessivePoints }],
      },
    }]))).toThrow(/too many points/);
  });

  it('rejects section coordinates outside the supported CAD range', () => {
    expect(() => parseDocumentData(currentDocument([{
      type: 'Rect',
      sectionProfileData: {
        ...sectionProfile,
        rings: [{
          role: 'outer',
          points: [
            { x: 0, y: 0 },
            { x: 1_000_000_001, y: 0 },
            { x: 100, y: 50 },
          ],
        }],
      },
    }]))).toThrow(/coordinate is outside the supported range/);
  });

  it('accepts optional undefined Fabric properties in an in-memory history payload', async () => {
    const loadFromJSON = vi.fn().mockResolvedValue(undefined);
    const canvas = {
      renderOnAddRemove: true,
      loadFromJSON,
      getObjects: () => [],
      requestRenderAll: vi.fn(),
    } as unknown as fabric.Canvas;

    await restoreCanvasObjects(canvas, {
      objects: [{ type: 'Rect', strokeDashArray: undefined }],
    });

    expect(loadFromJSON).toHaveBeenCalledOnce();
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

  it('does not let a completed older restore publish after a newer restore takes ownership', async () => {
    const first: CanvasSnapshot = {
      canvas: { width: 320, height: 240, backgroundColor: '#ff0000' },
      objects: { objects: [] },
      drawingMode: 'cad',
    };
    const replacement: CanvasSnapshot = {
      canvas: { width: 1024, height: 768, backgroundColor: '#00ff00' },
      objects: { objects: [] },
      drawingMode: 'illustration',
    };
    const canvas = {
      renderOnAddRemove: true,
      loadFromJSON: vi.fn().mockResolvedValue(undefined),
      getObjects: () => [],
      requestRenderAll: vi.fn(),
    } as unknown as fabric.Canvas;
    const actions = {
      setCanvasSize: vi.fn(),
      setBackgroundColor: vi.fn(),
      setDrawingMode: vi.fn(),
      setCadUnit: vi.fn(),
      setScale: vi.fn(),
      setCadSize: vi.fn(),
    };
    const notify = vi.spyOn(historyService, 'notifyDocumentRestored');
    let armed = false;
    let replacementRestore: Promise<void> | undefined;

    historyService.setRestoringListener((restoring) => {
      if (armed && !restoring && !replacementRestore) {
        replacementRestore = restoreDocumentData(canvas, replacement, actions);
      }
    });
    armed = true;

    try {
      await expect(restoreDocumentData(canvas, first, actions))
        .rejects.toBeInstanceOf(DocumentRestoreSupersededError);
      expect(replacementRestore).toBeDefined();
      await replacementRestore;

      expect(notify).toHaveBeenCalledOnce();
      expect(notify.mock.calls[0][0]).toMatchObject({
        canvas: replacement.canvas,
        drawingMode: replacement.drawingMode,
      });
    } finally {
      historyService.setRestoringListener(null);
      notify.mockRestore();
    }
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

  it('preserves detached section profile metadata through Fabric enlivening', async () => {
    const rect = new fabric.Rect({ width: 100, height: 50 });
    setFabricMetadataValues(rect, {
      objectKind: 'sectionProfile',
      sectionProfileData: sectionProfile,
    });
    const toObject = rect.toObject.bind(rect) as unknown as (
      properties: string[],
    ) => Record<string, unknown>;
    const serialized = toObject([...FABRIC_CUSTOM_PROPERTIES]);
    const transported = JSON.parse(JSON.stringify(serialized)) as unknown;

    const [restored] = await fabric.util.enlivenObjects<fabric.FabricObject>([transported]);

    expect(getFabricMetadata(restored)).toMatchObject({
      objectKind: 'sectionProfile',
      sectionProfileData: sectionProfile,
    });
    expect(getFabricMetadata(restored).sectionProfileData).not.toBe(sectionProfile);
  });

  it('preserves section profile metadata when Fabric objects are cloned', async () => {
    const rect = new fabric.Rect({ width: 100, height: 50 });
    setFabricMetadataValues(rect, {
      objectKind: 'sectionProfile',
      sectionProfileData: sectionProfile,
    });

    const cloned = await rect.clone();

    expect(getFabricMetadata(cloned)).toMatchObject({
      objectKind: 'sectionProfile',
      sectionProfileData: sectionProfile,
    });
  });
});
