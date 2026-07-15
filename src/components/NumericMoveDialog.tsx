import { useId, useState } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import { unitToMm } from '../types';
import { reassignObjectIdsAndReferences } from '../utils/objectIds';
import { updateLinkedSemanticObjects } from '../utils/semanticObjects';
import { createAsyncCanvasMutationGuard } from '../utils/canvasCommands';
import Dialog from './Dialog';

interface Props {
  onClose: () => void;
}

export default function NumericMoveDialog({ onClose }: Props) {
  const canvas = useEditorStore((s) => s.canvas);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  const drawingMode = useEditorStore((s) => s.drawingMode);
  const cadUnit = useEditorStore((s) => s.cadUnit);
  const showToast = useEditorStore((s) => s.showToast);
  const t = useI18n((s) => s.t);

  const [dxDraft, setDxDraft] = useState('0');
  const [dyDraft, setDyDraft] = useState('0');
  const xId = useId();
  const yId = useId();

  const isCad = drawingMode === 'cad';
  const unit = isCad ? cadUnit : 'px';

  const toInternal = (val: number) => (isCad ? unitToMm(val, cadUnit) : val);

  const dx = Number(dxDraft);
  const dy = Number(dyDraft);
  const validOffsets = dxDraft.trim() !== '' && dyDraft.trim() !== '' && Number.isFinite(dx) && Number.isFinite(dy);

  const getSelectedObject = () => {
    const object = canvas?.getActiveObject() ?? null;
    if (!object) showToast(t('noSelection'), 'error');
    return object;
  };

  const handleMove = () => {
    if (!canvas || !validOffsets) return;
    const pxDx = toInternal(dx);
    const pxDy = toInternal(dy);
    const object = getSelectedObject();
    if (!object) return;
    object.set({ left: (object.left || 0) + pxDx, top: (object.top || 0) + pxDy });
    object.setCoords();
    updateLinkedSemanticObjects(canvas);
    canvas.requestRenderAll();
    pushHistory();
    onClose();
  };

  const handleCopy = async () => {
    if (!canvas || !validOffsets) return;
    const pxDx = toInternal(dx);
    const pxDy = toInternal(dy);
    const object = getSelectedObject();
    if (!object) return;
    const canCommit = createAsyncCanvasMutationGuard(canvas);
    try {
      const cloned = await object.clone();
      if (!canCommit()) {
        cloned.dispose();
        return;
      }
      const clones = cloned instanceof fabric.ActiveSelection
        ? (() => {
          const children = [...cloned.getObjects()];
          cloned.remove(...children);
          cloned.dispose();
          return children;
        })()
        : [cloned];
      reassignObjectIdsAndReferences(clones);
      canvas.discardActiveObject();
      clones.forEach((clone) => {
        clone.set({
          left: (clone.left || 0) + pxDx,
          top: (clone.top || 0) + pxDy,
        });
        canvas.add(clone);
      });
      updateLinkedSemanticObjects(canvas);
      if (clones.length === 1) {
        canvas.setActiveObject(clones[0]);
      } else if (clones.length > 1) {
        const sel = new fabric.ActiveSelection(clones, { canvas });
        canvas.setActiveObject(sel);
      }
      canvas.requestRenderAll();
      pushHistory();
      onClose();
    } catch {
      showToast(t('loadError'), 'error');
    }
  };

  const step = isCad ? (cadUnit === 'mm' ? 1 : cadUnit === 'cm' ? 0.1 : 0.001) : 1;

  return (
    <Dialog
      title={t('numericMoveTitle')}
      onClose={onClose}
      closeLabel={t('cancel')}
      className="nm-dialog"
      footer={(
        <div className="nm-actions">
          <button className="toolbar-btn nm-btn" onClick={handleMove} disabled={!validOffsets}>{t('moveBtn')}</button>
          <button className="toolbar-btn nm-btn" onClick={handleCopy} disabled={!validOffsets}>{t('copyBtn')}</button>
          <button className="toolbar-btn nm-btn nm-cancel" onClick={onClose}>{t('cancel')}</button>
        </div>
      )}
    >
      <div className="modal-body">
          <div className="nm-row">
            <label htmlFor={xId}>{t('offsetX')} ({unit})</label>
            <input
              id={xId}
              type="number"
              value={dxDraft}
              onChange={(e) => setDxDraft(e.target.value)}
              step={step}
              data-autofocus
            />
          </div>
          <div className="nm-row">
            <label htmlFor={yId}>{t('offsetY')} ({unit})</label>
            <input
              id={yId}
              type="number"
              value={dyDraft}
              onChange={(e) => setDyDraft(e.target.value)}
              step={step}
            />
          </div>
      </div>
    </Dialog>
  );
}
