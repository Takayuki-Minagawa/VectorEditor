import { useId, useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import Dialog from './Dialog';

interface StretchDialogProps {
  onApply: (dx: number, dy: number) => void;
  onCancel: () => void;
}

export default function StretchDialog({
  onApply,
  onCancel,
}: StretchDialogProps) {
  const drawingMode = useEditorStore((s) => s.drawingMode);
  const cadUnit = useEditorStore((s) => s.cadUnit);
  const t = useI18n((s) => s.t);
  const isCad = drawingMode === 'cad';
  const unit = isCad ? cadUnit : 'px';
  const step = isCad ? (cadUnit === 'mm' ? 1 : cadUnit === 'cm' ? 0.1 : 0.001) : 1;
  const xId = useId();
  const yId = useId();
  const [dxDraft, setDxDraft] = useState('0');
  const [dyDraft, setDyDraft] = useState('0');
  const dx = Number(dxDraft);
  const dy = Number(dyDraft);
  const valid = dxDraft.trim() !== '' && dyDraft.trim() !== '' && Number.isFinite(dx) && Number.isFinite(dy);

  return (
    <Dialog
      title={t('stretchTitle')}
      onClose={onCancel}
      closeLabel={t('cancel')}
      className="nm-dialog"
      footer={(
        <div className="nm-actions">
          <button className="toolbar-btn nm-btn" onClick={() => onApply(dx, dy)} disabled={!valid}>{t('stretchApply')}</button>
          <button className="toolbar-btn nm-btn nm-cancel" onClick={onCancel}>{t('cancel')}</button>
        </div>
      )}
    >
      <div className="modal-body">
          <p style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>{t('stretchDesc')}</p>
          <div className="nm-row">
            <label htmlFor={xId}>{t('stretchOffsetX')} ({unit})</label>
            <input id={xId} type="number" value={dxDraft} onChange={(e) => setDxDraft(e.target.value)} step={step} aria-invalid={dxDraft.trim() === '' || !Number.isFinite(dx)} data-autofocus />
          </div>
          <div className="nm-row">
            <label htmlFor={yId}>{t('stretchOffsetY')} ({unit})</label>
            <input id={yId} type="number" value={dyDraft} onChange={(e) => setDyDraft(e.target.value)} step={step} aria-invalid={dyDraft.trim() === '' || !Number.isFinite(dy)} />
          </div>
      </div>
    </Dialog>
  );
}
