import { describe, expect, it } from 'vitest';
import { parseDxf } from './dxf';

export function dxfFixture(entities: (string | number)[], tables: (string | number)[] = [], header: (string | number)[] = []): string {
  return [0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', ...header, 0, 'ENDSEC',
    0, 'SECTION', 2, 'TABLES', ...tables, 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES', ...entities, 0, 'ENDSEC', 0, 'EOF', ''].join('\n');
}
const line = [0, 'LINE', 8, 'Walls', 10, -10, 20, 20, 11, 50, 21, 40];
describe('bounded R12 importer', () => {
  it('reads world coordinates, layer properties and explicit units', () => {
    const drawing = parseDxf(dxfFixture([...line, 0, 'CIRCLE', 10, 20, 20, 30, 40, 5], [0, 'LAYER', 2, 'Walls', 70, 4, 62, -1, 6, 'DASHED'], [9, '$INSUNITS', 70, 5]));
    expect(drawing.layers[1]).toMatchObject({ name: 'Walls', locked: true, visible: false, color: '#ff0000', lineType: 'dashed' });
    expect(drawing.entities).toHaveLength(2);
    expect(drawing.entities[0]).toMatchObject({ from: { x: -10, y: 20 }, to: { x: 50, y: 40 } });
    expect(drawing.unit).toBe('cm');
    expect(drawing.bounds).toEqual({ minX: -10, minY: 20, maxX: 50, maxY: 40 });
  });
  it('does not infer mm from the metric flag', () => {
    expect(parseDxf(dxfFixture(line, [], [9, '$MEASUREMENT', 70, 1])).unit).toBeNull();
  });
  it('retains Japanese UTF-8 text and warns about font substitution', () => {
    const drawing = parseDxf(dxfFixture([0, 'TEXT', 1, '部屋 A', 10, -500, 20, 100, 40, 12, 50, 30]));
    expect(drawing.entities[0]).toMatchObject({ text: '部屋 A', angle: 30 });
    expect(drawing.warnings).toContain('TEXT_FONT');
  });
  it('reads straight closed polylines and reports unsupported geometry without importing it', () => {
    const polyline = [0, 'POLYLINE', 70, 1, 0, 'VERTEX', 10, 0, 20, 0, 0, 'VERTEX', 10, 10, 20, 0, 0, 'VERTEX', 10, 10, 20, 10, 0, 'SEQEND'];
    const drawing = parseDxf(dxfFixture([...polyline, ...polyline.slice(0, -2), 42, .5, 0, 'SEQEND', ...line, 30, 1, 0, 'INSERT', 2, 'block', 0, 'ARC', 10, 0, 20, 0]));
    expect(drawing.entities).toHaveLength(1);
    expect(drawing.entities[0]).toMatchObject({ type: 'POLYLINE', closed: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] });
    expect(drawing.skipped).toEqual({ POLYLINE_CURVE_OR_WIDTH: 1, '3D': 1, 'ENTITY:INSERT': 1, 'ENTITY:ARC': 1 });
  });
  it.each([
    dxfFixture(line).replace('AC1009', 'AC1027'),
    dxfFixture(line).replace('EOF', 'BROKEN'),
    dxfFixture(line).replace('\n-10\n', '\nNaN\n'),
    dxfFixture(line).replace('\n-10\n', '\n1e309\n'),
    dxfFixture([0, 'POLYLINE', 0, 'VERTEX', 10, 1, 20, 2]),
    'AutoCAD Binary DXF\0',
    dxfFixture(line) + '0\nEOF\n',
  ])('rejects malformed, non-R12 or incomplete documents', (source) => expect(() => parseDxf(source)).toThrow());
  it('enforces the entity and layer budgets', () => {
    expect(() => parseDxf(dxfFixture(Array.from({ length: 5001 }, () => line).flat()))).toThrow(/Too many DXF entities/);
    expect(() => parseDxf(dxfFixture(line, Array.from({ length: 200 }, (_, i) => [0, 'LAYER', 2, `Layer ${i}`]).flat()))).toThrow(/Too many DXF layers/);
    expect(() => parseDxf(dxfFixture([0, 'POLYLINE', ...Array.from({ length: 100001 }, (_, i) => [0, 'VERTEX', 10, i, 20, 0]).flat(), 0, 'SEQEND']))).toThrow(/Too many DXF vertices/);
  });
  it('reports unsupported color and line-type approximations', () => {
    const drawing = parseDxf(dxfFixture([...line, 62, 100, 6, 'CUSTOM']));
    expect(drawing.warnings.sort()).toEqual(['ACI_COLOR', 'LINE_TYPE']);
  });
});
