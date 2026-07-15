import { describe, expect, it } from 'vitest';
import * as fabric from 'fabric';
import { exportObjectsToDxf } from './dxfExporter';

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
});
