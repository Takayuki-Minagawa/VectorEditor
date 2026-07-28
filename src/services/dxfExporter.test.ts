import { describe, expect, it } from 'vitest';
import * as fabric from 'fabric';
import { setFabricMetadataValues } from '../utils/fabricObjectMetadata';
import { exportObjectsToDxf } from './dxfExporter';

function firstEntityValue(text: string, entity: string, groupCode: number): number {
  const values = text.trimEnd().split('\r\n');
  for (let index = 0; index < values.length - 1; index += 2) {
    if (values[index] !== '0' || values[index + 1] !== entity) continue;
    for (let pairIndex = index + 2; pairIndex < values.length - 1; pairIndex += 2) {
      if (values[pairIndex] === '0') break;
      if (values[pairIndex] === String(groupCode)) return Number(values[pairIndex + 1]);
    }
  }
  throw new Error(`${entity} group code ${groupCode} was not found`);
}

function entityValues(text: string, entity: string, groupCode: number): number[] {
  const values = text.trimEnd().split('\r\n');
  const result: number[] = [];
  for (let index = 0; index < values.length - 1; index += 2) {
    if (values[index] !== '0' || values[index + 1] !== entity) continue;
    for (let pairIndex = index + 2; pairIndex < values.length - 1; pairIndex += 2) {
      if (values[pairIndex] === '0') break;
      if (values[pairIndex] === String(groupCode)) {
        result.push(Number(values[pairIndex + 1]));
        break;
      }
    }
  }
  return result;
}

