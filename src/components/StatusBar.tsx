import { useEditorStore } from '../store/useEditorStore';

export default function StatusBar() {
  const zoom = useEditorStore((s) => s.zoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const selectedObjectIds = useEditorStore((s) => s.selectedObjectIds);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const gridVisible = useEditorStore((s) => s.gridVisible);
  const canvas = useEditorStore((s) => s.canvas);

  const objectCount = canvas ? canvas.getObjects().length : 0;

  const zoomLevels = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];

  return (
    <div className="status-bar">
      <div className="status-left">
        <span>{canvasWidth} x {canvasHeight} px</span>
        <span className="status-separator">|</span>
        <span>オブジェクト: {objectCount}</span>
        <span className="status-separator">|</span>
        <span>選択: {selectedObjectIds.length}</span>
        {gridVisible && (
          <>
            <span className="status-separator">|</span>
            <span>グリッド ON</span>
          </>
        )}
      </div>
      <div className="status-right">
        <button
          className="status-zoom-btn"
          onClick={() => {
            const idx = zoomLevels.findIndex((z) => z >= zoom);
            if (idx > 0) setZoom(zoomLevels[idx - 1]);
          }}
        >
          −
        </button>
        <span className="status-zoom-label">{Math.round(zoom * 100)}%</span>
        <button
          className="status-zoom-btn"
          onClick={() => {
            const idx = zoomLevels.findIndex((z) => z > zoom);
            if (idx >= 0) setZoom(zoomLevels[idx]);
          }}
        >
          +
        </button>
        <button className="status-zoom-btn" onClick={() => setZoom(1)}>
          100%
        </button>
      </div>
    </div>
  );
}
