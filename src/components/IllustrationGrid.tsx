import type { ReactElement } from 'react';

interface IllustrationGridProps {
  visible: boolean;
  canvasWidth: number;
  canvasHeight: number;
  zoom: number;
  gridSize: number;
}

export default function IllustrationGrid({
  visible,
  canvasWidth,
  canvasHeight,
  zoom,
  gridSize,
}: IllustrationGridProps) {
  if (!visible) return null;

  const lines: ReactElement[] = [];
  for (let x = 0; x <= canvasWidth; x += gridSize) {
    lines.push(
      <line
        key={`v${x}`}
        x1={x * zoom}
        y1={0}
        x2={x * zoom}
        y2={canvasHeight * zoom}
        stroke="#ddd"
        strokeWidth={0.5}
      />,
    );
  }
  for (let y = 0; y <= canvasHeight; y += gridSize) {
    lines.push(
      <line
        key={`h${y}`}
        x1={0}
        y1={y * zoom}
        x2={canvasWidth * zoom}
        y2={y * zoom}
        stroke="#ddd"
        strokeWidth={0.5}
      />,
    );
  }

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: canvasWidth * zoom,
        height: canvasHeight * zoom,
        pointerEvents: 'none',
      }}
    >
      {lines}
    </svg>
  );
}
