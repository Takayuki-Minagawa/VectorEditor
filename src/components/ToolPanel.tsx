import { useState, useEffect } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import type { ToolType } from '../types';
import type { TranslationKeys } from '../i18n/ja';

type ToolCategory = 'basic' | 'shapes' | 'arch' | 'utility';

interface ToolDef {
  tool: ToolType;
  labelKey: TranslationKeys;
  icon: string;
  category: ToolCategory;
}

const allTools: ToolDef[] = [
  { tool: 'select', labelKey: 'tool_select', icon: '⊹', category: 'basic' },
  { tool: 'line', labelKey: 'tool_line', icon: '╲', category: 'basic' },
  { tool: 'arrow', labelKey: 'tool_arrow', icon: '→', category: 'basic' },
  { tool: 'text', labelKey: 'tool_text', icon: 'T', category: 'basic' },
  { tool: 'rect', labelKey: 'tool_rect', icon: '□', category: 'shapes' },
  { tool: 'roundedRect', labelKey: 'tool_roundedRect', icon: '▢', category: 'shapes' },
  { tool: 'circle', labelKey: 'tool_circle', icon: '○', category: 'shapes' },
  { tool: 'ellipse', labelKey: 'tool_ellipse', icon: '⬮', category: 'shapes' },
  { tool: 'triangle', labelKey: 'tool_triangle', icon: '△', category: 'shapes' },
  { tool: 'diamond', labelKey: 'tool_diamond', icon: '◇', category: 'shapes' },
  { tool: 'polygon', labelKey: 'tool_polygon', icon: '⬡', category: 'shapes' },
  { tool: 'polyline', labelKey: 'tool_polyline', icon: '⟋', category: 'shapes' },
  { tool: 'dimension', labelKey: 'tool_dimension', icon: '↔', category: 'arch' },
  { tool: 'wall', labelKey: 'tool_wall', icon: '▬', category: 'arch' },
  { tool: 'column', labelKey: 'tool_column', icon: '▪', category: 'arch' },
  { tool: 'latex', labelKey: 'tool_latex', icon: '∑', category: 'utility' },
  { tool: 'measure', labelKey: 'tool_measure', icon: '📐', category: 'utility' },
  { tool: 'stretch', labelKey: 'tool_stretch', icon: '⇔', category: 'utility' },
];

const categories: { key: ToolCategory; labelKey: TranslationKeys }[] = [
  { key: 'basic', labelKey: 'cat_basic' },
  { key: 'shapes', labelKey: 'cat_shapes' },
  { key: 'arch', labelKey: 'cat_arch' },
  { key: 'utility', labelKey: 'cat_utility' },
];

const STORAGE_KEY = 'vectoreditor-visible-tools';
const ALL_TOOL_IDS = allTools.map((t) => t.tool);

function loadVisibleTools(): Set<ToolType> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return new Set(JSON.parse(saved) as ToolType[]);
  } catch { /* ignore */ }
  return new Set(ALL_TOOL_IDS);
}

export default function ToolPanel() {
  const activeTool = useEditorStore((s) => s.activeTool);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const t = useI18n((s) => s.t);
  const [showSettings, setShowSettings] = useState(false);
  const [visibleTools, setVisibleTools] = useState<Set<ToolType>>(loadVisibleTools);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...visibleTools]));
  }, [visibleTools]);

  const toggleTool = (tool: ToolType) => {
    if (tool === 'select') return; // select is always visible
    setVisibleTools((prev) => {
      const next = new Set(prev);
      if (next.has(tool)) next.delete(tool);
      else next.add(tool);
      return next;
    });
  };

  const toggleCategory = (cat: ToolCategory) => {
    const catTools = allTools.filter((td) => td.category === cat && td.tool !== 'select');
    const allVisible = catTools.every((td) => visibleTools.has(td.tool));
    setVisibleTools((prev) => {
      const next = new Set(prev);
      catTools.forEach((td) => {
        if (allVisible) next.delete(td.tool);
        else next.add(td.tool);
      });
      return next;
    });
  };

  const visibleList = allTools.filter((td) => visibleTools.has(td.tool));

  // Group visible tools by category for display with separators
  const grouped: { category: ToolCategory; tools: ToolDef[] }[] = [];
  let lastCat: ToolCategory | null = null;
  for (const td of visibleList) {
    if (td.category !== lastCat) {
      grouped.push({ category: td.category, tools: [] });
      lastCat = td.category;
    }
    grouped[grouped.length - 1].tools.push(td);
  }

  return (
    <div className="tool-panel">
      <div className="panel-title-row">
        <span className="panel-title">{t('tools')}</span>
        <button
          className="tool-settings-btn"
          onClick={() => setShowSettings(true)}
          title={t('toolSettings')}
        >
          ⚙
        </button>
      </div>

      {grouped.map((group, gi) => (
        <div key={group.category}>
          {gi > 0 && <div className="tool-separator" />}
          {group.tools.map((td) => (
            <button
              key={td.tool}
              className={`tool-btn ${activeTool === td.tool ? 'active' : ''}`}
              onClick={() => setActiveTool(td.tool)}
              title={t(td.labelKey)}
            >
              <span className="tool-icon">{td.icon}</span>
              <span className="tool-label">{t(td.labelKey)}</span>
            </button>
          ))}
        </div>
      ))}

      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>{t('toolSettings')}</span>
              <button className="modal-close" onClick={() => setShowSettings(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>{t('toolSettingsDesc')}</p>
              {categories.map((cat) => {
                const catTools = allTools.filter((td) => td.category === cat.key);
                const allChecked = catTools.every((td) => td.tool === 'select' || visibleTools.has(td.tool));
                return (
                  <div key={cat.key} className="tool-settings-category">
                    <label className="tool-settings-cat-label">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        onChange={() => toggleCategory(cat.key)}
                      />
                      <strong>{t(cat.labelKey)}</strong>
                    </label>
                    <div className="tool-settings-items">
                      {catTools.map((td) => (
                        <label key={td.tool} className="tool-settings-item">
                          <input
                            type="checkbox"
                            checked={visibleTools.has(td.tool)}
                            disabled={td.tool === 'select'}
                            onChange={() => toggleTool(td.tool)}
                          />
                          <span>{td.icon}</span>
                          <span>{t(td.labelKey)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
