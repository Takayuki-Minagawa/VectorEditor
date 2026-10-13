import { useEffect, useRef, useState } from 'react';
import './App.css';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import ToolPanel from './components/ToolPanel';
import PropertyPanel from './components/PropertyPanel';
import PagePanel from './components/PagePanel';
import LayerPanel from './components/LayerPanel';
import StatusBar from './components/StatusBar';
import ContextMenu from './components/ContextMenu';
import ShortcutHelp from './components/ShortcutHelp';
import HelpManual from './components/HelpManual';
import Toast from './components/Toast';
import Dialog from './components/Dialog';
import IconButton from './components/IconButton';
import CommandPalette from './components/CommandPalette';
import ProjectManager from './components/ProjectManager';
import BackupManager from './components/BackupManager';
import GeometryTools from './components/GeometryTools';
import { recoverPendingBackups } from './services/backupService';
import TraceDialog from './components/TraceDialog';
import ImageCropDialog from './components/ImageCropDialog';
import { OPEN_IMAGE_CROP_EVENT } from './utils/imageCropUiEvents';
import type * as fabric from 'fabric';
import { useExternalClipboard } from './hooks/useExternalClipboard';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useWindowEvent } from './hooks/useWindowEvent';
import { clearAutoSave, loadAutoSaveAsync, useAutoSave, type AutoSaveData } from './hooks/useAutoSave';
import {
  captureCurrentEditorSnapshot,
  restoreActionsFromStore,
  useEditorStore,
} from './store/useEditorStore';
import { useUiStore } from './store/useUiStore';
import { useI18n } from './i18n/useI18n';
import {
  isDocumentRestoreSupersededError,
  restoreDocumentData,
} from './utils/documentSerializer';
import {
  resolveStartupRestorePolicy,
  saveStartupRestorePreference,
  type StartupRestorePolicy,
} from './utils/startupRestorePolicy';
import {
  OPEN_TRACE_DIALOG_EVENT,
  type OpenTraceDialogDetail,
} from './utils/traceUiEvents';

