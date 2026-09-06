import * as fabric from 'fabric';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDxf, type DxfDrawing } from '../domain/dxf';
import { defaultCadLayers } from '../domain/cadLayer';
import { dxfToFabricObjects, insertDxfDrawing, readDxfFile } from './dxfImporter';
import { exportObjectsToDxf } from './dxfExporter';
import { useEditorStore } from '../store/useEditorStore';

const drawing: DxfDrawing = { layers: defaultCadLayers(), unit: null, warnings: [], skipped: {}, bounds: null, entities: [
  { type: 'LINE', layerId: '0', from: { x: -10, y: 5 }, to: { x: 20, y: 25 } },
  { type: 'CIRCLE', layerId: '0', center: { x: 50, y: -10 }, radius: 8 },
  { type: 'POLYLINE', layerId: '0', points: [{ x: 5, y: 6 }, { x: 15, y: 6 }, { x: 15, y: 16 }], closed: true },
  { type: 'TEXT', layerId: '0', at: { x: -15, y: 50 }, height: 12, text: 'Room A', angle: 35 },
] };
afterEach(async () => {
  const canvas = useEditorStore.getState().canvas;
  useEditorStore.setState({ canvas: null, drawingMode: 'illustration', cadLayers: defaultCadLayers(), activeCadLayerId: '0' });
  if (canvas instanceof fabric.Canvas) await canvas.dispose();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
describe('DXF import and re-export', () => {
  it('prepares the maximum 5,000-entity reference within the document history budget', () => {
    const source = [0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES',
      ...Array.from({ length: 5000 }, (_, i) => [0, 'LINE', 10, i * 10, 20, 0, 11, i * 10 + 5, 21, 20]).flat(), 0, 'ENDSEC', 0, 'EOF', ''].join('\n');
    const started = performance.now(); const parsed = parseDxf(source); const parseMs = performance.now() - started;
    const prepared = performance.now(); const objects = dxfToFabricObjects(parsed, 'mm', 8000); const prepareMs = performance.now() - prepared;
    const bytes = new TextEncoder().encode(JSON.stringify(objects.map((object) => object.toObject()))).length;
    expect(objects).toHaveLength(5000); expect(bytes).toBeLessThan(32 * 1024 * 1024);
    console.info(`DXF reference: ${source.length} bytes, parse ${parseMs.toFixed(1)} ms, prepare ${prepareMs.toFixed(1)} ms, object snapshot ${bytes} bytes`);
    objects.forEach((object) => object.dispose());
  });
  it.each(['mm', 'cm', 'm', 'inch'] as const)('preserves coordinates and text insertion through a %s round-trip', (unit) => {
    const objects = dxfToFabricObjects(drawing, unit, 100000);
    const exported = parseDxf(exportObjectsToDxf(objects, 100000, 100000).text);
    const scale = { mm: 1, cm: 10, m: 1000, inch: 25.4 }[unit];
    expect(exported.entities).toHaveLength(4);
    const line = exported.entities[0]; const circle = exported.entities[1]; const polyline = exported.entities[2]; const text = exported.entities[3];
    if (line.type !== 'LINE' || circle.type !== 'CIRCLE' || polyline.type !== 'POLYLINE' || text.type !== 'TEXT') throw new Error('Wrong types');
    expect(line.from.x).toBeCloseTo(-10 * scale, 5); expect(line.from.y).toBeCloseTo(5 * scale, 5);
    expect(line.to.x).toBeCloseTo(20 * scale, 5); expect(line.to.y).toBeCloseTo(25 * scale, 5);
    expect(circle.center.x).toBeCloseTo(50 * scale, 5); expect(circle.center.y).toBeCloseTo(-10 * scale, 5); expect(circle.radius).toBeCloseTo(8 * scale, 5);
    expect(polyline.closed).toBe(true); expect(polyline.points[2].x).toBeCloseTo(15 * scale, 5); expect(polyline.points[2].y).toBeCloseTo(16 * scale, 5);
    expect(text.at.x).toBeCloseTo(-15 * scale, 5); expect(text.at.y).toBeCloseTo(50 * scale, 5); expect(text.angle).toBeCloseTo(35, 5); expect(text.height).toBeCloseTo(12 * scale, 5);
    objects.forEach((object) => object.dispose());
  });
  it('rejects coordinates that overflow the converted mm range', () => {
    expect(() => dxfToFabricObjects({ ...drawing, entities: [{ type: 'CIRCLE', layerId: '0', center: { x: 1e9, y: 0 }, radius: 1 }] }, 'm', 100)).toThrow(/coordinate/);
  });
  it('imports objects and layers as one reversible history entry', async () => {
    const canvas = new fabric.Canvas(document.createElement('canvas'), { width: 400, height: 300 });
    useEditorStore.setState({ canvas, drawingMode: 'cad', cadLayers: defaultCadLayers(), activeCadLayerId: '0' });
    useEditorStore.getState().resetHistory();
    const source = { ...drawing, layers: [...drawing.layers, { ...drawing.layers[0], id: 'wall', name: 'Walls', color: '#ff0000' }], entities: drawing.entities.map((entity) => ({ ...entity, layerId: 'wall' })) };
    insertDxfDrawing(source, 'mm');
    expect(canvas.getObjects()).toHaveLength(4); expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().cadLayers).toHaveLength(2);
    await useEditorStore.getState().undo();
    expect(canvas.getObjects()).toHaveLength(0); expect(useEditorStore.getState().cadLayers).toHaveLength(1);
    await useEditorStore.getState().redo();
    expect(canvas.getObjects()).toHaveLength(4); expect(canvas.getObjects()[0].stroke).toBe('#ff0000');
  });
  it('rolls back objects and layer additions if canvas insertion fails', () => {
    const canvas = new fabric.Canvas(document.createElement('canvas'));
    useEditorStore.setState({ canvas, drawingMode: 'cad', cadLayers: defaultCadLayers(), activeCadLayerId: '0' });
    useEditorStore.getState().resetHistory();
    const originalAdd = canvas.add.bind(canvas);
    vi.spyOn(canvas, 'add').mockImplementation((...objects) => { originalAdd(objects[0]); throw new Error('Insertion failed'); });
    expect(() => insertDxfDrawing(drawing, 'mm')).toThrow('Insertion failed');
    expect(canvas.getObjects()).toHaveLength(0); expect(useEditorStore.getState().history).toHaveLength(1); expect(useEditorStore.getState().cadLayers).toEqual(defaultCadLayers());
  });
  it('terminates the worker on cancellation', async () => {
    const terminate = vi.fn();
    vi.stubGlobal('Worker', class { terminate = terminate; postMessage = vi.fn(); });
    const controller = new AbortController();
    const job = readDxfFile(new File(['DXF'], 'test.dxf'), 'utf-8', controller.signal);
    controller.abort(); await expect(job).rejects.toMatchObject({ name: 'AbortError' }); expect(terminate).toHaveBeenCalledOnce();
  });
});
