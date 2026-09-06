import { PAPER_SIZES, type DrawingMode } from '../types';
import type { ExportFormat, ExportScope } from '../services/exportService';

export const EXPORT_PRESETS_KEY = 'vectoreditor-export-presets-v1';
export const EXPORT_SCALES = ['1:1', '1:10', '1:20', '1:50', '1:100', '1:200', '1:500'];
export interface ExportPreset {
  id: string;
  name: string;
  drawingMode: DrawingMode;
  format: ExportFormat;
  scope: ExportScope;
  margin: number;
  transparent: boolean;
  background: string;
  multiplier: number;
  paperIndex: number;
  scaleString: string;
  landscape: boolean;
}

export function validateExportPresets(value: unknown): ExportPreset[] {
  if (!value || typeof value !== 'object') throw new Error('Invalid presets');
  const data = value as { version?: unknown; presets?: unknown };
  if (data.version !== 1 || !Array.isArray(data.presets) || data.presets.length > 100) throw new Error('Invalid presets');
  const ids = new Set<string>();
  return data.presets.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid preset');
    const p = item as ExportPreset;
    if (typeof p.id !== 'string' || !p.id || p.id.length > 100 || ids.has(p.id)
      || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80
      || !['illustration', 'cad'].includes(p.drawingMode)
      || !['svg', 'png', 'pdf', 'dxf'].includes(p.format)
      || (p.drawingMode !== 'cad' && p.format === 'dxf')
      || !['canvas', 'content', 'selection'].includes(p.scope)
      || !Number.isFinite(p.margin) || p.margin < 0 || p.margin > 100000
      || ![1, 2, 3, 4].includes(p.multiplier)
      || !Number.isInteger(p.paperIndex) || p.paperIndex < 0 || p.paperIndex > 4
      || !EXPORT_SCALES.includes(p.scaleString)
      || typeof p.background !== 'string' || !/^#[0-9a-f]{6}$/i.test(p.background)
      || typeof p.transparent !== 'boolean' || typeof p.landscape !== 'boolean') throw new Error('Invalid preset');
    if (p.drawingMode === 'cad' && p.format !== 'dxf' && p.margin * 2 >= Math.min(PAPER_SIZES[p.paperIndex].width, PAPER_SIZES[p.paperIndex].height)) throw new Error('Invalid page margin');
    ids.add(p.id);
    return { id: p.id, name: p.name.trim(), drawingMode: p.drawingMode, format: p.format, scope: p.scope,
      margin: p.margin, transparent: p.transparent, background: p.background, multiplier: p.multiplier,
      paperIndex: p.paperIndex, scaleString: p.scaleString, landscape: p.landscape };
  });
}

export function loadExportPresets(): { presets: ExportPreset[]; error: boolean } {
  try {
    const raw = localStorage.getItem(EXPORT_PRESETS_KEY);
    return { presets: raw ? validateExportPresets(JSON.parse(raw)) : [], error: false };
  } catch { return { presets: [], error: true }; }
}

export function saveExportPresets(presets: ExportPreset[]): void {
  const value = { version: 1, presets };
  const validated = validateExportPresets(value);
  localStorage.setItem(EXPORT_PRESETS_KEY, JSON.stringify({ version: 1, presets: validated }));
}
