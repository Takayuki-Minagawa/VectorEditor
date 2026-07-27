import { describe, expect, it } from 'vitest';
import { simplifyContour, simplifyPolyline } from './simplify';

describe('Douglas-Peucker simplification', () => {
  it('reduces a noisy open line while retaining its endpoints', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 2, y: 0.05 },
      { x: 4, y: -0.04 },
      { x: 6, y: 0 },
    ];
    expect(simplifyPolyline(points, 0.1)).toEqual([
      { x: 0, y: 0 },
      { x: 6, y: 0 },
    ]);
    expect(points).toHaveLength(4);
  });

  it('simplifies an implicitly closed pixel-edge rectangle to four corners', () => {
    const rectangle = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
      { x: 2, y: 1 }, { x: 2, y: 2 },
      { x: 1, y: 2 }, { x: 0, y: 2 },
      { x: 0, y: 1 },
    ];
    const simplified = simplifyPolyline(rectangle, 0, true);
    expect(simplified).toHaveLength(4);
    expect(simplified).toEqual(expect.arrayContaining([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ]));
  });

  it('never collapses a valid closed polygon below three vertices', () => {
    const result = simplifyPolyline([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ], 1_000, true);
    expect(result).toHaveLength(3);
  });

  it('updates contour area after simplification', () => {
    const result = simplifyContour({
      componentId: 1,
      points: [
        { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
        { x: 2, y: 2 }, { x: 0, y: 2 },
      ],
      closed: true,
      isHole: false,
      area: 99,
    }, 0);
    expect(result.area).toBe(4);
  });
});
