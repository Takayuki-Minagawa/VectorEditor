import { describe, expect, it } from 'vitest';
import * as fabric from 'fabric';
import {
  collectFabricObjectTree,
  releaseActiveSelectionObjects,
} from './fabricObjectTree';

describe('Fabric object tree helpers', () => {
  it('collects nested objects without duplicating ActiveSelection children', () => {
    const first = new fabric.Rect({ width: 20, height: 20 });
    const second = new fabric.Rect({ width: 20, height: 20 });
    const selection = new fabric.ActiveSelection([first, second]);

    expect(collectFabricObjectTree([first, second, selection])).toEqual([
      first,
      second,
      selection,
    ]);
  });

  it('releases an ActiveSelection while preserving child scene positions', () => {
    const first = new fabric.Rect({ left: 20, top: 30, width: 10, height: 10 });
    const second = new fabric.Rect({ left: 80, top: 50, width: 10, height: 10 });
    const selection = new fabric.ActiveSelection([first, second]);
    selection.set({ left: (selection.left ?? 0) + 25, top: (selection.top ?? 0) + 15 });
    const expectedCenters = selection.getObjects().map((child) => child.getCenterPoint());

    const released = releaseActiveSelectionObjects(selection);

    expect(released).toEqual([first, second]);
    expect(released.every((child) => child.group === undefined)).toBe(true);
    released.forEach((child, index) => {
      expect(child.getCenterPoint().x).toBeCloseTo(expectedCenters[index].x);
      expect(child.getCenterPoint().y).toBeCloseTo(expectedCenters[index].y);
    });
  });
});