function App() {
  const canvas = useEditorStore((s) => s.canvas);
  const isRestoring = useEditorStore((s) => s.isRestoring);
  const theme = useEditorStore((s) => s.theme);
  const toggleTheme = useEditorStore((s) => s.toggleTheme);
  const leftPanelOpen = useUiStore((s) => s.leftPanelOpen);
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen);
  const toggleLeftPanel = useUiStore((s) => s.toggleLeftPanel);
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel);
  const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const setCurrentProjectId = useUiStore((s) => s.setCurrentProjectId);
  const lang = useI18n((s) => s.lang);
  const setLang = useI18n((s) => s.setLang);
  const t = useI18n((s) => s.t);

  // Startup restore: the saved snapshot is read once. Depending on the
  // resolved policy it is restored silently (`auto`, the default), offered in
  // a dialog (`ask`) or dropped (`discard`). Automated clients can pass
  // `?restore=` to pick the behaviour for a single launch.
  const [startupPolicy] = useState<StartupRestorePolicy>(() => resolveStartupRestorePolicy());
  const [pendingRestore, setPendingRestore] = useState<AutoSaveData | null>(null);
  const [checkingAutoSave, setCheckingAutoSave] = useState(true);
  // True from the moment a restore starts until loadFromJSON() settles, so
  // async restores (large/image-heavy data) aren't overwritten.
  const [restoring, setRestoring] = useState(false);
  // Set once the automatic restore has been attempted; a failed attempt falls
  // back to the dialog so the only recovery copy can be retried or discarded.
  const autoRestoreAttempted = useRef(false);
  const [autoRestoreFailed, setAutoRestoreFailed] = useState(false);
  const [rememberAutoRestore, setRememberAutoRestore] = useState(false);
  const [traceRequest, setTraceRequest] = useState<OpenTraceDialogDetail | null>(null);
  const [cropImage, setCropImage] = useState<fabric.Image | null>(null);

  useWindowEvent<CustomEvent<fabric.Image>>(OPEN_IMAGE_CROP_EVENT, (event) => setCropImage(event.detail));
  useWindowEvent<CustomEvent<OpenTraceDialogDetail>>(OPEN_TRACE_DIALOG_EVENT, (event) => {
    setTraceRequest(event.detail ?? {});
  });

  useEffect(() => {
    let cancelled = false;
    recoverPendingBackups()
      .catch(() => { useEditorStore.getState().showToast(useI18n.getState().t('backupError'), 'error'); })
      .then(loadAutoSaveAsync)
      .then((saved) => {
        if (cancelled) return;
        // The project id is only safe to retain across startup when an
        // autosave is available to reconstruct that working document.
        if (!saved) {
          useUiStore.getState().setCurrentProjectId(null);
          return;
        }
        if (startupPolicy === 'discard') {
          void clearAutoSave();
          useUiStore.getState().setCurrentProjectId(null);
          useEditorStore.getState().showToast(useI18n.getState().t('restoreDiscarded'), 'info');
          return;
        }
        setPendingRestore(saved);
      })
      .catch(() => {
        if (!cancelled) useUiStore.getState().setCurrentProjectId(null);
      })
      .finally(() => { if (!cancelled) setCheckingAutoSave(false); });
    return () => { cancelled = true; };
  }, [startupPolicy]);

  useKeyboardShortcuts();
  useExternalClipboard();
  // Pause auto-save while a restore decision is pending or an async restore
  // is in flight so the existing snapshot isn't overwritten by the blank
  // startup canvas or a half-loaded restore.
  useAutoSave(checkingAutoSave || pendingRestore !== null || restoring);

  const applyRestore = (saved: AutoSaveData) => {
    if (!canvas) return;
    const state = useEditorStore.getState();

    setRestoring(true);
    setPendingRestore(null);
    restoreDocumentData(canvas, saved, restoreActionsFromStore(state), {
      rollbackSnapshot: captureCurrentEditorSnapshot() ?? undefined,
    }).then(() => {
      setAutoRestoreFailed(false);
      state.showToast(t('restoreDone'), 'success');
    }).catch((error: unknown) => {
      // A newer manual/project restore now owns the canvas. Do not revive the
      // stale autosave prompt over that newer document.
      if (isDocumentRestoreSupersededError(error)) return;
      // Preserve the only recovery copy for retry or explicit discard. The
      // live document has already been rolled back by restoreDocumentData.
      setPendingRestore(saved);
      if (startupPolicy === 'auto') setAutoRestoreFailed(true);
      state.showToast(t('loadError'), 'error');
    }).finally(() => {
      setRestoring(false);
    });
  };

  // Silent restore once the canvas exists. Runs at most once per launch.
  useEffect(() => {
    if (startupPolicy !== 'auto' || !canvas || !pendingRestore || autoRestoreAttempted.current) return;
    autoRestoreAttempted.current = true;
    applyRestore(pendingRestore);
    // applyRestore is recreated every render; the guard above bounds the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startupPolicy, canvas, pendingRestore]);

  const confirmRestore = (saved: AutoSaveData) => {
    if (rememberAutoRestore) saveStartupRestorePreference('auto');
    applyRestore(saved);
  };

  const discardRestore = () => {
    void clearAutoSave();
    setCurrentProjectId(null);
    setPendingRestore(null);
    setAutoRestoreFailed(false);
  };

  const formatSavedAt = (iso?: string) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return '';
    }
  };

  // The dialog is shown only when the user asked to be prompted, or when the
  // silent restore failed and the user must decide what to do with the copy.
  const showRestoreDialog = pendingRestore !== null
    && (startupPolicy === 'ask' || autoRestoreFailed);

  return (
    <div className="app" aria-busy={isRestoring}>
      <div className="app-interactive" inert={isRestoring || checkingAutoSave} aria-hidden={isRestoring || undefined}>
        <div className="app-header">
        <Toolbar />
        <div className="header-right">
          <ProjectManager />
          <BackupManager />
          <GeometryTools />
          <IconButton
            className={`lang-btn ${leftPanelOpen ? 'active' : ''}`}
            onClick={toggleLeftPanel}
            label={t('toggleToolsPanel')}
            aria-pressed={leftPanelOpen}
          >
            ☰
          </IconButton>
          <IconButton
            className={`lang-btn ${rightPanelOpen ? 'active' : ''}`}
            onClick={toggleRightPanel}
            label={t('togglePropertiesPanel')}
            aria-pressed={rightPanelOpen}
          >
            ◧
          </IconButton>
          <IconButton
            className="lang-btn command-palette-trigger"
            onClick={() => setCommandPaletteOpen(true)}
            label={`${t('commandPalette')} (Ctrl/⌘+K)`}
          >
            ⌘K
          </IconButton>
          <HelpManual />
          <div className="toolbar-separator" />
          <IconButton
            className="lang-btn"
            onClick={toggleTheme}
            label={t('tip_theme')}
            aria-pressed={theme === 'dark'}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </IconButton>
          <div className="toolbar-separator" />
          <span className="toolbar-group-label">{t('language')}</span>
          <button
            className={`lang-btn ${lang === 'ja' ? 'active' : ''}`}
            onClick={() => setLang('ja')}
            aria-pressed={lang === 'ja'}
            aria-label={`${t('language')}: 日本語`}
          >
            日本語
          </button>
          <button
            className={`lang-btn ${lang === 'en' ? 'active' : ''}`}
            onClick={() => setLang('en')}
            aria-pressed={lang === 'en'}
            aria-label={`${t('language')}: English`}
          >
            EN
          </button>
        </div>  {/* header-right */}
        </div>
        <div className="app-body">
        {leftPanelOpen && <ToolPanel />}
        <Canvas />
        {rightPanelOpen && (
          <div className="right-panels">
            <PagePanel />
            <PropertyPanel />
            <LayerPanel />
          </div>
        )}
        </div>
        <StatusBar />
        <ContextMenu />
        <ShortcutHelp />
        <Toast />
        <CommandPalette />
        {traceRequest && (
          <TraceDialog
            sourceImage={traceRequest.sourceImage}
            onClose={() => setTraceRequest(null)}
          />
        )}
        {cropImage && <ImageCropDialog image={cropImage} onClose={() => setCropImage(null)} />}

      {showRestoreDialog && pendingRestore && (
        <Dialog title={t('restoreTitle')} onClose={discardRestore} dismissible={false} maxWidth={380}>
            <div className="modal-body">
              <p style={{ fontSize: 13, marginBottom: 6 }}>
                {autoRestoreFailed ? t('restoreRetryMessage') : t('restoreMessage')}
              </p>
              {pendingRestore.savedAt && (
                <p style={{ fontSize: 12, color: '#888' }}>
                  {t('restoreSavedAt')}: {formatSavedAt(pendingRestore.savedAt)}
                </p>
              )}
              {!autoRestoreFailed && (
                <label className="restore-remember">
                  <input
                    type="checkbox"
                    checked={rememberAutoRestore}
                    onChange={(event) => setRememberAutoRestore(event.target.checked)}
                  />
                  <span>{t('restoreAutoNextTime')}</span>
                </label>
              )}
            </div>
            <div className="nm-actions">
              <button className="toolbar-btn nm-btn" onClick={() => confirmRestore(pendingRestore)}>
                {t('restoreConfirm')}
              </button>
              <button className="toolbar-btn nm-btn nm-cancel" onClick={discardRestore}>
                {t('restoreDiscard')}
              </button>
            </div>
        </Dialog>
      )}
      </div>

      {isRestoring && (
        <div className="restore-blocker" role="status" aria-live="assertive">
          <span>{t('restoringDocument')}</span>
        </div>
      )}
    </div>
  );
}

export default App;
