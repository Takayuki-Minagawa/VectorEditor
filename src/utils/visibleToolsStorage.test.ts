import { beforeEach, describe, expect, it } from 'vitest';
import { ALL_TOOLS } from '../domain/tools';
import { loadVisibleTools, saveVisibleTools } from './visibleToolsStorage';

const V4_KEY = 'vectoreditor-visible-tools-v4';
const V3_KEY = 'vectoreditor-visible-tools-v3';

describe('visibleToolsStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows every tool when nothing was saved', () => {
    expect(loadVisibleTools()).toEqual(new Set(ALL_TOOLS.map((tool) => tool.tool)));
  });

  it('round-trips a saved v4 configuration', () => {
    saveVisibleTools(new Set(['select', 'rect']));
    expect(loadVisibleTools()).toEqual(new Set(['select', 'rect']));
  });

  it('adds tools released after the last v4 save', () => {
    // Simulate a save from an older build that did not know nodeEdit yet.
    const knownThen = ALL_TOOLS.map((tool) => tool.tool).filter((tool) => tool !== 'nodeEdit');
    localStorage.setItem(V4_KEY, JSON.stringify({ visible: ['select', 'rect'], known: knownThen }));

    const visible = loadVisibleTools();
    expect(visible.has('nodeEdit')).toBe(true);
    expect(visible.has('rect')).toBe(true);
    expect(visible.has('circle')).toBe(false);
  });

  it('migrates v3 arrays and makes the node-edit tool visible', () => {
    localStorage.setItem(V3_KEY, JSON.stringify(['rect', 'circle']));

    const visible = loadVisibleTools();
    expect(visible.has('select')).toBe(true);
    expect(visible.has('nodeEdit')).toBe(true);
    expect(visible.has('rect')).toBe(true);
    expect(visible.has('circle')).toBe(true);
    expect(visible.has('line')).toBe(false);
  });
});
