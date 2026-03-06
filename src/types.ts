export type ToolType =
  | 'select'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'roundedRect'
  | 'circle'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'polygon'
  | 'polyline'
  | 'text';

export interface CanvasPreset {
  label: string;
  width: number;
  height: number;
}

export const CANVAS_PRESETS: CanvasPreset[] = [
  { label: 'A4 縦 (595x842)', width: 595, height: 842 },
  { label: 'A4 横 (842x595)', width: 842, height: 595 },
  { label: '正方形 (800x800)', width: 800, height: 800 },
  { label: 'HD (1280x720)', width: 1280, height: 720 },
  { label: 'カスタム', width: 0, height: 0 },
];

export interface DocumentData {
  documentId: string;
  canvas: {
    width: number;
    height: number;
    backgroundColor: string;
  };
  objects: string; // Fabric.js JSON string
  version: number;
}
