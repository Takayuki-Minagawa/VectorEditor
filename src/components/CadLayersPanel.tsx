import { useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import { DEFAULT_CAD_LAYER, validateCadLayers, type CadLayer } from '../domain/cadLayer';
import { assignCadLayer, restoreIndividualAppearance } from '../utils/cadLayers';
import { collectFabricObjectTree } from '../utils/fabricObjectTree';
import { getFabricMetadata, setFabricMetadataValues } from '../utils/fabricObjectMetadata';
import Dialog from './Dialog';

export default function CadLayersPanel() {
  const layers = useEditorStore((s) => s.cadLayers);
  const activeId = useEditorStore((s) => s.activeCadLayerId);
  const selected = useEditorStore((s) => s.selectedObjectIds);
  const drawingMode = useEditorStore((s) => s.drawingMode);
  const t = useI18n((s) => s.t);
  const [draft, setDraft] = useState<CadLayer[] | null>(null);
  const [error, setError] = useState(false);
  if (drawingMode !== 'cad') return null;

  const update = (id: string, patch: Partial<CadLayer>) => setDraft((current) => current!.map((layer) => layer.id === id ? { ...layer, ...patch } : layer));
  const add = () => {
    let name = t('cadNewLayer'); let index = 2;
    while (draft!.some((layer) => layer.name === name)) name = `${t('cadNewLayer')} ${index++}`;
    setDraft([...draft!, { ...DEFAULT_CAD_LAYER, id: `layer_${crypto.randomUUID()}`, name }]);
  };
  const save = () => {
    try {
      const next = validateCadLayers(draft);
      const state = useEditorStore.getState();
      const ids = new Set(next.map((l) => l.id));
      // Deleting a layer moves only its own members to 0, preserving child memberships.
      for (const object of collectFabricObjectTree(state.canvas?.getObjects() ?? [])) {
        const metadata = getFabricMetadata(object);
        if (metadata.cadLayerId && !ids.has(metadata.cadLayerId)) {
          if (metadata.cadOwnAppearance) restoreIndividualAppearance(object, metadata.cadOwnAppearance);
          setFabricMetadataValues(object, { cadLayerId: '0', cadStyleMode: 'object', cadOwnAppearance: undefined });
        }
      }
      state.setCadLayers(next, ids.has(activeId) ? activeId : '0');
      setDraft(null);
    } catch { setError(true); }
  };
  const assign = (mode: 'object' | 'layer') => {
    const state = useEditorStore.getState();
    if (!state.canvas) return;
    try { assignCadLayer(state.canvas.getActiveObjects(), activeId, mode); state.pushHistory(); }
    catch { state.showToast(t('cadPatternError'), 'error'); }
  };
  return <section className="cad-layers-panel" aria-label={t('cadLayers')}>
    <div className="prop-section-title">{t('cadLayers')}</div>
    <label className="cad-layer-select">{t('cadActiveLayer')}
      <select value={activeId} onChange={(event) => useEditorStore.getState().setCadLayers(layers, event.target.value)}>
        {layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
      </select>
    </label>
    <button className="toolbar-btn" onClick={() => { setDraft(structuredClone(layers)); setError(false); }}>{t('cadManageLayers')}</button>
    <p className="cad-layer-hint">{t('cadAssignHint')}</p>
    <div className="cad-layer-buttons">
      <button className="toolbar-btn" disabled={!selected.length} onClick={() => assign('layer')}>{t('cadByLayer')}</button>
      <button className="toolbar-btn" disabled={!selected.length} onClick={() => assign('object')}>{t('cadIndividual')}</button>
    </div>
    {draft && <Dialog title={t('cadManageLayers')} onClose={() => setDraft(null)} closeLabel={t('measureClose')} className="cad-layer-dialog"
      footer={<div className="nm-actions"><button className="toolbar-btn nm-btn nm-cancel" onClick={() => setDraft(null)}>{t('cancel')}</button><button className="toolbar-btn nm-btn" onClick={save}>{t('save')}</button></div>}>
      <div className="modal-body">
        <p>{t('cadLayerRules')}</p>
        <div className="cad-layer-table-scroll"><table className="cad-layer-table"><thead><tr>
          {[t('cadLayerName'), t('strokeColor'), t('lineStyle'), t('strokeWidth'), t('cadVisible'), t('lock'), t('cadPrintable'), ''].map((label, index) => <th key={index}>{label}</th>)}
        </tr></thead><tbody>{draft.map((layer) => <tr key={layer.id}>
          <td><input aria-label={`${t('cadLayerName')} ${layer.name}`} value={layer.name} maxLength={80} disabled={layer.id === '0'} onChange={(e) => update(layer.id, { name: e.target.value })} /></td>
          <td><input type="color" aria-label={`${t('strokeColor')} ${layer.name}`} value={layer.color} onChange={(e) => update(layer.id, { color: e.target.value })} /></td>
          <td><select aria-label={`${t('lineStyle')} ${layer.name}`} value={layer.lineType} onChange={(e) => update(layer.id, { lineType: e.target.value as CadLayer['lineType'] })}>
            <option value="continuous">{t('solid')}</option><option value="dashed">{t('dashed')}</option><option value="dotted">{t('dotted')}</option>
          </select></td>
          <td><input type="number" aria-label={`${t('strokeWidth')} ${layer.name}`} min={0} max={100} step={0.1} value={layer.lineWidth} onChange={(e) => update(layer.id, { lineWidth: e.target.valueAsNumber })} /></td>
          {(['visible', 'locked', 'printable'] as const).map((key) => <td key={key}><input type="checkbox" aria-label={`${t(key === 'visible' ? 'cadVisible' : key === 'locked' ? 'lock' : 'cadPrintable')} ${layer.name}`} checked={layer[key]} onChange={(e) => update(layer.id, { [key]: e.target.checked })} /></td>)}
          <td><button className="toolbar-btn" disabled={layer.id === '0'} aria-label={`${t('delete')} ${layer.name}`} onClick={() => setDraft(draft.filter((l) => l.id !== layer.id))}>×</button></td>
        </tr>)}</tbody></table></div>
        <button className="toolbar-btn" onClick={add} disabled={draft.length >= 200}>{t('cadAddLayer')}</button>
        {error && <p role="alert">{t('cadLayerError')}</p>}
      </div>
    </Dialog>}
  </section>;
}
