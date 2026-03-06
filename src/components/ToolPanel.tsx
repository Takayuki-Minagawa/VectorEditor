import { useEditorStore } from '../store/useEditorStore';
import type { ToolType } from '../types';

interface ToolDef {
  tool: ToolType;
  label: string;
  icon: string;
}

const tools: ToolDef[] = [
  { tool: 'select', label: '選択', icon: '⊹' },
  { tool: 'line', label: '直線', icon: '╲' },
  { tool: 'arrow', label: '矢印', icon: '→' },
  { tool: 'rect', label: '矩形', icon: '□' },
  { tool: 'roundedRect', label: '角丸', icon: '▢' },
  { tool: 'circle', label: '円', icon: '○' },
  { tool: 'ellipse', label: '楕円', icon: '⬮' },
  { tool: 'triangle', label: '三角', icon: '△' },
  { tool: 'diamond', label: 'ダイヤ', icon: '◇' },
  { tool: 'polygon', label: '多角形', icon: '⬡' },
  { tool: 'polyline', label: 'ポリライン', icon: '⟋' },
  { tool: 'text', label: '文字', icon: 'T' },
];

export default function ToolPanel() {
  const activeTool = useEditorStore((s) => s.activeTool);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);

  return (
    <div className="tool-panel">
      <div className="panel-title">ツール</div>
      {tools.map((t) => (
        <button
          key={t.tool}
          className={`tool-btn ${activeTool === t.tool ? 'active' : ''}`}
          onClick={() => setActiveTool(t.tool)}
          title={t.label}
        >
          <span className="tool-icon">{t.icon}</span>
          <span className="tool-label">{t.label}</span>
        </button>
      ))}
    </div>
  );
}
