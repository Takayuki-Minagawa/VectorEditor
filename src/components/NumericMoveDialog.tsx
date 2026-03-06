import { useState } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import { unitToMm } from '../types';

interface Props {
  onClose: () => void;
}

export default function NumericMoveDialog({ onClose }: Props) {
  const canvas = useEditorStore((s) => s.canvas);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  const drawingMode = useEditorStore((s) => s.drawingMode);
  const cadUnit = useEditorStore((s) => s.cadUnit);
  const t = useI18n((s) => s.t);

  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);

  const isCad = drawingMode === 'cad';
  const unit = isCad ? cadUnit : 'px';

  const toInternal = (val: number) => (isCad ? unitToMm(val, cadUnit) : val);

  const handleMove = () => {
    if (!canvas) return;
    const pxDx = toInternal(dx);
    const pxDy = toInternal(dy);
    const objects = canvas.getActiveObjects();
    if (objects.length === 0) return;
    objects.forEach((obj) => {
      obj.set({ left: (obj.left || 0) + pxDx, top: (obj.top || 0) + pxDy });
      obj.setCoords();
    });
    canvas.requestRenderAll();
    pushHistory();
    onClose();
  };

  const handleCopy = () => {
    if (!canvas) return;
    const pxDx = toInternal(dx);
    const pxDy = toInternal(dy);
    const objects = canvas.getActiveObjects();
    if (objects.length === 0) return;
    Promise.all(objects.map((obj) => obj.clone())).then((clones) => {
      canvas.discardActiveObject();
      clones.forEach((clone) => {
        clone.set({
          left: (clone.left || 0) + pxDx,
          top: (clone.top || 0) + pxDy,
        });
        canvas.add(clone);
      });
      if (clones.length === 1) {
        canvas.setActiveObject(clones[0]);
      } else if (clones.length > 1) {
        const sel = new fabric.ActiveSelection(clones, { canvas });
        canvas.setActiveObject(sel);
      }
      canvas.requestRenderAll();
      pushHistory();
    });
    onClose();
  };

  const step = isCad ? (cadUnit === 'mm' ? 1 : cadUnit === 'cm' ? 0.1 : 0.001) : 1;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content nm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t('numericMoveTitle')}</span>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="nm-row">
            <label>{t('offsetX')} ({unit})</label>
            <input
              type="number"
              value={dx}
              onChange={(e) => setDx(Number(e.target.value))}
              step={step}
              autoFocus
            />
          </div>
          <div className="nm-row">
            <label>{t('offsetY')} ({unit})</label>
            <input
              type="number"
              value={dy}
              onChange={(e) => setDy(Number(e.target.value))}
              step={step}
            />
          </div>
        </div>
        <div className="nm-actions">
          <button className="toolbar-btn nm-btn" onClick={handleMove}>{t('moveBtn')}</button>
          <button className="toolbar-btn nm-btn" onClick={handleCopy}>{t('copyBtn')}</button>
          <button className="toolbar-btn nm-btn nm-cancel" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </div>
  );
}
