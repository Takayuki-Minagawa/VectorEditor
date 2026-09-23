import type { DxfPoint } from './dxf';

export interface ArcGeometry {
  center: DxfPoint;
  radius: number;
  startAngle: number;
  sweep: number;
}

const TAU = Math.PI * 2;
export const radians = (degrees: number): number => degrees * Math.PI / 180;
export const degrees = (angle: number): number => ((angle * 180 / Math.PI) % 360 + 360) % 360;

export function arcFromAngles(center: DxfPoint, radius: number, start: number, end: number): ArcGeometry {
  const startAngle = radians(((start % 360) + 360) % 360);
  const sweep = radians(((end - start) % 360 + 360) % 360);
  if (radius <= 0 || !Number.isFinite(radius) || sweep < 1e-10) throw new Error('Invalid DXF arc');
  return { center, radius, startAngle, sweep };
}

export function arcFromBulge(from: DxfPoint, to: DxfPoint, bulge: number): ArcGeometry | null {
  if (bulge === 0) return null;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const chord = Math.hypot(dx, dy);
  if (!Number.isFinite(bulge) || chord < 1e-10) throw new Error('Invalid DXF bulge');
  const offset = chord * (1 - bulge * bulge) / (4 * bulge);
  const center = { x: (from.x + to.x) / 2 - dy / chord * offset, y: (from.y + to.y) / 2 + dx / chord * offset };
  const radius = Math.hypot(from.x - center.x, from.y - center.y);
  if (!Number.isFinite(radius) || radius > 1e9) throw new Error('Invalid DXF bulge radius');
  return { center, radius, startAngle: Math.atan2(from.y - center.y, from.x - center.x), sweep: 4 * Math.atan(bulge) };
}

export function arcPoint(arc: ArcGeometry, angle: number): DxfPoint {
  return { x: arc.center.x + arc.radius * Math.cos(angle), y: arc.center.y + arc.radius * Math.sin(angle) };
}

export function arcCubicSegments(arc: ArcGeometry): { from: DxfPoint; c1: DxfPoint; c2: DxfPoint; to: DxfPoint }[] {
  const count = Math.ceil(Math.abs(arc.sweep) / (Math.PI / 2));
  return Array.from({ length: count }, (_, index) => {
    const a = arc.startAngle + arc.sweep * index / count;
    const b = arc.startAngle + arc.sweep * (index + 1) / count;
    const k = 4 / 3 * Math.tan((b - a) / 4) * arc.radius;
    const from = arcPoint(arc, a);
    const to = arcPoint(arc, b);
    return {
      from, to,
      c1: { x: from.x - k * Math.sin(a), y: from.y + k * Math.cos(a) },
      c2: { x: to.x + k * Math.sin(b), y: to.y - k * Math.cos(b) },
    };
  });
}

export function arcBoundsPoints(arc: ArcGeometry): DxfPoint[] {
  const result = [arcPoint(arc, arc.startAngle), arcPoint(arc, arc.startAngle + arc.sweep)];
  for (let i = 0; i < 4; i++) {
    const candidate = i * Math.PI / 2;
    const forward = ((candidate - arc.startAngle) % TAU + TAU) % TAU;
    const backward = ((arc.startAngle - candidate) % TAU + TAU) % TAU;
    if (arc.sweep > 0 ? forward <= arc.sweep : backward <= -arc.sweep) result.push(arcPoint(arc, candidate));
  }
  return result;
}
