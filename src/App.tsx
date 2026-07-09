import { useState } from 'react';
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
import Toast from './components/Toast';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { clearAutoSave, loadAutoSave, useAutoSave, type AutoSaveData } from './hooks/useAutoSave';
import { useEditorStore } from './store/useEditorStore';
import { useI18n } from './i18n/useI18n';
import { restoreDocumentData } from './utils/documentSerializer';

function App() {
  const canvas = useEditorStore((s) => s.canvas);
  const theme = useEditorStore((s) => s.theme);
  const toggleTheme = useEditorStore((s) => s.toggleTheme);
  const lang = useI18n((s) => s.lang);
  const setLang = useI18n((s) => s.setLang);
  const t = useI18n((s) => s.t);

  // Auto-save restore prompt: read the saved snapshot once at startup and
  // hold it until the user decides whether to restore.
  const [pendingRestore, setPendingRestore] = useState<AutoSaveData | null>(() => loadAutoSave());
  // True from the moment the user confirms a restore until loadFromJSON()
  // settles, so async restores (large/image-heavy data) aren't overwritten.
  const [restoring, setRestoring] = useState(false);

  useKeyboardShortcuts();
  // Pause auto-save while a restore decision is pending or an async restore
  // is in flight so the existing snapshot isn't overwritten by the blank
  // startup canvas or a half-loaded restore.
  useAutoSave(pendingRestore !== null || restoring);

  const applyRestore = (saved: AutoSaveData) => {
    if (!canvas) return;
    const { setCanvasSize, setBackgroundColor, pushHistory, setDrawingMode, setCadUnit, setScale, setCadSize, showToast } = useEditorStore.getState();
    setCanvasSize(saved.canvas.width, saved.canvas.height);
    setBackgroundColor(saved.canvas.backgroundColor);
    if (saved.drawingMode) setDrawingMode(saved.drawingMode);
    if (saved.cadUnit) setCadUnit(saved.cadUnit);
    if (saved.scale) setScale(saved.scale);
    if (saved.cadWidth && saved.cadHeight) setCadSize(saved.cadWidth, saved.cadHeight);

    setRestoring(true);
    setPendingRestore(null);
    restoreDocumentData(canvas, saved, {
      setCanvasSize,
      setBackgroundColor,
      setDrawingMode,
      setCadUnit,
      setScale,
      setCadSize,
    }).then(() => {
        pushHistory();
        showToast(t('restoreDone'), 'success');
    }).catch(() => {
      clearAutoSave();
    }).finally(() => {
      setRestoring(false);
    });
  };

  const discardRestore = () => {
    clearAutoSave();
    setPendingRestore(null);
  };

  const formatSavedAt = (iso?: string) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return '';
    }
  };

  return (
    <div className="app">
      <div className="app-header">
        <Toolbar />
        <div className="header-right">
          <HelpManual />
          <div className="toolbar-separator" />
          <button
            className="lang-btn"
            onClick={toggleTheme}
            title={t('tip_theme')}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
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
      <Toast />

      {pendingRestore && (
        <div className="modal-overlay">
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <div className="modal-header">
              <span>{t('restoreTitle')}</span>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, marginBottom: 6 }}>{t('restoreMessage')}</p>
              {pendingRestore.savedAt && (
                <p style={{ fontSize: 12, color: '#888' }}>
                  {t('restoreSavedAt')}: {formatSavedAt(pendingRestore.savedAt)}
                </p>
              )}
            </div>
            <div className="nm-actions">
              <button className="toolbar-btn nm-btn" onClick={() => applyRestore(pendingRestore)}>
                {t('restoreConfirm')}
              </button>
              <button className="toolbar-btn nm-btn nm-cancel" onClick={discardRestore}>
                {t('restoreDiscard')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
