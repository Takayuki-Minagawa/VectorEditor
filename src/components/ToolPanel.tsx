import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import type { ToolType } from '../types';
import type { TranslationKeys } from '../i18n/ja';

interface ToolDef {
  tool: ToolType;
  labelKey: TranslationKeys;
  icon: string;
}

const tools: ToolDef[] = [
  { tool: 'select', labelKey: 'tool_select', icon: '⊹' },
  { tool: 'line', labelKey: 'tool_line', icon: '╲' },
  { tool: 'arrow', labelKey: 'tool_arrow', icon: '→' },
  { tool: 'rect', labelKey: 'tool_rect', icon: '□' },
  { tool: 'roundedRect', labelKey: 'tool_roundedRect', icon: '▢' },
  { tool: 'circle', labelKey: 'tool_circle', icon: '○' },
  { tool: 'ellipse', labelKey: 'tool_ellipse', icon: '⬮' },
  { tool: 'triangle', labelKey: 'tool_triangle', icon: '△' },
  { tool: 'diamond', labelKey: 'tool_diamond', icon: '◇' },
  { tool: 'polygon', labelKey: 'tool_polygon', icon: '⬡' },
  { tool: 'polyline', labelKey: 'tool_polyline', icon: '⟋' },
  { tool: 'text', labelKey: 'tool_text', icon: 'T' },
  { tool: 'measure', labelKey: 'tool_measure', icon: '📐' },
];

export default function ToolPanel() {
  const activeTool = useEditorStore((s) => s.activeTool);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const t = useI18n((s) => s.t);

  return (
    <div className="tool-panel">
      <div className="panel-title">{t('tools')}</div>
      {tools.map((td) => (
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
  );
}
