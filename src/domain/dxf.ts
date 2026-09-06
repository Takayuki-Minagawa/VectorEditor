import { DEFAULT_CAD_LAYER, type CadLayer } from './cadLayer';

export const MAX_DXF_BYTES = 20 * 1024 * 1024;
export const MAX_DXF_ENTITIES = 5000;
export const MAX_DXF_VERTICES = 100000;
export type DxfUnit = 'mm' | 'cm' | 'm' | 'inch';
export const DXF_UNIT_SCALE: Record<DxfUnit, number> = { mm: 1, cm: 10, m: 1000, inch: 25.4 };
export interface DxfPoint { x: number; y: number }
interface EntityStyle { layerId: string; color?: string; lineType?: CadLayer['lineType'] }
export type DxfEntity = EntityStyle & (
  { type: 'LINE'; from: DxfPoint; to: DxfPoint } |
  { type: 'POLYLINE'; points: DxfPoint[]; closed: boolean } |
  { type: 'CIRCLE'; center: DxfPoint; radius: number } |
  { type: 'TEXT'; at: DxfPoint; text: string; height: number; angle: number }
);
export interface DxfDrawing {
  entities: DxfEntity[];
  layers: CadLayer[];
  unit: DxfUnit | null;
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  skipped: Record<string, number>;
  warnings: string[];
}
export const ACI_COLORS = ['#333333', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#333333'] as const;
type Pair = { code: number; value: string };
interface RecordEntry { type: string; pairs: Pair[] }
const value = (pairs: Pair[], code: number): string | undefined => pairs.find((p) => p.code === code)?.value;
function numeric(pairs: Pair[], code: number, fallback?: number): number {
  const raw = value(pairs, code);
  if (raw === undefined && fallback !== undefined) return fallback;
  if (raw === undefined || !raw.trim()) throw new Error(`Missing DXF value: ${code}`);
  const n = Number(raw);
  if (!Number.isFinite(n) || Math.abs(n) > 1e9) throw new Error(`Invalid DXF number: ${code}`);
  return n;
}
function integer(pairs: Pair[], code: number, fallback: number): number {
  const n = numeric(pairs, code, fallback);
  if (!Number.isInteger(n)) throw new Error(`Invalid DXF integer: ${code}`);
  return n;
}
function point(pairs: Pair[], x = 10, y = 20): DxfPoint { return { x: numeric(pairs, x), y: numeric(pairs, y) }; }

/** A bounded, dependency-free parser for the documented R12 2D subset. No evaluation or resource loads. */
export function parseDxf(source: string): DxfDrawing {
  if (new TextEncoder().encode(source).length > MAX_DXF_BYTES || source.includes('\0') || source.startsWith('AutoCAD Binary DXF')) throw new Error('Invalid or oversized ASCII DXF');
  const lines = source.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (lines.length % 2 || lines.length > 1200000) throw new Error('Invalid DXF pair count');
  const pairs: Pair[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    if (!/^\s*\d{1,4}\s*$/.test(lines[i]) || lines[i + 1].length > 4096) throw new Error('Invalid DXF group');
    const code = Number(lines[i]);
    if (code > 1071) throw new Error('Invalid DXF group code');
    if (code !== 999) pairs.push({ code, value: lines[i + 1] });
  }
  const sections = new Map<string, Pair[]>();
  let cursor = 0;
  while (cursor < pairs.length && !(pairs[cursor].code === 0 && pairs[cursor].value.trim() === 'EOF')) {
    if (pairs[cursor].code !== 0 || pairs[cursor].value.trim() !== 'SECTION' || pairs[cursor + 1]?.code !== 2) throw new Error('Invalid DXF section');
    const name = pairs[cursor + 1].value.trim(); cursor += 2;
    const start = cursor;
    while (cursor < pairs.length && !(pairs[cursor].code === 0 && pairs[cursor].value.trim() === 'ENDSEC')) cursor++;
    if (cursor === pairs.length || sections.has(name)) throw new Error('Invalid DXF section ending');
    sections.set(name, pairs.slice(start, cursor)); cursor++;
  }
  if (cursor !== pairs.length - 1 || pairs[cursor]?.value.trim() !== 'EOF' || !sections.has('ENTITIES')) throw new Error('DXF is incomplete');
  const header = sections.get('HEADER') ?? [];
  const variable = (name: string) => {
    const start = header.findIndex((p) => p.code === 9 && p.value.trim() === name);
    if (start < 0) return undefined;
    return header[start + 1]?.value.trim();
  };
  if (variable('$ACADVER') !== 'AC1009') throw new Error('Only R12 (AC1009) is supported');
  const warnings = new Set<string>();
  const color = (index: number): string => {
    if (index >= 1 && index <= 7) return ACI_COLORS[index];
    warnings.add('ACI_COLOR'); return ACI_COLORS[7];
  };
  const lineType = (name: string): CadLayer['lineType'] => {
    if (name === 'CONTINUOUS') return 'continuous';
    if (name === 'DASHED') return 'dashed';
    if (name === 'DOTTED') return 'dotted';
    warnings.add('LINE_TYPE'); return 'continuous';
  };
  const records = (section: Pair[]): RecordEntry[] => {
    const result: RecordEntry[] = [];
    for (const pair of section) {
      if (pair.code === 0) result.push({ type: pair.value.trim(), pairs: [] });
      else if (result.length) result[result.length - 1].pairs.push(pair);
      else throw new Error('Invalid DXF record');
    }
    return result;
  };
  const layers: CadLayer[] = [{ ...DEFAULT_CAD_LAYER }];
  const names = new Map([['0', '0']]);
  const layerId = (name: string) => {
    if (!name || name.length > 80 || Array.from(name).some((c) => c.charCodeAt(0) < 32)) throw new Error('Invalid layer name');
    if (!names.has(name)) {
      if (layers.length >= 200) throw new Error('Too many DXF layers');
      const id = `dxf_layer_${layers.length}`; names.set(name, id); layers.push({ ...DEFAULT_CAD_LAYER, id, name });
    }
    return names.get(name)!;
  };
  const declaredLayers = new Set<string>();
  for (const entry of records(sections.get('TABLES') ?? [])) {
    if (entry.type !== 'LAYER') continue;
    const name = value(entry.pairs, 2)?.trim() ?? '';
    if (declaredLayers.has(name)) throw new Error('Duplicate DXF layer');
    declaredLayers.add(name);
    const id = layerId(name);
    const layer = layers.find((l) => l.id === id)!;
    const flags = integer(entry.pairs, 70, 0); const aci = integer(entry.pairs, 62, 7);
    Object.assign(layer, { color: color(Math.abs(aci)), lineType: lineType(value(entry.pairs, 6)?.trim() ?? 'CONTINUOUS'), visible: aci >= 0 && !(flags & 1), locked: Boolean(flags & 4) });
  }
  const entities: DxfEntity[] = []; const skipped: Record<string, number> = Object.create(null);
  const skip = (reason: string) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
  const input = records(sections.get('ENTITIES')!);
  let count = 0; let vertices = 0;
  const nonPlanar = (p: Pair[]) => [30, 31, 38, 39, 210, 220].some((c) => numeric(p, c, 0) !== 0) || numeric(p, 230, 1) !== 1;
  for (let i = 0; i < input.length; i++) {
    const entry = input[i]; const p = entry.pairs;
    if (++count > MAX_DXF_ENTITIES) throw new Error('Too many DXF entities');
    const children: RecordEntry[] = [];
    if (entry.type === 'POLYLINE') {
      while (input[i + 1]?.type === 'VERTEX') { children.push(input[++i]); if (++vertices > MAX_DXF_VERTICES) throw new Error('Too many DXF vertices'); }
      if (input[++i]?.type !== 'SEQEND') throw new Error('Incomplete DXF polyline');
    }
    if (!['LINE', 'POLYLINE', 'CIRCLE', 'TEXT'].includes(entry.type)) { skip(`ENTITY:${entry.type}`); continue; }
    if (nonPlanar(p) || children.some((child) => nonPlanar(child.pairs))) { skip('3D'); continue; }
    if (integer(p, 67, 0) !== 0) { skip('PAPER_SPACE'); continue; }
    const id = layerId(value(p, 8)?.trim() ?? '0');
    const aci = integer(p, 62, 256); const lt = value(p, 6)?.trim() ?? 'BYLAYER';
    if (aci === 0 || lt === 'BYBLOCK') { skip('BYBLOCK'); continue; }
    if (aci < 0) { skip('INVISIBLE'); continue; }
    const style: EntityStyle = { layerId: id, ...(aci !== 256 ? { color: color(aci) } : {}), ...(lt !== 'BYLAYER' ? { lineType: lineType(lt) } : {}) };
    if (entry.type === 'LINE') entities.push({ ...style, type: 'LINE', from: point(p), to: point(p, 11, 21) });
    if (entry.type === 'CIRCLE') {
      const radius = numeric(p, 40); if (radius <= 0) throw new Error('Invalid circle radius');
      entities.push({ ...style, type: 'CIRCLE', center: point(p), radius });
    }
    if (entry.type === 'POLYLINE') {
      const flags = integer(p, 70, 0);
      if ((flags & ~129) || children.some((child) => integer(child.pairs, 70, 0) !== 0)) { skip('POLYLINE_FLAGS'); continue; }
      if ([p, ...children.map((child) => child.pairs)].some((pairs) => [40, 41, 42].some((c) => numeric(pairs, c, 0) !== 0))) { skip('POLYLINE_CURVE_OR_WIDTH'); continue; }
      if (children.length < (flags & 1 ? 3 : 2)) throw new Error('Invalid polyline vertex count');
      entities.push({ ...style, type: 'POLYLINE', closed: Boolean(flags & 1), points: children.map((child) => point(child.pairs)) });
    }
    if (entry.type === 'TEXT') {
      if ([51, 71, 72, 73].some((c) => numeric(p, c, 0) !== 0) || numeric(p, 41, 1) !== 1) { skip('TEXT_ALIGNMENT'); continue; }
      const height = numeric(p, 40); const text = value(p, 1) ?? '';
      if (height <= 0 || !text || Array.from(text).some((c) => c.charCodeAt(0) < 32 || c === '\uFFFD')) throw new Error('Invalid DXF text or encoding');
      warnings.add('TEXT_FONT');
      if (text.includes('%%')) warnings.add('TEXT_ESCAPE');
      entities.push({ ...style, type: 'TEXT', at: point(p), text, height, angle: numeric(p, 50, 0) });
    }
  }
  let bounds: DxfDrawing['bounds'] = null;
  const include = ({ x, y }: DxfPoint) => {
    if (!bounds) bounds = { minX: x, minY: y, maxX: x, maxY: y };
    else { bounds.minX = Math.min(bounds.minX, x); bounds.minY = Math.min(bounds.minY, y); bounds.maxX = Math.max(bounds.maxX, x); bounds.maxY = Math.max(bounds.maxY, y); }
  };
  for (const entity of entities) {
    if (entity.type === 'LINE') { include(entity.from); include(entity.to); }
    else if (entity.type === 'POLYLINE') entity.points.forEach(include);
    else if (entity.type === 'CIRCLE') { include({ x: entity.center.x - entity.radius, y: entity.center.y - entity.radius }); include({ x: entity.center.x + entity.radius, y: entity.center.y + entity.radius }); }
    else { include(entity.at); }
  }
  // $MEASUREMENT selects metric/imperial conventions, not a physical input unit.
  const unit = ({ '1': 'inch', '4': 'mm', '5': 'cm', '6': 'm' } as const)[variable('$INSUNITS') as '1' | '4' | '5' | '6'] ?? null;
  return { entities, layers, bounds, unit, skipped, warnings: [...warnings] };
}
