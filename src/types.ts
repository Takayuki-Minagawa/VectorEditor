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
  | 'latex';

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
