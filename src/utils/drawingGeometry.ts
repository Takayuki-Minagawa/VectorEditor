import type { ToolType } from '../types';

export function snapVal(v: number, gridSize: number): number {
  return Math.round(v / gridSize) * gridSize;
}

export const ORTHO_TOOLS: ToolType[] = ['line', 'arrow', 'dimension', 'wall'];

export function applyOrtho(startX: number, startY: number, endX: number, endY: number): { x: number; y: number } {
  return Math.abs(endX - startX) >= Math.abs(endY - startY)
    ? { x: endX, y: startY }
    : { x: startX, y: endY };
}
