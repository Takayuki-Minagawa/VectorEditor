import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import { mmToUnit, formatReal } from '../types';
import type { CadUnit } from '../types';

const SCALES = ['1:1', '1:10', '1:20', '1:50', '1:100', '1:200', '1:500'];
const UNITS: CadUnit[] = ['mm', 'cm', 'm'];

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
  const drawingMode = useEditorStore((s) => s.drawingMode);
  const setDrawingMode = useEditorStore((s) => s.setDrawingMode);
  const cadUnit = useEditorStore((s) => s.cadUnit);
  const setCadUnit = useEditorStore((s) => s.setCadUnit);
  const cadWidth = useEditorStore((s) => s.cadWidth);
  const cadHeight = useEditorStore((s) => s.cadHeight);
  const t = useI18n((s) => s.t);

  const objectCount = canvas ? canvas.getObjects().length : 0;
  const isCad = drawingMode === 'cad';
  const zoomLevels = isCad
    ? [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10]
    : [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];

  const realW = isCad ? formatReal(mmToUnit(cadWidth, cadUnit), cadUnit) : null;
  const realH = isCad ? formatReal(mmToUnit(cadHeight, cadUnit), cadUnit) : null;
  const realGrid = isCad ? formatReal(mmToUnit(gridSize, cadUnit), cadUnit) : null;

  const handleFitView = () => {
    const c = canvas;
    if (!c || !isCad) return;
    const w = c.width || 800;
    const h = c.height || 600;
    const fitZoom = Math.min(w / cadWidth, h / cadHeight) * 0.9;
    const panX = (w - cadWidth * fitZoom) / 2;
    const panY = (h - cadHeight * fitZoom) / 2;
    c.setViewportTransform([fitZoom, 0, 0, fitZoom, panX, panY]);
    setZoom(fitZoom);
    c.requestRenderAll();
  };

  return (
    <div className="status-bar">
      <div className="status-left">
        {isCad ? (
          <span>{realW} x {realH} {cadUnit}</span>
        ) : (
          <span>{canvasWidth} x {canvasHeight} px</span>
        )}
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
        {/* Drawing mode toggle */}
        <button
          className={`status-mode-btn ${!isCad ? 'active' : ''}`}
          onClick={() => setDrawingMode('illustration')}
          title={t('tip_modeIllustration')}
        >
          {t('modeIllustration')}
        </button>
        <button
          className={`status-mode-btn ${isCad ? 'active' : ''}`}
          onClick={() => setDrawingMode('cad')}
          title={t('tip_modeCad')}
        >
          {t('modeCad')}
        </button>

        {isCad && (
          <>
            <span className="status-separator">|</span>
            <label className="status-inline-label">{t('cadUnit')}</label>
            <select
              className="status-select"
              value={cadUnit}
              onChange={(e) => setCadUnit(e.target.value as CadUnit)}
            >
              {UNITS.map((u) => (
                <option key={u} value={u}>{t(`unit_${u}`)}</option>
              ))}
            </select>
          </>
        )}

        <span className="status-separator">|</span>
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
        {isCad && realGrid && (
          <span className="status-real-label">({realGrid} {cadUnit})</span>
        )}
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
        {isCad && (
          <>
            <button className="status-zoom-btn" onClick={handleFitView} title={t('fitView')} style={{ width: 'auto', padding: '0 6px', fontSize: 10 }}>{t('fitView')}</button>
            <span style={{ fontSize: 10, color: '#aaa' }}>{t('panHint')}</span>
          </>
        )}
      </div>
    </div>
  );
}
