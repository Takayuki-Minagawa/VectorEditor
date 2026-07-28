import type { ToolType } from '../types';
import { ALL_TOOLS } from '../domain/tools';

const STORAGE_KEY = 'vectoreditor-visible-tools-v4';
const LEGACY_STORAGE_KEY_V3 = 'vectoreditor-visible-tools-v3';
const ALL_TOOL_IDS = ALL_TOOLS.map((definition) => definition.tool);

const isKnownTool = (tool: unknown): tool is ToolType =>
  ALL_TOOL_IDS.includes(tool as ToolType);

/**
 * Saved visibility together with the tool ids that existed when it was
 * written. Tools released after the user's last save are unknown to their
 * configuration, so they default to visible instead of silently staying
 * hidden behind an old saved array.
 */
interface VisibleToolsStorageV4 {
  visible: unknown[];
  known: unknown[];
}

export function loadVisibleTools(): Set<ToolType> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<VisibleToolsStorageV4> | null;
      if (parsed && Array.isArray(parsed.visible) && Array.isArray(parsed.known)) {
        const visible = parsed.visible.filter(isKnownTool);
        const known = new Set(parsed.known.filter(isKnownTool));
        const newSinceSave = ALL_TOOL_IDS.filter((tool) => !known.has(tool));
        return new Set<ToolType>(['select', ...visible, ...newSinceSave]);
      }
    }
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY_V3);
    if (legacy) {
      const parsed = JSON.parse(legacy) as unknown;
      if (Array.isArray(parsed)) {
        // The node-edit tool shipped after the v3 format, so v3 saves cannot
        // contain it; show it by default on migration.
        return new Set<ToolType>(['select', 'nodeEdit', ...parsed.filter(isKnownTool)]);
      }
    }
  } catch { /* ignore */ }
  return new Set(ALL_TOOL_IDS);
}

export function saveVisibleTools(visibleTools: ReadonlySet<ToolType>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    visible: [...visibleTools],
    known: ALL_TOOL_IDS,
  } satisfies VisibleToolsStorageV4));
}
