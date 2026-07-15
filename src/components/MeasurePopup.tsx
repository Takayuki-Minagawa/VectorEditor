import { useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import { formatReal, mmToUnit } from '../types';
import Dialog from './Dialog';

export interface MeasureResult {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MeasurePopupProps {
  result: MeasureResult;
  onClose: () => void;
}

function MeasureBody({ result }: { result: MeasureResult }) {
  const drawingMode = useEditorStore((s) => s.drawingMode);
  const cadUnit = useEditorStore((s) => s.cadUnit);
  const t = useI18n((s) => s.t);
  const isCad = drawingMode === 'cad';

  const fmt = (val: number) =>
    isCad
      ? `${formatReal(mmToUnit(val, cadUnit), cadUnit)} ${cadUnit}`
      : `${val} px`;

  return (
    <div className="measure-popup-body">
      <div className="measure-row"><span className="measure-label">{t('measureX')}</span><span className="measure-val">{fmt(result.x)}</span></div>
      <div className="measure-row"><span className="measure-label">{t('measureY')}</span><span className="measure-val">{fmt(result.y)}</span></div>
      <div className="measure-row"><span className="measure-label">{t('measureWidth')}</span><span className="measure-val">{fmt(result.width)}</span></div>
      <div className="measure-row"><span className="measure-label">{t('measureHeight')}</span><span className="measure-val">{fmt(result.height)}</span></div>
    </div>
  );
}

export default function MeasurePopup({ result, onClose }: MeasurePopupProps) {
  const t = useI18n((s) => s.t);
  const resultKey = `${result.x}:${result.y}:${result.width}:${result.height}`;
  const [copiedResultKey, setCopiedResultKey] = useState<string | null>(null);
  const measureCopied = copiedResultKey === resultKey;

  const handleCopyMeasure = async () => {
    const text = `x=${result.x}, y=${result.y}, width=${result.width}, height=${result.height}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedResultKey(resultKey);
      setTimeout(() => setCopiedResultKey(null), 1500);
    } catch {
      useEditorStore.getState().showToast(t('clipboardError'), 'error');
    }
  };

  return (
    <Dialog title={t('measureResult')} onClose={onClose} closeLabel={t('measureClose')} className="measure-popup">
        <MeasureBody result={result} />
        <div className="measure-popup-actions">
          <button className="toolbar-btn" onClick={handleCopyMeasure}>
            {measureCopied ? t('measureCopied') : t('measureCopy')}
          </button>
          <button className="toolbar-btn" onClick={onClose}>
            {t('measureClose')}
          </button>
        </div>
    </Dialog>
  );
}
