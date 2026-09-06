import { useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import { PAPER_SIZES, parseScaleRatio } from '../types';
import {
  copyExportToClipboard,
  createExportArtifact,
  downloadExportArtifact,
  DrawingExportError,
  isClipboardExportSupported,
} from '../services/exportService';
import type {
  DrawingExportRequest,
  ExportArtifact,
  ExportFormat,
  ExportScope,
} from '../services/exportService';
import Dialog from './Dialog';
import { EXPORT_SCALES, loadExportPresets, saveExportPresets, type ExportPreset } from '../utils/exportPresets';

interface Props {
  onClose: () => void;
}

const SCALES = EXPORT_SCALES;
const MULTIPLIERS = [1, 2, 3, 4];

function colorInputValue(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff';
}

export default function ExportDialog({ onClose }: Props) {
  const canvas = useEditorStore((state) => state.canvas);
  const drawingMode = useEditorStore((state) => state.drawingMode);
  const canvasWidth = useEditorStore((state) => state.canvasWidth);
  const canvasHeight = useEditorStore((state) => state.canvasHeight);
  const cadWidth = useEditorStore((state) => state.cadWidth);
  const cadHeight = useEditorStore((state) => state.cadHeight);
  const documentScale = useEditorStore((state) => state.scale);
  const setDocumentScale = useEditorStore((state) => state.setScale);
  const documentBackground = useEditorStore((state) => state.backgroundColor);
  const selectionCount = useEditorStore((state) => state.selectedObjectIds.length);
  const showToast = useEditorStore((state) => state.showToast);
  const t = useI18n((state) => state.t);

  const isCad = drawingMode === 'cad';
  const [format, setFormat] = useState<ExportFormat>(isCad ? 'pdf' : 'svg');
  const [scope, setScope] = useState<ExportScope>('canvas');
  const [margin, setMargin] = useState(isCad ? '10' : '0');
  const [transparent, setTransparent] = useState(false);
  const [background, setBackground] = useState(colorInputValue(documentBackground));
  const [multiplier, setMultiplier] = useState(2);
  const [fileName, setFileName] = useState(isCad ? 'cad-drawing' : 'vector-drawing');
  const [paperIndex, setPaperIndex] = useState(4);
  const [scaleString, setScaleString] = useState(
    SCALES.includes(documentScale) ? documentScale : '1:100',
  );
  const [landscape, setLandscape] = useState(true);
  const [busy, setBusy] = useState(false);
  const [presetState, setPresetState] = useState(loadExportPresets);
  const [presetId, setPresetId] = useState('');
  const [presetName, setPresetName] = useState('');
  const noSelection = scope === 'selection' && selectionCount === 0;
  const applyPreset = (id: string) => {
    setPresetId(id);
    const p = presetState.presets.find((entry) => entry.id === id && entry.drawingMode === drawingMode);
    if (!p) { setPresetName(''); return; }
    setPresetName(p.name); setFormat(p.format); setScope(p.scope); setMargin(String(p.margin));
    setTransparent(p.transparent); setBackground(p.background); setMultiplier(p.multiplier);
    setPaperIndex(p.paperIndex); setScaleString(p.scaleString); setLandscape(p.landscape);
  };
  const persistPreset = (operation: 'create' | 'update' | 'delete') => {
    try {
      const current = loadExportPresets();
      // Do not silently overwrite an unreadable store.
      if (current.error) throw new Error('Preset storage unavailable');
      const id = operation === 'create' ? crypto.randomUUID() : presetId;
      if (operation !== 'create' && !current.presets.some((entry) => entry.id === id)) throw new Error('Preset no longer exists');
      const preset: ExportPreset = { id, name: presetName.trim(), drawingMode, format, scope,
        margin: Number(margin), transparent, background, multiplier, paperIndex, scaleString, landscape };
      const next = current.presets.filter((entry) => entry.id !== id);
      if (operation !== 'delete') next.push(preset);
      saveExportPresets(next);
      setPresetState({ presets: next, error: false });
      setPresetId(operation === 'delete' ? '' : id);
      if (operation === 'delete') setPresetName('');
      showToast(t('presetSaved'), 'success');
    } catch { showToast(t('presetStorageError'), 'error'); }
  };

  const paper = PAPER_SIZES[paperIndex];
  const paperWidth = landscape ? Math.max(paper.width, paper.height) : Math.min(paper.width, paper.height);
  const paperHeight = landscape ? Math.min(paper.width, paper.height) : Math.max(paper.width, paper.height);
  const clipboardSupported = isClipboardExportSupported(format);
  const multiplierDisabled = isCad && format !== 'png';

  const request = (): DrawingExportRequest => {
    if (!canvas) {
      throw new DrawingExportError('NO_CANVAS', 'Canvas is not available.');
    }
    return {
      canvas,
      drawingMode,
      documentWidth: canvasWidth,
      documentHeight: canvasHeight,
      cadWidth,
      cadHeight,
      format,
      scope,
      margin: Number(margin),
      background: transparent ? null : background,
      multiplier,
      fileName,
      cadPage: isCad
        ? { widthMm: paperWidth, heightMm: paperHeight, scaleRatio: parseScaleRatio(scaleString) }
        : undefined,
    };
  };

  const showWarnings = (artifact: ExportArtifact): void => {
    artifact.warnings.forEach((warning) => {
      if (warning.code === 'cadContentClipped') {
        showToast(t('exportClippedWarning'), 'info');
      } else if (warning.code === 'dxfUnsupported') {
        showToast(`${t('dxfUnsupportedWarning')}: ${warning.details.join(', ')}`, 'info');
      } else {
        showToast(`${t('dxfApproximatedWarning')}: ${warning.details.join(', ')}`, 'info');
      }
    });
  };

  const errorMessage = (error: unknown): string => {
    if (!(error instanceof DrawingExportError)) return t('exportError');
    switch (error.code) {
      case 'NO_SELECTION': return t('exportNoSelection');
      case 'NO_CONTENT': return t('exportNoContent');
      case 'OUTPUT_TOO_LARGE': return t('exportTooLarge');
      case 'CLIPBOARD_UNSUPPORTED': return t('clipboardUnsupported');
      case 'INVALID_OPTIONS': return t('exportInvalidOptions');
      default: return t('exportError');
    }
  };

  const run = async (operation: 'download' | 'copy'): Promise<void> => {
    setBusy(true);
    try {
      const currentRequest = request();
      const artifact = operation === 'copy'
        ? await copyExportToClipboard(currentRequest)
        : await createExportArtifact(currentRequest);
      if (operation === 'download') downloadExportArtifact(artifact);
      showWarnings(artifact);
      showToast(operation === 'copy' ? t('exportCopied') : t('exportDone'), 'success');
      onClose();
    } catch (error) {
      showToast(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t('exportDialogTitle')}
      onClose={onClose}
      closeLabel={t('close')}
      className="export-dialog"
      dismissible={!busy}
      footer={(
        <div className="nm-actions">
          <button
            type="button"
            className="toolbar-btn nm-btn"
            onClick={() => void run('copy')}
            disabled={busy || noSelection || !clipboardSupported}
            title={clipboardSupported ? t('copyToClipboard') : t('clipboardUnsupported')}
          >
            {t('copyToClipboard')}
          </button>
          <button
            type="button"
            className="toolbar-btn nm-btn"
            onClick={() => void run('download')}
            disabled={busy || noSelection}
            data-autofocus
          >
            {busy ? t('exporting') : t('cadExportBtn')}
          </button>
          <button
            type="button"
            className="toolbar-btn nm-btn nm-cancel"
            onClick={onClose}
            disabled={busy}
          >
            {t('cancel')}
          </button>
        </div>
      )}
    >
      <div className="modal-body export-dialog-body">
        <fieldset className="feature-fieldset" disabled={busy}>
          <legend>{t('exportPresets')}</legend>
          <div className="nm-row"><label htmlFor="export-preset">{t('exportPresets')}</label>
            <select id="export-preset" value={presetId} onChange={(event) => applyPreset(event.target.value)}>
              <option value="">{t('presetNone')}</option>
              {presetState.presets.filter((p) => p.drawingMode === drawingMode).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="nm-row"><label htmlFor="preset-name">{t('presetName')}</label><input id="preset-name" maxLength={80} value={presetName} onChange={(event) => setPresetName(event.target.value)} /></div>
          <div className="feature-actions">
            <button className="toolbar-btn" onClick={() => persistPreset('create')} disabled={!presetName.trim()}>{t('presetCreate')}</button>
            <button className="toolbar-btn" onClick={() => persistPreset('update')} disabled={!presetId || !presetName.trim()}>{t('presetUpdate')}</button>
            <button className="toolbar-btn" onClick={() => persistPreset('delete')} disabled={!presetId}>{t('delete')}</button>
          </div>
          {presetState.error && <p role="alert">{t('presetStorageError')}</p>}
        </fieldset>
        {noSelection && <p role="alert">{t('exportNoSelection')}</p>}
        <div className="nm-row">
          <label htmlFor="export-format">{t('exportFormat')}</label>
          <select
            id="export-format"
            value={format}
            onChange={(event) => setFormat(event.target.value as ExportFormat)}
          >
            <option value="svg">SVG</option>
            <option value="png">PNG</option>
            <option value="pdf">PDF</option>
            {isCad && <option value="dxf">DXF R12</option>}
          </select>
        </div>

        <div className="nm-row">
          <label htmlFor="export-scope">{t('exportScope')}</label>
          <select
            id="export-scope"
            value={scope}
            onChange={(event) => setScope(event.target.value as ExportScope)}
          >
            <option value="canvas">{t('exportScopeCanvas')}</option>
            <option value="content">{t('exportScopeContent')}</option>
            <option value="selection" disabled={selectionCount === 0}>
              {t('exportScopeSelection')}
            </option>
          </select>
        </div>

        {isCad && format !== 'dxf' && (
          <>
            <div className="nm-row">
              <label htmlFor="export-paper">{t('paperSize')}</label>
              <select
                id="export-paper"
                value={paperIndex}
                onChange={(event) => setPaperIndex(Number(event.target.value))}
              >
                {PAPER_SIZES.map((size, index) => (
                  <option key={size.label} value={index}>
                    {size.label} ({size.width}&times;{size.height} mm)
                  </option>
                ))}
              </select>
            </div>
            <div className="nm-row">
              <label htmlFor="export-orientation">{t('orientation')}</label>
              <select
                id="export-orientation"
                value={landscape ? 'landscape' : 'portrait'}
                onChange={(event) => setLandscape(event.target.value === 'landscape')}
              >
                <option value="landscape">{t('landscape')}</option>
                <option value="portrait">{t('portrait')}</option>
              </select>
            </div>
            <div className="nm-row">
              <label htmlFor="export-scale">{t('exportScale')}</label>
              <select
                id="export-scale"
                value={scaleString}
                onChange={(event) => {
                  setScaleString(event.target.value);
                  setDocumentScale(event.target.value);
                }}
              >
                {SCALES.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>
          </>
        )}

        {format !== 'dxf' && (
          <>
            <div className="nm-row">
              <label htmlFor="export-margin">
                {t('exportMargin')} ({isCad ? 'mm' : 'px'})
              </label>
              <input
                id="export-margin"
                type="number"
                min="0"
                max={isCad ? Math.floor(Math.min(paperWidth, paperHeight) / 2) - 1 : undefined}
                step="1"
                value={margin}
                onChange={(event) => setMargin(event.target.value)}
              />
            </div>
            <div className="nm-row export-background-row">
              <label htmlFor="export-transparent">{t('exportBackground')}</label>
              <label className="export-check-label">
                <input
                  id="export-transparent"
                  type="checkbox"
                  checked={transparent}
                  onChange={(event) => setTransparent(event.target.checked)}
                />
                {t('exportTransparent')}
              </label>
              <input
                type="color"
                value={background}
                onChange={(event) => setBackground(event.target.value)}
                disabled={transparent}
                aria-label={t('exportBackgroundColor')}
              />
            </div>
            <div className="nm-row">
              <label htmlFor="export-multiplier">{t('exportMultiplier')}</label>
              <select
                id="export-multiplier"
                value={multiplier}
                onChange={(event) => setMultiplier(Number(event.target.value))}
                disabled={multiplierDisabled}
              >
                {MULTIPLIERS.map((value) => <option key={value} value={value}>{value}&times;</option>)}
              </select>
            </div>
          </>
        )}

        <div className="nm-row">
          <label htmlFor="export-filename">{t('exportFileName')}</label>
          <input
            id="export-filename"
            type="text"
            value={fileName}
            onChange={(event) => setFileName(event.target.value)}
            spellCheck={false}
          />
        </div>

        {isCad && format !== 'dxf' && (
          <p className="export-info">
            {paperWidth}&times;{paperHeight} mm / {scaleString}
          </p>
        )}
        {(format === 'svg' || format === 'png') && !clipboardSupported && (
          <p className="export-info">{t('clipboardUnsupported')}</p>
        )}
      </div>
    </Dialog>
  );
}
