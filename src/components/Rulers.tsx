import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import type * as fabric from 'fabric';
import { useEditorStore } from '../store/useEditorStore';
import type { CanvasViewportSnapshot } from '../hooks/useCadViewport';
import { rulerPositionToScene, sceneToRulerPosition } from '../utils/rulerGeometry';

const RULER_SIZE = 20;
const TICK_COLOR = '#999';
const LABEL_COLOR = '#666';

interface RulerProps {
  orientation: 'h' | 'v';
  canvasEl: HTMLDivElement | null;
  fabricCanvas: fabric.Canvas | null;
  viewport: CanvasViewportSnapshot;
}

interface RulerGeometry {
  length: number;
  canvasOrigin: number;
}

function useRulerGeometry(
  orientation: 'h' | 'v',
  wrapper: HTMLDivElement | null,
  canvas: fabric.Canvas | null,
  rulerElement: SVGSVGElement | null,
  canvasWidth: number,
  canvasHeight: number,
): RulerGeometry {
  const [geometry, setGeometry] = useState<RulerGeometry>({
    length: orientation === 'h' ? 800 : 600,
    canvasOrigin: -RULER_SIZE,
  });

  useLayoutEffect(() => {
    if (!wrapper) return;
    const canvasElement = canvas?.lowerCanvasEl;

    const update = () => {
      const wrapperRect = wrapper.getBoundingClientRect();
      const canvasRect = canvasElement?.getBoundingClientRect();
      const rulerRect = rulerElement?.getBoundingClientRect();
      const length = Math.max(
        0,
        (orientation === 'h' ? wrapperRect.width : wrapperRect.height) - RULER_SIZE,
      );
      const rulerClientOrigin = rulerRect
        ? (orientation === 'h' ? rulerRect.left : rulerRect.top)
        : (orientation === 'h' ? wrapperRect.left + RULER_SIZE : wrapperRect.top + RULER_SIZE);
      const canvasClientOrigin = canvasRect
        ? (orientation === 'h' ? canvasRect.left : canvasRect.top)
        : (orientation === 'h' ? wrapperRect.left : wrapperRect.top);
      setGeometry((previous) => {
        const next = { length, canvasOrigin: canvasClientOrigin - rulerClientOrigin };
        return previous.length === next.length && previous.canvasOrigin === next.canvasOrigin
          ? previous
          : next;
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(wrapper);
    if (canvasElement) observer.observe(canvasElement);
    if (rulerElement) observer.observe(rulerElement);
    wrapper.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      wrapper.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [orientation, wrapper, canvas, rulerElement, canvasWidth, canvasHeight]);

  return geometry;
}

function chooseTickStep(zoom: number): number {
  const candidates = [
    0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100,
    200, 500, 1000, 2000, 5000, 10000, 20000, 50000,
  ];
  return candidates.find((candidate) => candidate * zoom >= 50)
    ?? candidates[candidates.length - 1];
}

export default function Ruler({
  orientation,
  canvasEl,
  fabricCanvas,
  viewport,
}: RulerProps) {
  const addGuide = useEditorStore((state) => state.addGuide);
  const [rulerElement, setRulerElement] = useState<SVGSVGElement | null>(null);
  const geometry = useRulerGeometry(
    orientation,
    canvasEl,
    fabricCanvas,
    rulerElement,
    viewport.width,
    viewport.height,
  );
  const zoom = Math.max(viewport.zoom, Number.EPSILON);
  const pan = orientation === 'h' ? viewport.panX : viewport.panY;
  const origin = geometry.canvasOrigin + pan;

  const ticks = useMemo(() => {
    const baseStep = chooseTickStep(zoom);
    const startValue = Math.floor(-origin / zoom / baseStep) * baseStep;
    const endValue = Math.ceil((geometry.length - origin) / zoom / baseStep) * baseStep;
    const values: { pos: number; val: number; major: boolean }[] = [];
    const majorCount = Math.min(1000, Math.ceil((endValue - startValue) / baseStep) + 1);
    for (let index = 0; index < majorCount; index += 1) {
      const value = startValue + index * baseStep;
      if (value > endValue + baseStep / 2) break;
      values.push({
        pos: sceneToRulerPosition(value, zoom, pan, geometry.canvasOrigin),
        val: value,
        major: true,
      });
      const minor = baseStep / 5;
      for (let subdivision = 1; subdivision < 5; subdivision += 1) {
        const minorValue = value + minor * subdivision;
        const position = sceneToRulerPosition(minorValue, zoom, pan, geometry.canvasOrigin);
        if (position >= 0 && position <= geometry.length) {
          values.push({ pos: position, val: minorValue, major: false });
        }
      }
    }
    return values;
  }, [geometry.length, geometry.canvasOrigin, origin, pan, zoom]);

  const handleMouseDown = useCallback((event: React.MouseEvent<SVGSVGElement>) => {
    const rulerRect = event.currentTarget.getBoundingClientRect();
    const clientPosition = orientation === 'h'
      ? event.clientX - rulerRect.left
      : event.clientY - rulerRect.top;
    const scenePosition = rulerPositionToScene(
      clientPosition,
      zoom,
      pan,
      geometry.canvasOrigin,
    );
    addGuide(orientation === 'h' ? 'v' : 'h', scenePosition);
    fabricCanvas?.requestRenderAll();
  }, [orientation, zoom, pan, geometry.canvasOrigin, addGuide, fabricCanvas]);

  if (orientation === 'h') {
    return (
      <svg
        ref={setRulerElement}
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
        {ticks.map((tick, index) => (
          <g key={`${tick.major ? 'major' : 'minor'}-${index}`}>
            <line
              x1={tick.pos}
              y1={tick.major ? 0 : RULER_SIZE * 0.6}
              x2={tick.pos}
              y2={RULER_SIZE}
              stroke={TICK_COLOR}
              strokeWidth={tick.major ? 1 : 0.5}
            />
            {tick.major && (
              <text x={tick.pos + 3} y={RULER_SIZE * 0.55} fontSize={9} fill={LABEL_COLOR}>
                {Number(tick.val.toFixed(4))}
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
      ref={setRulerElement}
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
      {ticks.map((tick, index) => (
        <g key={`${tick.major ? 'major' : 'minor'}-${index}`}>
          <line
            x1={tick.major ? 0 : RULER_SIZE * 0.6}
            y1={tick.pos}
            x2={RULER_SIZE}
            y2={tick.pos}
            stroke={TICK_COLOR}
            strokeWidth={tick.major ? 1 : 0.5}
          />
          {tick.major && (
            <text
              x={2}
              y={tick.pos + 12}
              fontSize={9}
              fill={LABEL_COLOR}
              writingMode="vertical-rl"
              textAnchor="start"
            >
              {Number(tick.val.toFixed(4))}
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
