import * as fabric from 'fabric';
import { describe, expect, it } from 'vitest';
import { bezierPathData, type BezierNode } from './bezierPath';
import { attachNodeEditControls, deletePathNode, findNodeAtScenePoint, listNodesInScene, setBezierNodeMode } from './nodeEditing';
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

  it('keeps the closing edge attached when the first node is dragged', () => {
    const path = new fabric.Path('M 0 0 C 10 0 20 0 30 0 L 30 30 C 20 30 -10 0 0 0 Z');
    expect(listNodesInScene(path)).toHaveLength(3);
    const first = listNodesInScene(path)[0];
    expect(findNodeAtScenePoint(path, first.point, 0.1)).toEqual({ type: 'path', commandIndex: 0 });
    attachNodeEditControls(path, (point) => point);
    expect(path.controls.c_3_C).toBeUndefined();
    const control = path.controls.c_0_M;
    const moved = control.actionHandler?.call(control, {} as fabric.TPointerEvent,
      { target: path, corner: 'c_0_M' } as unknown as fabric.Transform, first.point.x + 5, first.point.y + 7);
    expect(moved).toBe(true);
    expect(path.path[3].slice(-2)).toEqual(path.path[0].slice(-2));
    expect(path.path[1].slice(1, 3)).toEqual([15, 7]);
    expect(path.path[3].slice(3, 5)).toEqual([-5, 7]);
  });

  it('links smooth and symmetric handles across the closing edge', () => {
    const path = new fabric.Path('M 0 0 L 30 0 L 30 30 L 0 0 Z');
    expect(setBezierNodeMode(path, 0, 'symmetric')).toBe(true);
    expect(path.path[1][0]).toBe('C');
    expect(path.path[3][0]).toBe('C');
    const out = path.path[1];
    const incoming = path.path[3];
    expect(incoming[3]).toBeCloseTo(-Number(out[1]));
    expect(incoming[4]).toBeCloseTo(-Number(out[2]));
    expect(getFabricMetadata(path).bezierNodeModes?.['0']).toBe('symmetric');
    expect(getFabricMetadata(path).bezierNodeModes?.['3']).toBe('symmetric');
    attachNodeEditControls(path, (point) => point);
    const control = path.controls.c_1_C_CP_1;
    const first = listNodesInScene(path)[0];
    expect(control.actionHandler?.call(control, {} as fabric.TPointerEvent,
      { target: path, corner: 'c_1_C_CP_1' } as unknown as fabric.Transform, first.point.x + 15, first.point.y + 10)).toBe(true);
    const movedOut = path.path[1];
    const movedIn = path.path[3];
    const anchor = path.path[0];
    expect(Number(movedIn[3]) - Number(anchor[1])).toBeCloseTo(-(Number(movedOut[1]) - Number(anchor[1])));
    expect(Number(movedIn[4]) - Number(anchor[2])).toBeCloseTo(-(Number(movedOut[2]) - Number(anchor[2])));
  });

  it('deletes a closed path seam as one logical node', () => {
    const path = new fabric.Path('M 0 0 L 20 0 L 20 20 L 0 20 L 0 0 Z');
    expect(deletePathNode(path, 0)).toBe(true);
    expect(path.path).toEqual([['M', 20, 0], ['L', 20, 20], ['L', 0, 20], ['Z']]);
  });
});
