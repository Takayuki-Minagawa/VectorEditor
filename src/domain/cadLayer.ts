export type CadLineType = 'continuous' | 'dashed' | 'dotted';
export interface CadLayer {
  id: string;
  name: string;
  color: string;
  lineType: CadLineType;
  lineWidth: number;
  visible: boolean;
  locked: boolean;
  printable: boolean;
}
export const DEFAULT_CAD_LAYER: CadLayer = { id: '0', name: '0', color: '#333333', lineType: 'continuous', lineWidth: 1, visible: true, locked: false, printable: true };
export function defaultCadLayers(): CadLayer[] { return [{ ...DEFAULT_CAD_LAYER }]; }
export function validateCadLayers(value: unknown): CadLayer[] {
  if (!Array.isArray(value) || !value.length || value.length > 200) throw new Error('Invalid CAD layers');
  const ids = new Set<string>(); const names = new Set<string>();
  const layers = value.map((item: unknown): CadLayer => {
    if (!item || typeof item !== 'object') throw new Error('Invalid CAD layer');
    const l = item as CadLayer;
    if (typeof l.id !== 'string' || !l.id || l.id.length > 100 || ids.has(l.id)
      || typeof l.name !== 'string' || !l.name.trim() || l.name.length > 80 || Array.from(l.name).some((c) => c.charCodeAt(0) < 32) || names.has(l.name.trim())
      || !/^#[0-9a-f]{6}$/i.test(l.color) || !['continuous', 'dashed', 'dotted'].includes(l.lineType)
      || !Number.isFinite(l.lineWidth) || l.lineWidth < 0 || l.lineWidth > 100
      || typeof l.visible !== 'boolean' || typeof l.locked !== 'boolean' || typeof l.printable !== 'boolean') throw new Error('Invalid CAD layer');
    ids.add(l.id); names.add(l.name.trim());
    return { id: l.id, name: l.name.trim(), color: l.color, lineType: l.lineType, lineWidth: l.lineWidth, visible: l.visible, locked: l.locked, printable: l.printable };
  });
  if (!ids.has('0')) throw new Error('Default CAD layer is required');
  return layers;
}
export function layerDashArray(layer: CadLayer): number[] | null {
  return layer.lineType === 'dashed' ? [8, 4] : layer.lineType === 'dotted' ? [1, 3] : null;
}
