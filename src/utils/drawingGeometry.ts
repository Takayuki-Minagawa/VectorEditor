import type { ToolType } from '../types';
import { TOOL_DEFINITIONS } from '../domain/tools';

export function snapVal(v: number, gridSize: number): number {
  if (!Number.isFinite(gridSize) || gridSize <= 0) return v;
  return Math.round(v / gridSize) * gridSize;
}

export const ORTHO_TOOLS: ToolType[] = Object.values(TOOL_DEFINITIONS)
  .filter((definition) => 'supportsOrtho' in definition && definition.supportsOrtho)
  .map((definition) => definition.tool);

export function applyOrtho(startX: number, startY: number, endX: number, endY: number): { x: number; y: number } {
  return Math.abs(endX - startX) >= Math.abs(endY - startY)
    ? { x: endX, y: startY }
    : { x: startX, y: endY };
}
