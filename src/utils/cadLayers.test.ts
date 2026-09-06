import * as fabric from 'fabric';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CAD_LAYER, defaultCadLayers, validateCadLayers, type CadLayer } from '../domain/cadLayer';
import { applyCadLayers, assignCadLayer, canonicalizeSerializedLayers, filterPrintableObjects, isCadLayerLocked, makeLayerStyleIndividual, mergeObjectLayers, setCanvasLayerContext } from './cadLayers';
import { getFabricMetadata, setFabricMetadataValues } from './fabricObjectMetadata';
import { configureCanvasForTool } from './toolActivation';
import { parseDocumentData, serializeCanvasObjects, restoreCanvasObjects } from './documentSerializer';
import { createExportArtifact } from '../services/exportService';

const canvases: fabric.Canvas[] = [];
function setup() {
  const canvas = new fabric.Canvas(document.createElement('canvas'), { width: 800, height: 600 }); canvases.push(canvas);
  let layers: CadLayer[] = [...defaultCadLayers(), { ...DEFAULT_CAD_LAYER, id: 'walls', name: 'Walls', color: '#ff0000', lineType: 'dashed', lineWidth: 2 }];
  const replace = (next: CadLayer[]) => { layers = next; setCanvasLayerContext(canvas, { layers, activeId: 'walls', replace }); applyCadLayers(canvas); configureCanvasForTool(canvas, 'select'); };
  replace(layers); return { canvas, replace, layers: () => layers };
}
afterEach(async () => { await Promise.all(canvases.splice(0).map((canvas) => canvas.dispose())); });
describe('CAD layer presentation and persistence', () => {
  it('restores SVG gradients after a ByLayer save/load cycle', async () => {
    const { canvas } = setup();
    const gradient = new fabric.Gradient({ type: 'linear', coords: { x1: 0, y1: 0, x2: 100, y2: 0 }, colorStops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] });
    const rect = new fabric.Rect({ width: 100, height: 100, fill: gradient, stroke: gradient });
    assignCadLayer([rect], 'walls', 'layer'); canvas.add(rect); applyCadLayers(canvas);
    await restoreCanvasObjects(canvas, serializeCanvasObjects(canvas));
    const restored = canvas.getObjects()[0]; makeLayerStyleIndividual([restored], true);
    expect(restored.fill).toBeInstanceOf(fabric.Gradient); expect(restored.stroke).toBeInstanceOf(fabric.Gradient);
    expect((restored.stroke as fabric.Gradient<'linear'>).colorStops).toEqual(gradient.colorStops);
  });
  it('updates ByLayer objects without overwriting individual styles and restores the previous style', () => {
    const { canvas, layers, replace } = setup();
    const inherited = new fabric.Rect({ width: 20, height: 10, stroke: '#00ff00', strokeWidth: 3 });
    const individual = new fabric.Rect({ width: 20, height: 10, stroke: '#0000ff', strokeWidth: 4 });
    canvas.add(inherited, individual); assignCadLayer([inherited], 'walls', 'layer'); assignCadLayer([individual], 'walls', 'object');
    applyCadLayers(canvas);
    expect(inherited.stroke).toBe('#ff0000'); expect(inherited.strokeDashArray).toEqual([8, 4]); expect(individual.stroke).toBe('#0000ff');
    replace(layers().map((l) => ({ ...l, color: '#00ffff' })));
    expect(inherited.stroke).toBe('#00ffff'); expect(individual.stroke).toBe('#0000ff');
    makeLayerStyleIndividual([inherited], true); applyCadLayers(canvas);
    expect(inherited.stroke).toBe('#00ff00'); expect(inherited.strokeWidth).toBe(3);
  });
  it('keeps effective layer visibility and lock out of the persistent object flags', async () => {
    const { canvas, layers, replace } = setup();
    const rect = new fabric.Rect({ width: 20, height: 20 }); assignCadLayer([rect], 'walls', 'layer'); canvas.add(rect);
    replace(layers().map((l) => l.id === 'walls' ? { ...l, visible: false, locked: true } : l));
    expect(rect.visible).toBe(false); expect(rect.lockMovementX).toBe(true); expect(getFabricMetadata(rect).locked).toBe(false);
    const payload = serializeCanvasObjects(canvas);
    expect(payload.objects[0]).toMatchObject({ visible: true, locked: false, cadVisible: true });
    await restoreCanvasObjects(canvas, payload);
    expect(canvas.getObjects()[0].visible).toBe(false); expect(isCadLayerLocked(canvas.getObjects()[0])).toBe(true);
    replace(layers().map((l) => ({ ...l, visible: true, locked: false })));
    expect(canvas.getObjects()[0].visible).toBe(true); expect(canvas.getObjects()[0].lockMovementX).toBe(false); expect(canvas.getObjects()[0].selectable).toBe(true);
  });
  it('protects mixed-layer groups while keeping sibling layer locks independent', () => {
    const { canvas, layers, replace } = setup();
    const a = new fabric.Rect({ width: 20, height: 20 }); const b = new fabric.Rect({ left: 100, width: 20, height: 20 });
    assignCadLayer([a], 'walls', 'layer'); assignCadLayer([b], '0', 'object');
    const group = new fabric.Group([a, b]); canvas.add(group);
    replace(layers().map((l) => l.id === 'walls' ? { ...l, locked: true } : l));
    expect(isCadLayerLocked(group)).toBe(true); expect(isCadLayerLocked(a)).toBe(true); expect(isCadLayerLocked(b)).toBe(false);
    expect(getFabricMetadata(group).locked).toBe(false);
    replace(layers().map((l) => ({ ...l, locked: false })));
    expect(group.lockMovementX).toBe(false);
  });
  it('preserves an object-level hidden state when a layer is shown again', () => {
    const { canvas, layers, replace } = setup();
    const hidden = new fabric.Rect({ width: 10, height: 10, visible: false }); assignCadLayer([hidden], 'walls', 'layer'); canvas.add(hidden);
    replace(layers().map((l) => ({ ...l, visible: false })));
    replace(layers().map((l) => ({ ...l, visible: true })));
    expect(hidden.visible).toBe(false);
  });
  it('merges imported material layers by definition and renames conflicting names', () => {
    const { canvas, layers } = setup();
    const matching = new fabric.Rect(); assignCadLayer([matching], 'source', 'layer');
    mergeObjectLayers(canvas, [matching], [{ ...layers()[1], id: 'source' }]);
    expect(getFabricMetadata(matching).cadLayerId).toBe('walls'); expect(layers()).toHaveLength(2);
    const conflicting = new fabric.Rect(); assignCadLayer([conflicting], 'source', 'layer');
    mergeObjectLayers(canvas, [conflicting], [{ ...layers()[1], id: 'source', color: '#0000ff' }]);
    expect(layers()[2]).toMatchObject({ name: 'Walls (2)', color: '#0000ff' }); expect(getFabricMetadata(conflicting).cadLayerId).toBe(layers()[2].id);
  });
  it.each([1, 2])('migrates schema v%s and rejects invalid new references', (version) => {
    const objects = { objects: [{ type: 'Rect', width: 10, height: 20 }] };
    const legacy = { version, documentId: 'legacy', canvas: { width: 800, height: 600, backgroundColor: '#fff' }, objects: version === 1 ? JSON.stringify(objects) : objects };
    const document = parseDocumentData(JSON.stringify(legacy));
    expect(document.version).toBe(3); expect(document.cadLayers).toEqual(defaultCadLayers());
    document.objects.objects[0] = { ...objects.objects[0], cadLayerId: 'unknown' };
    expect(() => parseDocumentData(JSON.stringify(document))).toThrow(/Unknown CAD layer/);
    expect(() => parseDocumentData(JSON.stringify({ ...document, cadLayers: undefined }))).toThrow(/table is required/);
  });
  it('filters non-printable descendants without mutating the serialized document', () => {
    const objects = [{ type: 'Group', objects: [{ type: 'Rect', cadLayerId: 'walls', cadVisible: true, visible: false }, { type: 'Circle', cadLayerId: '0' }] }];
    canonicalizeSerializedLayers(objects);
    const filtered = filterPrintableObjects(objects, [...defaultCadLayers(), { ...DEFAULT_CAD_LAYER, id: 'walls', name: 'Walls', printable: false }]) as typeof objects;
    expect(filtered[0].objects).toHaveLength(1); expect(objects[0].objects).toHaveLength(2); expect(objects[0].objects[0].visible).toBe(true);
  });
  it('exports a mixed-layer group without moving its printable child', async () => {
    const { canvas, layers, replace } = setup();
    const a = new fabric.Rect({ left: 100, top: 100, width: 30, height: 20, fill: '#ff0000', strokeWidth: 0 });
    const b = new fabric.Rect({ left: 300, top: 200, width: 20, height: 10, fill: '#0000ff', strokeWidth: 0 });
    assignCadLayer([a], 'walls', 'object'); assignCadLayer([b], '0', 'object');
    const group = new fabric.Group([a, b]); canvas.add(group); replace(layers().map((l) => l.id === 'walls' ? { ...l, printable: false } : l));
    const before = b.getCenterPoint();
    const result = await createExportArtifact({ canvas, format: 'svg', scope: 'canvas', drawingMode: 'illustration', documentWidth: 800, documentHeight: 600, cadWidth: 800, cadHeight: 600, margin: 0, multiplier: 1, background: null, fileName: 'layers' });
    const svg = await result.blob.text();
    const loaded = await fabric.loadSVGFromString(svg);
    const exported = loaded.objects.filter((o): o is fabric.FabricObject => !!o);
    expect(exported).toHaveLength(1); expect(exported[0].fill).toBe('rgb(0,0,255)');
    expect(exported[0].getCenterPoint().x).toBeCloseTo(before.x, 4); expect(exported[0].getCenterPoint().y).toBeCloseTo(before.y, 4);
    expect(canvas.getObjects()).toEqual([group]); expect(group.getObjects()).toHaveLength(2);
    exported.forEach((o) => o.dispose());
  });
  it('validates duplicate layers and line widths before mutation', () => {
    expect(() => validateCadLayers([DEFAULT_CAD_LAYER, DEFAULT_CAD_LAYER])).toThrow();
    expect(() => validateCadLayers([{ ...DEFAULT_CAD_LAYER, lineWidth: NaN }])).toThrow();
    expect(() => validateCadLayers([{ ...DEFAULT_CAD_LAYER, name: 'bad\nname' }])).toThrow();
  });
  it('uses persistent own locks even for a first layer resolution', () => {
    const { canvas } = setup(); const rect = new fabric.Rect({ width: 10, height: 10, lockMovementX: true });
    canvas.add(rect); applyCadLayers(canvas); expect(rect.lockMovementX).toBe(true); expect(getFabricMetadata(rect).locked).toBe(true);
    setFabricMetadataValues(rect, { locked: false }); applyCadLayers(canvas); expect(rect.lockMovementX).toBe(false);
  });
});
