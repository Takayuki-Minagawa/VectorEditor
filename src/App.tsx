import { useEffect, useRef } from 'react';
import './App.css';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import ToolPanel from './components/ToolPanel';
import PropertyPanel from './components/PropertyPanel';
import LayerPanel from './components/LayerPanel';
import StatusBar from './components/StatusBar';
import ContextMenu from './components/ContextMenu';
import ShortcutHelp from './components/ShortcutHelp';
import HelpManual from './components/HelpManual';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { clearAutoSave, loadAutoSave, useAutoSave } from './hooks/useAutoSave';
import { useEditorStore } from './store/useEditorStore';
import { useI18n } from './i18n/useI18n';
import { ensureObjectIdsRecursive } from './utils/objectIds';

function App() {
  const restoredRef = useRef(false);
  const canvas = useEditorStore((s) => s.canvas);
  const lang = useI18n((s) => s.lang);
  const setLang = useI18n((s) => s.setLang);
  const t = useI18n((s) => s.t);

  useKeyboardShortcuts();
  useAutoSave();

  // Restore from auto-save on startup
  useEffect(() => {
    if (!canvas || restoredRef.current) return;
    restoredRef.current = true;
    const saved = loadAutoSave();
    if (saved) {
      const { setCanvasSize, setBackgroundColor, pushHistory, setDrawingMode, setCadUnit, setScale, setCadSize } = useEditorStore.getState();
      setCanvasSize(saved.canvas.width, saved.canvas.height);
      setBackgroundColor(saved.canvas.backgroundColor);
      // Restore CAD settings if present
      if (saved.drawingMode) setDrawingMode(saved.drawingMode);
      if (saved.cadUnit) setCadUnit(saved.cadUnit);
      if (saved.scale) setScale(saved.scale);
      if (saved.cadWidth && saved.cadHeight) setCadSize(saved.cadWidth, saved.cadHeight);

      try {
        const json = JSON.parse(saved.objects);
        canvas.loadFromJSON(json).then(() => {
          canvas.getObjects().forEach((obj) => ensureObjectIdsRecursive(obj));
          canvas.requestRenderAll();
          pushHistory();
        }).catch(() => {
          clearAutoSave();
        });
      } catch {
        clearAutoSave();
      }
    }
  }, [canvas]);

  return (
    <div className="app">
      <div className="app-header">
        <Toolbar />
        <div className="header-right">
          <HelpManual />
          <div className="toolbar-separator" />
          <span className="toolbar-group-label">{t('language')}</span>
          <button
            className={`lang-btn ${lang === 'ja' ? 'active' : ''}`}
            onClick={() => setLang('ja')}
          >
            日本語
          </button>
          <button
            className={`lang-btn ${lang === 'en' ? 'active' : ''}`}
            onClick={() => setLang('en')}
          >
            EN
          </button>
        </div>  {/* header-right */}
      </div>
      <div className="app-body">
        <ToolPanel />
        <Canvas />
        <div className="right-panels">
          <PropertyPanel />
          <LayerPanel />
        </div>
      </div>
      <StatusBar />
      <ContextMenu />
      <ShortcutHelp />
    </div>
  );
}

export default App;
