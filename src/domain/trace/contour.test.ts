import { describe, expect, it } from 'vitest';
import {
  componentBinaryImage,
  ConnectedComponentLimitError,
  ContourBoundaryEdgeLimitError,
  extractContours,
  labelConnectedComponents,
} from './contour';
import type { BinaryImage } from './tracedDrawing';

function image(rows: readonly (readonly number[])[]): BinaryImage {
  return {
    width: rows[0].length,
    height: rows.length,
    data: Uint8Array.from(rows.flat()),
  };
}

describe('connected components and contours', () => {
  it('labels components with area and bounds without retaining pixel lists', () => {
    const source = image([
      [1, 1, 0, 0, 0],
      [1, 1, 0, 0, 1],
      [0, 0, 0, 0, 0],
    ]);
    const result = labelConnectedComponents(source);
    expect(result.components.map((component) => component.area)).toEqual([4, 1]);
    expect(result.components[0].bounds).toEqual({
      minX: 0,
      minY: 0,
      maxX: 2,
      maxY: 2,
      width: 2,
      height: 2,
    });
    expect(result.components[0]).not.toHaveProperty('pixels');
    expect([...componentBinaryImage(source, result, 2).data].filter(Boolean))
      .toHaveLength(1);
  });

  it('stops labeling before retaining too many disconnected components', () => {
    const source = image([[1, 0, 1]]);
    expect(() => labelConnectedComponents(source, 4, {
      maxComponents: 1,
    })).toThrow(ConnectedComponentLimitError);
    try {
      labelConnectedComponents(source, 4, { maxComponents: 1 });
      throw new Error('Expected connected-component budget failure.');
    } catch (error) {
      expect(error).toMatchObject({
        name: 'ConnectedComponentLimitError',
        code: 'CONNECTED_COMPONENT_LIMIT_EXCEEDED',
        maxComponents: 1,
        attemptedComponents: 2,
      });
      expect((error as Error).message).toMatch(/vertex limit/i);
    }
    expect(labelConnectedComponents(source, 4, {
      maxComponents: 2,
    }).components).toHaveLength(2);
  });

  it('rejects invalid connected-component budgets before labeling', () => {
    const source = image([[1]]);
    expect(() => labelConnectedComponents(source, 8, {
      maxComponents: -1,
    })).toThrow(RangeError);
    expect(() => labelConnectedComponents(source, 8, {
      maxComponents: 1.5,
    })).toThrow(RangeError);
  });

  it('extracts an outer contour and an oppositely wound hole', () => {
    const source = image([
      [0, 0, 0, 0, 0],
      [0, 1, 1, 1, 0],
      [0, 1, 0, 1, 0],
      [0, 1, 1, 1, 0],
      [0, 0, 0, 0, 0],
    ]);
    const contours = extractContours(source);
    expect(contours).toHaveLength(2);
    expect(contours.find((contour) => !contour.isHole)?.area).toBe(9);
    expect(contours.find((contour) => contour.isHole)?.area).toBe(1);
    expect(new Set(contours.map((contour) => contour.componentId)).size).toBe(1);
  });

  it('keeps diagonally touching pixel outlines as separate closed cycles', () => {
    const source = image([
      [1, 0],
      [0, 1],
    ]);
    const labeling = labelConnectedComponents(source);
    expect(labeling.components).toHaveLength(1);
    const contours = extractContours(source, labeling);
    expect(contours).toHaveLength(2);
    expect(contours.every((contour) => contour.points.length === 4)).toBe(true);
    expect(contours.map((contour) => contour.area)).toEqual([1, 1]);
  });

  it('can use 4-connectivity when diagonal marks must remain components', () => {
    expect(labelConnectedComponents(image([
      [1, 0],
      [0, 1],
    ]), 4).components).toHaveLength(2);
  });

  it('stops raw boundary construction as soon as its edge budget is exceeded', () => {
    const source = image([[1, 1]]);
    // A 2x1 filled component has six raw boundary edges.
    expect(() => extractContours(source, { maxBoundaryEdges: 5 })).toThrow(
      ContourBoundaryEdgeLimitError,
    );
    try {
      extractContours(source, { maxBoundaryEdges: 5 });
      throw new Error('Expected boundary edge budget failure.');
    } catch (error) {
      expect(error).toMatchObject({
        name: 'ContourBoundaryEdgeLimitError',
        code: 'BOUNDARY_EDGE_LIMIT_EXCEEDED',
        maxBoundaryEdges: 5,
        attemptedBoundaryEdges: 6,
      });
      expect((error as Error).message).toMatch(/vertex limit/i);
    }
    expect(extractContours(source, { maxBoundaryEdges: 6 })).toHaveLength(1);
  });

  it('supports a budget alongside precomputed component labels', () => {
    const source = image([[1]]);
    const labeling = labelConnectedComponents(source);
    expect(() => extractContours(source, labeling, {
      maxBoundaryEdges: 3,
    })).toThrow(ContourBoundaryEdgeLimitError);
    expect(extractContours(source, labeling, {
      maxBoundaryEdges: 4,
    })[0].area).toBe(1);
  });

  it('rejects invalid raw-edge budgets before contour allocation', () => {
    const source = image([[1]]);
    expect(() => extractContours(source, { maxBoundaryEdges: -1 }))
      .toThrow(RangeError);
    expect(() => extractContours(source, { maxBoundaryEdges: 1.5 }))
      .toThrow(RangeError);
  });
});
