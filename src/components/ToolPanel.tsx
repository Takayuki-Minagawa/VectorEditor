import { useState, useEffect } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import type { ToolType } from '../types';
import { ALL_TOOLS, TOOL_CATEGORIES } from '../domain/tools';
import type { ToolCategory, ToolDefinition } from '../domain/tools';
import Dialog from './Dialog';
import IconButton from './IconButton';
import SymbolLibrary from './SymbolLibrary';
import { loadVisibleTools, saveVisibleTools } from '../utils/visibleToolsStorage';


export default function ToolPanel() {
  const activeTool = useEditorStore((s) => s.activeTool);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const t = useI18n((s) => s.t);
  const [showSettings, setShowSettings] = useState(false);
  const [visibleTools, setVisibleTools] = useState<Set<ToolType>>(loadVisibleTools);

  useEffect(() => {
    saveVisibleTools(visibleTools);
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
    const catTools = ALL_TOOLS.filter((td) => td.category === cat && td.tool !== 'select');
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

  const visibleList = ALL_TOOLS.filter((td) => visibleTools.has(td.tool));

  // Group visible tools by category for display with separators
  const grouped: { category: ToolCategory; tools: ToolDefinition[] }[] = [];
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
        <IconButton
          className="tool-settings-btn"
          onClick={() => setShowSettings(true)}
          label={t('toolSettings')}
        >
          ⚙
        </IconButton>
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
              aria-label={t(td.labelKey)}
              aria-pressed={activeTool === td.tool}
            >
              <span className="tool-icon">{td.icon}</span>
              <span className="tool-label">{t(td.labelKey)}</span>
            </button>
          ))}
        </div>
      ))}

      <div className="tool-separator" />
      <SymbolLibrary />

      {showSettings && (
        <Dialog title={t('toolSettings')} onClose={() => setShowSettings(false)} closeLabel={t('cancel')}>
          <div className="modal-body">
              <p style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>{t('toolSettingsDesc')}</p>
              {TOOL_CATEGORIES.map((cat) => {
                const catTools = ALL_TOOLS.filter((td) => td.category === cat.key);
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
        </Dialog>
      )}
    </div>
  );
}
