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
  | 'text'
  | 'measure'
  | 'dimension'
  | 'wall'
  | 'column'
  | 'latex'
  | 'stretch';

export interface CanvasPreset {
  labelKey: string;
  width: number;
  height: number;
  category: string;
}

export const CANVAS_PRESETS: CanvasPreset[] = [
  // Document
  { labelKey: 'preset_a4_portrait', width: 595, height: 842, category: 'doc' },
  { labelKey: 'preset_a4_landscape', width: 842, height: 595, category: 'doc' },
  { labelKey: 'preset_a3_portrait', width: 842, height: 1191, category: 'doc' },
  { labelKey: 'preset_letter_portrait', width: 612, height: 792, category: 'doc' },
  // Presentation
  { labelKey: 'preset_slide_16_9', width: 1920, height: 1080, category: 'slide' },
  { labelKey: 'preset_slide_4_3', width: 1024, height: 768, category: 'slide' },
  // Web / SNS
  { labelKey: 'preset_ogp', width: 1200, height: 630, category: 'web' },
  { labelKey: 'preset_hd', width: 1280, height: 720, category: 'web' },
  { labelKey: 'preset_ig_post', width: 1080, height: 1080, category: 'web' },
  { labelKey: 'preset_ig_story', width: 1080, height: 1920, category: 'web' },
  { labelKey: 'preset_x_header', width: 1500, height: 500, category: 'web' },
  { labelKey: 'preset_yt_thumb', width: 1280, height: 720, category: 'web' },
  // Square / Common
  { labelKey: 'preset_sq_small', width: 512, height: 512, category: 'common' },
  { labelKey: 'preset_sq_medium', width: 800, height: 800, category: 'common' },
  { labelKey: 'preset_sq_large', width: 1024, height: 1024, category: 'common' },
  // Custom
  { labelKey: 'preset_custom', width: 0, height: 0, category: 'custom' },
];

export type DrawingMode = 'illustration' | 'cad';
export type CadUnit = 'mm' | 'cm' | 'm';

// 72 DPI: 1 inch = 72px, 1mm = 72/25.4 px
export const PX_PER_MM = 72 / 25.4;

/** Parse scale string like "1:100" to ratio number (100) */
export function parseScaleRatio(scale: string): number {
  const parts = scale.split(':');
  if (parts.length === 2) {
    const n = Number(parts[0]);
    const d = Number(parts[1]);
    if (n > 0 && d > 0) return d / n;
  }
  return 1;
}

/** Convert pixel value to real-world value in the given unit */
export function pxToReal(px: number, scaleRatio: number, unit: CadUnit): number {
  const mm = (px / PX_PER_MM) * scaleRatio;
  switch (unit) {
    case 'mm': return mm;
    case 'cm': return mm / 10;
    case 'm': return mm / 1000;
  }
}

/** Convert real-world value to pixel value */
export function realToPx(real: number, scaleRatio: number, unit: CadUnit): number {
  let mm: number;
  switch (unit) {
    case 'mm': mm = real; break;
    case 'cm': mm = real * 10; break;
    case 'm': mm = real * 1000; break;
  }
  return (mm * PX_PER_MM) / scaleRatio;
}

/** Format a real-world value for display (round to reasonable precision) */
export function formatReal(value: number, unit: CadUnit): string {
  switch (unit) {
    case 'mm': return Math.round(value).toString();
    case 'cm': return value.toFixed(1);
    case 'm': return value.toFixed(3);
  }
}

export interface DocumentData {
  documentId: string;
  canvas: {
    width: number;
    height: number;
    backgroundColor: string;
  };
  objects: string; // Fabric.js JSON string
  version: number;
  // CAD mode metadata (for external program interop)
  drawingMode?: DrawingMode;
  cadUnit?: CadUnit;
  scale?: string;
}
