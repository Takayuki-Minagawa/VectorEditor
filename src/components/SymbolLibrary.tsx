import { useEffect, useId, useState } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import { FABRIC_CUSTOM_PROPERTIES } from '../utils/fabricObjectMetadata';
import {
  reassignObjectIdsAndReferences,
  translateSemanticAnchors,
} from '../utils/objectIds';
import { releaseActiveSelectionObjects } from '../utils/fabricObjectTree';
import { updateLinkedSemanticObjects } from '../utils/semanticObjects';
import { createAsyncCanvasMutationGuard } from '../utils/canvasCommands';
import { canvasCadLayers, canonicalizeSerializedLayers, mergeObjectLayers } from '../utils/cadLayers';
import {
  deleteSymbol,
  listSymbols,
  saveSymbol,
} from '../services/symbolRepository';
import type { SymbolRecord } from '../services/symbolRepository';
import Dialog from './Dialog';
import IconButton from './IconButton';

const PLACEMENT_OFFSET = 20;

function createId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `symbol_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export default function SymbolLibrary() {
  const canvas = useEditorStore((state) => state.canvas);
  const selectedObjectIds = useEditorStore((state) => state.selectedObjectIds);
  const pushHistory = useEditorStore((state) => state.pushHistory);
  const t = useI18n((state) => state.t);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [symbols, setSymbols] = useState<SymbolRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const nameId = useId();

  useEffect(() => {
    if (!open) return;
    setBusy(true);
    listSymbols()
      .then(setSymbols)
      .catch(() => useEditorStore.getState().showToast(t('symbolStorageError'), 'error'))
      .finally(() => setBusy(false));
  }, [open, t]);

  const addSymbol = async () => {
    if (!canvas || selectedObjectIds.length === 0 || !name.trim() || busy) return;
    const active = canvas.getActiveObject();
    if (!active || canvas.getActiveObjects().length === 0) return;
    setBusy(true);
    try {
      let thumbnail: string | undefined;
      try {
        thumbnail = active.toDataURL({ format: 'png', multiplier: 0.35 });
      } catch {
        thumbnail = undefined;
      }
      const now = new Date().toISOString();
      const record: SymbolRecord = {
        id: createId(),
        name: name.trim(),
        // Keep an ActiveSelection as one serialized object so its group
        // transform (rotation/scale and child-local coordinates) is retained.
        objects: [active.toObject([...FABRIC_CUSTOM_PROPERTIES])],
        cadLayers: structuredClone(canvasCadLayers(canvas)),
        thumbnail,
        createdAt: now,
        updatedAt: now,
      };
      canonicalizeSerializedLayers(record.objects);
      await saveSymbol(record);
      setSymbols((current) => [record, ...current]);
      setName('');
      useEditorStore.getState().showToast(t('symbolSaved'), 'success');
    } catch {
      useEditorStore.getState().showToast(t('symbolStorageError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const placeSymbol = async (record: SymbolRecord) => {
    if (!canvas || busy) return;
    setBusy(true);
    const canCommit = createAsyncCanvasMutationGuard(canvas);
    try {
      const revived = await fabric.util.enlivenObjects<fabric.FabricObject>(record.objects);
      if (!canCommit()) {
        revived.forEach((object) => object.dispose());
        return;
      }
      const objects = revived.flatMap(releaseActiveSelectionObjects);
      mergeObjectLayers(canvas, objects, record.cadLayers ?? []);
      reassignObjectIdsAndReferences(objects, { dropExternalReferences: true });
      translateSemanticAnchors(objects, PLACEMENT_OFFSET, PLACEMENT_OFFSET);
      objects.forEach((object) => {
        object.set({
          left: (object.left || 0) + PLACEMENT_OFFSET,
          top: (object.top || 0) + PLACEMENT_OFFSET,
        });
        object.setCoords();
        canvas.add(object);
      });
      updateLinkedSemanticObjects(canvas);
      canvas.discardActiveObject();
      if (objects.length === 1) canvas.setActiveObject(objects[0]);
      else if (objects.length > 1) canvas.setActiveObject(new fabric.ActiveSelection(objects, { canvas }));
      canvas.requestRenderAll();
      pushHistory();
      setOpen(false);
    } catch {
      useEditorStore.getState().showToast(t('symbolStorageError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeSymbol = async (record: SymbolRecord) => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteSymbol(record.id);
      setSymbols((current) => current.filter((item) => item.id !== record.id));
    } catch {
      useEditorStore.getState().showToast(t('symbolStorageError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="toolbar-btn symbol-library-btn" onClick={() => setOpen(true)} title={t('symbolLibrary')}>
        ◫ {t('symbols')}
      </button>
      {open && (
        <Dialog title={t('symbolLibrary')} onClose={() => setOpen(false)} closeLabel={t('measureClose')} className="symbol-dialog">
          <div className="modal-body">
            <div className="symbol-save-row">
              <label htmlFor={nameId}>{t('symbolName')}</label>
              <input
                id={nameId}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('symbolName')}
                data-autofocus
              />
              <button className="toolbar-btn" onClick={addSymbol} disabled={busy || selectedObjectIds.length === 0 || !name.trim()}>
                {t('saveSelectionAsSymbol')}
              </button>
            </div>
            <div className="symbol-grid" aria-busy={busy}>
              {!busy && symbols.length === 0 && <p className="layer-empty">{t('noSymbols')}</p>}
              {symbols.map((record) => (
                <div key={record.id} className="symbol-card">
                  <button className="symbol-place" onClick={() => placeSymbol(record)} disabled={busy} title={t('placeSymbol')}>
                    {record.thumbnail ? <img src={record.thumbnail} alt="" /> : <span className="symbol-placeholder">◇</span>}
                    <span>{record.name}</span>
                  </button>
                  <IconButton className="symbol-delete" onClick={() => removeSymbol(record)} disabled={busy} label={t('deleteSymbol')}>
                    ×
                  </IconButton>
                </div>
              ))}
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
