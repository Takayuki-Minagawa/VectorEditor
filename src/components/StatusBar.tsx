import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';

const SCALES = ['1:1', '1:10', '1:20', '1:50', '1:100', '1:200', '1:500'];

export default function StatusBar() {
  const zoom = useEditorStore((s) => s.zoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const selectedObjectIds = useEditorStore((s) => s.selectedObjectIds);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const gridVisible = useEditorStore((s) => s.gridVisible);
  const gridSize = useEditorStore((s) => s.gridSize);
  const setGridSize = useEditorStore((s) => s.setGridSize);
  const snapToGrid = useEditorStore((s) => s.snapToGrid);
  const toggleSnap = useEditorStore((s) => s.toggleSnap);
  const scale = useEditorStore((s) => s.scale);
  const setScale = useEditorStore((s) => s.setScale);
  const canvas = useEditorStore((s) => s.canvas);
  const t = useI18n((s) => s.t);

  const objectCount = canvas ? canvas.getObjects().length : 0;
  const zoomLevels = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];

  return (
    <div className="status-bar">
      <div className="status-left">
        <span>{canvasWidth} x {canvasHeight} px</span>
        <span className="status-separator">|</span>
        <span>{t('objects')}: {objectCount}</span>
        <span className="status-separator">|</span>
        <span>{t('selection')}: {selectedObjectIds.length}</span>
        {gridVisible && (
          <><span className="status-separator">|</span><span>{t('gridOn')}</span></>
        )}
        {snapToGrid && (
          <><span className="status-separator">|</span><span>{t('snapOn')}</span></>
        )}
      </div>
      <div className="status-right">
        <label className="status-inline-label">{t('scale')}</label>
        <select
          className="status-select"
          value={scale}
          onChange={(e) => setScale(e.target.value)}
        >
          {SCALES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span className="status-separator">|</span>
        <label className="status-inline-label">{t('gridSize')}</label>
        <input
          className="status-input"
          type="number"
          value={gridSize}
          onChange={(e) => setGridSize(Number(e.target.value))}
          min={5}
          max={200}
        />
        <button
          className={`status-snap-btn ${snapToGrid ? 'active' : ''}`}
          onClick={toggleSnap}
          title={t('snapToGrid')}
        >
          {t('snapToGrid')}
        </button>
        <span className="status-separator">|</span>
        <button className="status-zoom-btn" onClick={() => { const idx = zoomLevels.findIndex((z) => z >= zoom); if (idx > 0) setZoom(zoomLevels[idx - 1]); }}>−</button>
        <span className="status-zoom-label">{Math.round(zoom * 100)}%</span>
        <button className="status-zoom-btn" onClick={() => { const idx = zoomLevels.findIndex((z) => z > zoom); if (idx >= 0) setZoom(zoomLevels[idx]); }}>+</button>
        <button className="status-zoom-btn" onClick={() => setZoom(1)}>100%</button>
      </div>
    </div>
  );
}
