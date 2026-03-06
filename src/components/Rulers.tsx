import { useCallback } from 'react';
import { useEditorStore } from '../store/useEditorStore';

const RULER_SIZE = 20;
const TICK_COLOR = '#999';
const LABEL_COLOR = '#666';

interface RulerProps {
  orientation: 'h' | 'v';
  canvasEl: HTMLDivElement | null;
}

export default function Ruler({ orientation, canvasEl }: RulerProps) {
  const addGuide = useEditorStore((s) => s.addGuide);
  const canvas = useEditorStore((s) => s.canvas);
  const drawingMode = useEditorStore((s) => s.drawingMode);
  // Subscribe to zoom so rulers re-render on zoom change
  const storeZoom = useEditorStore((s) => s.zoom);

  const isCad = drawingMode === 'cad';
  const zoom = isCad && canvas ? canvas.getZoom() : storeZoom;
  const vpt = isCad && canvas ? canvas.viewportTransform : null;
  const panX = vpt ? vpt[4] : 0;
  const panY = vpt ? vpt[5] : 0;

  const length = orientation === 'h'
    ? (canvasEl?.clientWidth || 800)
    : (canvasEl?.clientHeight || 600);

  // Determine tick spacing based on zoom
  const baseStep = (() => {
    const candidates = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
    const minPxBetween = 50;
    for (const c of candidates) {
      if (c * zoom >= minPxBetween) return c;
    }
    return 5000;
  })();

  const pan = orientation === 'h' ? panX : panY;
  const startVal = Math.floor(-pan / zoom / baseStep) * baseStep;
  const endVal = Math.ceil((length - pan) / zoom / baseStep) * baseStep;

  const ticks: { pos: number; val: number; major: boolean }[] = [];
  for (let v = startVal; v <= endVal; v += baseStep) {
    const pos = v * zoom + pan;
    ticks.push({ pos, val: v, major: true });
    if (baseStep >= 10) {
      const minor = baseStep / 5;
      for (let m = 1; m < 5; m++) {
        const mv = v + minor * m;
        const mp = mv * zoom + pan;
        ticks.push({ pos: mp, val: mv, major: false });
      }
    }
  }

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const clientPos = orientation === 'h' ? e.clientX - rect.left : e.clientY - rect.top;
    const scenePos = (clientPos - pan) / zoom;
    // Click on horizontal ruler → create vertical guide, and vice versa
    addGuide(orientation === 'h' ? 'v' : 'h', scenePos);
  }, [canvasEl, orientation, pan, zoom, addGuide]);

  if (orientation === 'h') {
    return (
      <svg
        className="ruler ruler-h"
        style={{
          position: 'absolute',
          top: 0,
          left: RULER_SIZE,
          width: `calc(100% - ${RULER_SIZE}px)`,
          height: RULER_SIZE,
          cursor: 'col-resize',
          zIndex: 10,
        }}
        onMouseDown={handleMouseDown}
      >
        <rect width="100%" height="100%" fill="#f8f8f8" />
        {ticks.map((tk, i) => (
          <g key={i}>
            <line
              x1={tk.pos} y1={tk.major ? 0 : RULER_SIZE * 0.6}
              x2={tk.pos} y2={RULER_SIZE}
              stroke={TICK_COLOR}
              strokeWidth={tk.major ? 1 : 0.5}
            />
            {tk.major && (
              <text x={tk.pos + 3} y={RULER_SIZE * 0.55} fontSize={9} fill={LABEL_COLOR}>
                {tk.val}
              </text>
            )}
          </g>
        ))}
        <line x1={0} y1={RULER_SIZE - 0.5} x2="100%" y2={RULER_SIZE - 0.5} stroke="#ccc" strokeWidth={1} />
      </svg>
    );
  }

  return (
    <svg
      className="ruler ruler-v"
      style={{
        position: 'absolute',
        top: RULER_SIZE,
        left: 0,
        width: RULER_SIZE,
        height: `calc(100% - ${RULER_SIZE}px)`,
        cursor: 'row-resize',
        zIndex: 10,
      }}
      onMouseDown={handleMouseDown}
    >
      <rect width="100%" height="100%" fill="#f8f8f8" />
      {ticks.map((tk, i) => (
        <g key={i}>
          <line
            x1={tk.major ? 0 : RULER_SIZE * 0.6}
            y1={tk.pos}
            x2={RULER_SIZE}
            y2={tk.pos}
            stroke={TICK_COLOR}
            strokeWidth={tk.major ? 1 : 0.5}
          />
          {tk.major && (
            <text
              x={2}
              y={tk.pos + 12}
              fontSize={9}
              fill={LABEL_COLOR}
              writingMode="vertical-rl"
              textAnchor="start"
            >
              {tk.val}
            </text>
          )}
        </g>
      ))}
      <line x1={RULER_SIZE - 0.5} y1={0} x2={RULER_SIZE - 0.5} y2="100%" stroke="#ccc" strokeWidth={1} />
    </svg>
  );
}

export function RulerCorner() {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: RULER_SIZE,
        height: RULER_SIZE,
        background: '#f0f0f0',
        borderRight: '1px solid #ccc',
        borderBottom: '1px solid #ccc',
        zIndex: 11,
      }}
    />
  );
}