describe('R12 ASCII DXF export', () => {
  it('exports supported Fabric primitives and warns about unsupported objects', () => {
    const objects: fabric.FabricObject[] = [
      new fabric.Line([10, 20, 40, 50]),
      new fabric.Polyline([{ x: 0, y: 0 }, { x: 20, y: 10 }, { x: 40, y: 0 }]),
      new fabric.Rect({ left: 50, top: 60, width: 80, height: 40 }),
      new fabric.Circle({ left: 150, top: 50, radius: 20 }),
      new fabric.Ellipse({ left: 220, top: 50, rx: 30, ry: 15 }),
      new fabric.Text('Room 101', { left: 20, top: 160, fontSize: 12 }),
      new fabric.Triangle({ left: 300, top: 100, width: 20, height: 20 }),
    ];

    const result = exportObjectsToDxf(objects, 800, 500);

    expect(result.text).toContain('AC1009');
    expect(result.text).toContain('CONTINUOUS');
    expect(result.text).toMatch(/0\r\nLINE\r\n/);
    expect(result.text).toMatch(/0\r\nPOLYLINE\r\n/);
    expect(result.text).toMatch(/0\r\nCIRCLE\r\n/);
    expect(result.text).toMatch(/0\r\nTEXT\r\n/);
    expect(result.text).not.toContain('LWPOLYLINE');
    expect(result.unsupportedTypes).toEqual(['Triangle']);
    expect(result.approximatedTypes).toEqual(['Ellipse']);
  });

  it('exports grouped supported objects recursively', () => {
    const group = new fabric.Group([
      new fabric.Line([0, 0, 10, 0]),
      new fabric.Rect({ left: 20, top: 20, width: 10, height: 10 }),
    ]);

    const result = exportObjectsToDxf([group], 200, 100);

    expect(result.text).toMatch(/0\r\nLINE\r\n/);
    expect(result.text).toMatch(/0\r\nPOLYLINE\r\n/);
    expect(result.unsupportedTypes).toEqual([]);
  });

  it('keeps R12 output ASCII and reports replaced text', () => {
    const result = exportObjectsToDxf(
      [new fabric.Text('部屋 A', { left: 10, top: 10, fontSize: 10 })],
      200,
      100,
    );

    expect(Array.from(result.text).every((character) => character.charCodeAt(0) < 128)).toBe(true);
    expect(result.text).toContain('?? A');
    expect(result.approximatedTypes).toContain('TextEncoding');
  });

  it('uses the transformed Y axis for text height and warns about non-uniform scale', () => {
    const text = new fabric.Text('Scaled', {
      left: 10,
      top: 10,
      fontSize: 10,
      scaleX: 2,
      scaleY: 3,
    });

    const result = exportObjectsToDxf([text], 200, 100);

    expect(firstEntityValue(result.text, 'TEXT', 40)).toBeCloseTo(30, 6);
    expect(result.approximatedTypes).toContain('TextTransform');
  });

  it('includes Y-axis shear in text height and reports the approximation', () => {
    const text = new fabric.Text('Skewed', {
      left: 10,
      top: 10,
      fontSize: 10,
      skewX: 30,
    });

    const matrix = text.calcTransformMatrix();
    const expectedHeight = text.fontSize * Math.hypot(matrix[2], matrix[3]);
    const result = exportObjectsToDxf([text], 200, 100);

    expect(firstEntityValue(result.text, 'TEXT', 40)).toBeCloseTo(expectedHeight, 6);
    expect(result.approximatedTypes).toContain('TextTransform');
  });

  it('warns when mirrored Fabric text cannot be represented by R12 TEXT', () => {
    const text = new fabric.Text('Mirrored', {
      left: 10,
      top: 10,
      fontSize: 10,
      flipX: true,
    });

    const result = exportObjectsToDxf([text], 200, 100);

    expect(result.approximatedTypes).toContain('TextTransform');
  });

  it('exports section outer and hole rings as transformed closed polylines with warnings', () => {
    const section = new fabric.Rect({
      left: 50,
      top: 40,
      width: 40,
      height: 20,
      originX: 'center',
      originY: 'center',
    });
    setFabricMetadataValues(section, {
      objectKind: 'sectionProfile',
      sectionProfileData: {
        version: 1,
        analysisToleranceMm: 0.01,
        approximate: true,
        rings: [
          {
            role: 'outer',
            points: [
              { x: -20, y: -10 },
              { x: 20, y: -10 },
              { x: 20, y: 10 },
              { x: -20, y: 10 },
            ],
          },
          {
            role: 'hole',
            points: [
              { x: -5, y: -5 },
              { x: -5, y: 5 },
              { x: 5, y: 5 },
              { x: 5, y: -5 },
            ],
          },
        ],
      },
    });

    const result = exportObjectsToDxf([section], 300, 200);

    expect(entityValues(result.text, 'POLYLINE', 70)).toEqual([1, 1]);
    expect(entityValues(result.text, 'VERTEX', 10)).toHaveLength(8);
    expect(firstEntityValue(result.text, 'VERTEX', 10)).toBeCloseTo(30, 6);
    expect(firstEntityValue(result.text, 'VERTEX', 20)).toBeCloseTo(150, 6);
    expect(result.unsupportedTypes).toEqual([]);
    expect(result.approximatedTypes).toEqual([
      'SectionProfileApproximation',
      'SectionProfileHoles',
    ]);
  });

  it('exports a closed compound path, such as a Boolean result, as closed polylines', () => {
    const path = new fabric.Path(
      'M 0 0 L 100 0 L 100 100 L 0 100 Z M 25 25 L 75 25 L 75 75 L 25 75 Z',
      { strokeWidth: 0, fillRule: 'evenodd' },
    );

    const result = exportObjectsToDxf([path], 400, 300);

    expect(result.unsupportedTypes).toEqual([]);
    // Outline and hole ring, both closed.
    expect(entityValues(result.text, 'POLYLINE', 70)).toEqual([1, 1]);
    const xs = entityValues(result.text, 'VERTEX', 10);
    const ys = entityValues(result.text, 'VERTEX', 20);
    expect(xs).toHaveLength(8);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(100, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(100, 6);
    expect(result.approximatedTypes).toContain('PathHoles');
  });

  it('keeps open paths out of the DXF output as unsupported objects', () => {
    const open = new fabric.Path('M 0 0 C 10 10 20 10 30 0', { strokeWidth: 0 });
    const result = exportObjectsToDxf([open], 400, 300);
    expect(result.unsupportedTypes).toEqual(['Path']);
    expect(result.text).not.toMatch(/0\r\nPOLYLINE\r\n/);
  });

  it('skips an invalid transformed section while continuing to export other objects', () => {
    const section = new fabric.Rect({
      width: 40,
      height: 20,
      scaleX: 1e-20,
    });
    setFabricMetadataValues(section, {
      objectKind: 'sectionProfile',
      sectionProfileData: {
        version: 1,
        analysisToleranceMm: 0.01,
        approximate: false,
        rings: [{
          role: 'outer',
          points: [
            { x: -20, y: -10 },
            { x: 20, y: -10 },
            { x: 20, y: 10 },
            { x: -20, y: 10 },
          ],
        }],
      },
    });
    const line = new fabric.Line([10, 20, 40, 50]);

    const result = exportObjectsToDxf([section, line], 300, 200);

    expect(result.text).toMatch(/0\r\nLINE\r\n/);
    expect(result.text).not.toMatch(/0\r\nPOLYLINE\r\n/);
    expect(result.unsupportedTypes).toEqual(['SectionProfile']);
  });
});
