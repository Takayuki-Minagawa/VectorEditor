import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';

interface StretchDialogProps {
  stretchDx: number;
  stretchDy: number;
  setStretchDx: (v: number) => void;
  setStretchDy: (v: number) => void;
  onApply: () => void;
  onCancel: () => void;
}

export default function StretchDialog({
  stretchDx,
  stretchDy,
  setStretchDx,
  setStretchDy,
  onApply,
  onCancel,
}: StretchDialogProps) {
  const drawingMode = useEditorStore((s) => s.drawingMode);
  const cadUnit = useEditorStore((s) => s.cadUnit);
  const t = useI18n((s) => s.t);
  const isCad = drawingMode === 'cad';
  const unit = isCad ? cadUnit : 'px';
  const step = isCad ? (cadUnit === 'mm' ? 1 : cadUnit === 'cm' ? 0.1 : 0.001) : 1;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content nm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t('stretchTitle')}</span>
          <button className="modal-close" onClick={onCancel}>&times;</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>{t('stretchDesc')}</p>
          <div className="nm-row">
            <label>{t('stretchOffsetX')} ({unit})</label>
            <input type="number" value={stretchDx} onChange={(e) => setStretchDx(Number(e.target.value))} step={step} autoFocus />
          </div>
          <div className="nm-row">
            <label>{t('stretchOffsetY')} ({unit})</label>
            <input type="number" value={stretchDy} onChange={(e) => setStretchDy(Number(e.target.value))} step={step} />
          </div>
        </div>
        <div className="nm-actions">
          <button className="toolbar-btn nm-btn" onClick={onApply}>{t('stretchApply')}</button>
          <button className="toolbar-btn nm-btn nm-cancel" onClick={onCancel}>{t('cancel')}</button>
        </div>
      </div>
    </div>
  );
}
