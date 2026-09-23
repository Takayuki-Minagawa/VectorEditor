import * as fabric from 'fabric';
import { describe, expect, it } from 'vitest';
import { bezierPathData, type BezierNode } from './bezierPath';
import { setBezierNodeMode } from './nodeEditing';
import { getFabricMetadata } from './fabricObjectMetadata';

describe('Bézier pen and node modes', () => {
  const nodes: BezierNode[] = [
    { x: 0, y: 0, mode: 'cusp' },
    { x: 20, y: 0, incoming: { x: 15, y: -10 }, outgoing: { x: 25, y: 10 }, mode: 'smooth' },
    { x: 40, y: 20, mode: 'cusp' },
  ];
  it('creates mixed line and curve paths and closes them', () => {
    expect(bezierPathData(nodes)).toContain('C 0 0 15 -10 20 0');
    expect(bezierPathData(nodes)).toContain('C 25 10 40 20 40 20');
    expect(bezierPathData(nodes, true)).toMatch(/Z$/);
  });
  it('converts a corner segment to editable handles and persists node mode', () => {
    const path = new fabric.Path('M 0 0 L 20 0 L 40 20');
    expect(setBezierNodeMode(path, 1, 'symmetric')).toBe(true);
    expect(path.path[1][0]).toBe('C');
    expect(path.path[2][0]).toBe('C');
    expect(getFabricMetadata(path).bezierNodeModes?.['1']).toBe('symmetric');
  });
});
