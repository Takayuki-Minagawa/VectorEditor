import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EXPORT_PRESETS_KEY, loadExportPresets, saveExportPresets, validateExportPresets, type ExportPreset } from './exportPresets';
const preset: ExportPreset = { id: 'one', name: 'Report', drawingMode: 'cad', format: 'pdf', scope: 'selection', margin: 10, transparent: false, background: '#ffffff', multiplier: 2, paperIndex: 4, scaleString: '1:100', landscape: true };
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
describe('export presets', () => {
  it('round-trips presets independently of document data', () => {
    saveExportPresets([preset]);
    expect(loadExportPresets()).toEqual({ presets: [preset], error: false });
    saveExportPresets([{ ...preset, name: 'Updated', scaleString: '1:50' }]);
    expect(loadExportPresets().presets[0].scaleString).toBe('1:50');
    saveExportPresets([]); expect(loadExportPresets().presets).toEqual([]);
  });
  it.each([null, {}, { version: 2, presets: [] }, { version: 1, presets: [preset, preset] }, { version: 1, presets: [{ ...preset, margin: -1 }] }, { version: 1, presets: [{ ...preset, format: 'exe' }] }, { version: 1, presets: [{ ...preset, drawingMode: 'illustration', format: 'dxf' }] }])('rejects invalid data %j', (data) => {
    expect(() => validateExportPresets(data)).toThrow();
  });
  it('keeps corrupt storage intact and reports an empty fallback', () => {
    localStorage.setItem(EXPORT_PRESETS_KEY, '{broken');
    expect(loadExportPresets()).toEqual({ presets: [], error: true });
    expect(localStorage.getItem(EXPORT_PRESETS_KEY)).toBe('{broken');
  });
  it('reports storage failures instead of pretending to save', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    expect(() => saveExportPresets([preset])).toThrow();
  });
});
