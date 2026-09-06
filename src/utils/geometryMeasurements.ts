import type * as fabric from 'fabric';
import type { CadUnit } from '../types';
import { signedSectionRingArea } from '../domain/section';
import { sectionProfileFromFabricObject } from './sectionGeometry';
import { normalizeAndAssertValidSectionProfileTopology } from './sectionTopology';

export interface DrawingPoint { x: number; y: number }
export function pointDistance(a: DrawingPoint, b: DrawingPoint): number {
  const result = Math.hypot(b.x - a.x, b.y - a.y);
  if (!Number.isFinite(result) || result <= 1e-9) throw new Error('Distinct finite points required');
  return result;
}
export function pointAngle(a: DrawingPoint, vertex: DrawingPoint, b: DrawingPoint): number {
  const u = pointDistance(a, vertex); const v = pointDistance(b, vertex);
  const ax = (a.x - vertex.x) / u; const ay = (a.y - vertex.y) / u;
  const bx = (b.x - vertex.x) / v; const by = (b.y - vertex.y) / v;
  return Math.atan2(Math.abs(ax * by - ay * bx), ax * bx + ay * by) * 180 / Math.PI;
}
export interface ShapeMeasurement { area: number; outerPerimeter: number; holePerimeter: number; approximate: boolean; tolerance: number }
export function measureClosedShape(object: fabric.FabricObject): ShapeMeasurement {
  const profile = normalizeAndAssertValidSectionProfileTopology(sectionProfileFromFabricObject(object));
  let area = 0; let outerPerimeter = 0; let holePerimeter = 0;
  for (const ring of profile.rings) {
    const length = ring.points.reduce((total, point, i) => {
      const next = ring.points[(i + 1) % ring.points.length];
      return total + Math.hypot(next.x - point.x, next.y - point.y);
    }, 0);
    area += Math.abs(signedSectionRingArea(ring.points)) * (ring.role === 'hole' ? -1 : 1);
    if (ring.role === 'hole') holePerimeter += length; else outerPerimeter += length;
  }
  if (![area, outerPerimeter, holePerimeter].every(Number.isFinite) || area <= 0) throw new Error('Invalid area');
  return { area, outerPerimeter, holePerimeter, approximate: profile.approximate, tolerance: profile.analysisToleranceMm };
}
export function measurementValue(value: number, unit: CadUnit | 'px', power = 1): string {
  const divisor = unit === 'cm' ? 10 : unit === 'm' ? 1000 : 1;
  const result = value / divisor ** power;
  return `${Number(result.toPrecision(8))} ${unit}${power === 2 ? '²' : ''}`;
}
