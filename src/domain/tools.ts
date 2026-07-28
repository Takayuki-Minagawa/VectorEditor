import type { TranslationKeys } from '../i18n/ja';
import type { ToolType } from '../types';

export type ToolCategory = 'basic' | 'shapes' | 'arch' | 'utility';
export type ToolGesture = 'select' | 'drag' | 'click' | 'freehand' | 'multiPoint' | 'dialog';

export interface ToolDefinition {
  tool: ToolType;
  labelKey: TranslationKeys;
  icon: string;
  category: ToolCategory;
  gesture: ToolGesture;
  supportsOrtho?: boolean;
  objectKind?: string;
}

export const TOOL_DEFINITIONS = {
  select: { tool: 'select', labelKey: 'tool_select', icon: '⊹', category: 'basic', gesture: 'select' },
  nodeEdit: { tool: 'nodeEdit', labelKey: 'tool_nodeEdit', icon: '⬦', category: 'basic', gesture: 'select' },
  line: { tool: 'line', labelKey: 'tool_line', icon: '╲', category: 'basic', gesture: 'drag', supportsOrtho: true, objectKind: 'line' },
  arrow: { tool: 'arrow', labelKey: 'tool_arrow', icon: '→', category: 'basic', gesture: 'drag', supportsOrtho: true, objectKind: 'arrow' },
  pencil: { tool: 'pencil', labelKey: 'tool_pencil', icon: '✎', category: 'basic', gesture: 'freehand', objectKind: 'pencil' },
  text: { tool: 'text', labelKey: 'tool_text', icon: 'T', category: 'basic', gesture: 'click', objectKind: 'text' },
  rect: { tool: 'rect', labelKey: 'tool_rect', icon: '□', category: 'shapes', gesture: 'drag', objectKind: 'rect' },
  roundedRect: { tool: 'roundedRect', labelKey: 'tool_roundedRect', icon: '▢', category: 'shapes', gesture: 'drag', objectKind: 'roundedRect' },
  circle: { tool: 'circle', labelKey: 'tool_circle', icon: '○', category: 'shapes', gesture: 'drag', objectKind: 'circle' },
  ellipse: { tool: 'ellipse', labelKey: 'tool_ellipse', icon: '⬮', category: 'shapes', gesture: 'drag', objectKind: 'ellipse' },
  triangle: { tool: 'triangle', labelKey: 'tool_triangle', icon: '△', category: 'shapes', gesture: 'drag', objectKind: 'triangle' },
  diamond: { tool: 'diamond', labelKey: 'tool_diamond', icon: '◇', category: 'shapes', gesture: 'drag', objectKind: 'diamond' },
  polygon: { tool: 'polygon', labelKey: 'tool_polygon', icon: '⬡', category: 'shapes', gesture: 'multiPoint', objectKind: 'polygon' },
  polyline: { tool: 'polyline', labelKey: 'tool_polyline', icon: '⟋', category: 'shapes', gesture: 'multiPoint', objectKind: 'polyline' },
  dimension: { tool: 'dimension', labelKey: 'tool_dimension', icon: '↔', category: 'arch', gesture: 'drag', supportsOrtho: true, objectKind: 'dimension' },
  connector: { tool: 'connector', labelKey: 'tool_connector', icon: '⌁', category: 'arch', gesture: 'drag', supportsOrtho: true, objectKind: 'connector' },
  wall: { tool: 'wall', labelKey: 'tool_wall', icon: '▬', category: 'arch', gesture: 'drag', supportsOrtho: true, objectKind: 'wall' },
  column: { tool: 'column', labelKey: 'tool_column', icon: '▪', category: 'arch', gesture: 'click', objectKind: 'column' },
  latex: { tool: 'latex', labelKey: 'tool_latex', icon: '∑', category: 'utility', gesture: 'dialog', objectKind: 'latex' },
  measure: { tool: 'measure', labelKey: 'tool_measure', icon: '📐', category: 'utility', gesture: 'drag' },
  stretch: { tool: 'stretch', labelKey: 'tool_stretch', icon: '⇔', category: 'utility', gesture: 'drag' },
} as const satisfies Record<ToolType, ToolDefinition>;

export const ALL_TOOLS: ToolDefinition[] = Object.values(TOOL_DEFINITIONS);

export const TOOL_CATEGORIES: { key: ToolCategory; labelKey: TranslationKeys }[] = [
  { key: 'basic', labelKey: 'cat_basic' },
  { key: 'shapes', labelKey: 'cat_shapes' },
  { key: 'arch', labelKey: 'cat_arch' },
  { key: 'utility', labelKey: 'cat_utility' },
];
