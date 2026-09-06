import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import { createAsyncCanvasMutationGuard } from '../utils/canvasCommands';
import { insertDxfDrawing, readDxfFile } from '../services/dxfImporter';
import { DXF_UNIT_SCALE, type DxfDrawing, type DxfUnit } from '../domain/dxf';
import type { TranslationKeys } from '../i18n/ja';
import Dialog from './Dialog';

const reasonKeys: Record<string, TranslationKeys> = {
  '3D': 'dxfReason3d', PAPER_SPACE: 'dxfReasonPaper', BYBLOCK: 'dxfReasonBlock', INVISIBLE: 'dxfReasonInvisible',
  POLYLINE_FLAGS: 'dxfReasonPolyline', POLYLINE_CURVE_OR_WIDTH: 'dxfReasonCurve', TEXT_ALIGNMENT: 'dxfReasonText',
  ACI_COLOR: 'dxfWarningColor', LINE_TYPE: 'dxfWarningLine', TEXT_FONT: 'dxfWarningFont', TEXT_ESCAPE: 'dxfWarningEscape',
};
export default function DxfImportDialog({ onClose }: { onClose: () => void }) {
  const t = useI18n((s) => s.t);
  const [file, setFile] = useState<File | null>(null);
  const [encoding, setEncoding] = useState<'utf-8' | 'shift_jis'>('utf-8');
  const [drawing, setDrawing] = useState<DxfDrawing | null>(null);
  const [unit, setUnit] = useState<DxfUnit | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const owner = useRef<(() => boolean) | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const reset = () => { pending.current?.abort(); pending.current = null; setDrawing(null); setError(false); setBusy(false); setUnit(''); };
  const preview = async () => {
    const canvas = useEditorStore.getState().canvas;
    if (!file || !canvas) return;
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
    owner.current = createAsyncCanvasMutationGuard(canvas);
    setBusy(true); setDrawing(null); setError(false);
    try {
      const result = await readDxfFile(file, encoding, controller.signal);
      if (!controller.signal.aborted) { setDrawing(result); setUnit(result.unit ?? ''); }
    } catch { if (!controller.signal.aborted) setError(true); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const insert = () => {
    if (!drawing || !unit) return;
    try {
      if (!owner.current?.()) throw new Error('The document changed');
      insertDxfDrawing(drawing, unit); onClose();
      useEditorStore.getState().showToast(t('dxfImported'), 'success');
    } catch { setError(true); }
  };
  const bounds = drawing?.bounds;
  const scale = unit ? DXF_UNIT_SCALE[unit] : 1;
  const format = (n: number) => (n * scale).toLocaleString(undefined, { maximumFractionDigits: 3 });
  const reason = (key: string) => reasonKeys[key] ? t(reasonKeys[key]) : `${t('dxfUnsupportedEntity')}: ${key.replace(/^ENTITY:/, '')}`;
  return <Dialog title={t('dxfImport')} onClose={onClose} closeLabel={t('measureClose')} className="dxf-import-dialog"
    footer={<div className="nm-actions"><button className="toolbar-btn nm-btn nm-cancel" onClick={onClose}>{t('cancel')}</button><button className="toolbar-btn nm-btn" onClick={insert} disabled={busy || !unit || !drawing?.entities.length}>{t('dxfInsert')}</button></div>}>
    <div className="modal-body dxf-import-body">
      <p>{t('dxfScope')}</p>
      <label>{t('dxfFile')}<input type="file" accept=".dxf" onChange={(e) => { reset(); setFile(e.target.files?.[0] ?? null); }} /></label>
      <label>{t('dxfEncoding')}<select value={encoding} onChange={(e) => { reset(); setEncoding(e.target.value as typeof encoding); }}><option value="utf-8">UTF-8 / ASCII</option><option value="shift_jis">Shift_JIS</option></select></label>
      <button className="toolbar-btn" disabled={!file || busy} onClick={preview}>{t('dxfPreview')}</button>
      {busy && <div role="status">{t('dxfReading')} <button className="toolbar-btn" onClick={reset}>{t('cancel')}</button></div>}
      {error && <p role="alert">{t('dxfImportError')}</p>}
      {drawing && <section className="dxf-preview" aria-label={t('dxfPreview')}>
        <p>{t('dxfCounts').replace('{supported}', String(drawing.entities.length)).replace('{skipped}', String(Object.values(drawing.skipped).reduce((a, b) => a + b, 0)))}</p>
        <p>{['LINE', 'POLYLINE', 'CIRCLE', 'TEXT'].map((type) => `${type}: ${drawing.entities.filter((entity) => entity.type === type).length}`).join(' / ')}</p>
        <label>{t('dxfInputUnit')}<select aria-label={t('dxfInputUnit')} value={unit} onChange={(e) => setUnit(e.target.value as DxfUnit | '')}>
          <option value="">{t('dxfChooseUnit')}</option>{Object.keys(DXF_UNIT_SCALE).map((key) => <option key={key} value={key}>{key}</option>)}
        </select></label>
        {!drawing.unit && <p>{t('dxfUnknownUnit')}</p>}
        {bounds && <p>{t('dxfBounds')}: X [{format(bounds.minX)}, {format(bounds.maxX)}], Y [{format(bounds.minY)}, {format(bounds.maxY)}] {unit ? 'mm' : t('dxfSourceUnits')}</p>}
        <p>{t('dxfOrigin')}</p>
        {Object.keys(drawing.skipped).length > 0 && <ul>{Object.entries(drawing.skipped).map(([key, count]) => <li key={key}>{reason(key)}: {count}</li>)}</ul>}
        {drawing.warnings.length > 0 && <ul>{drawing.warnings.map((key) => <li key={key}>{reason(key)}</li>)}</ul>}
      </section>}
    </div>
  </Dialog>;
}
