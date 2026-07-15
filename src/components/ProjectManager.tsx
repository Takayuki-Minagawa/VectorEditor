import { useEffect, useId, useRef, useState } from 'react';
import { captureCurrentEditorSnapshot, useEditorStore } from '../store/useEditorStore';
import { useUiStore } from '../store/useUiStore';
import { useI18n } from '../i18n/useI18n';
import {
  DOCUMENT_VERSION,
  isDocumentRestoreSupersededError,
  restoreDocumentData,
  serializeCanvasSnapshot,
} from '../utils/documentSerializer';
import {
  deleteProject,
  deleteProjectSnapshot,
  listProjects,
  listProjectSnapshots,
  saveProjectVersion,
} from '../services/projectRepository';
import type { ProjectDocument, ProjectSnapshot } from '../services/projectRepository';
import type { DocumentData } from '../types';
import Dialog from './Dialog';
import IconButton from './IconButton';

function createId(prefix: string): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
}

export default function ProjectManager() {
  const canvas = useEditorStore((state) => state.canvas);
  const t = useI18n((state) => state.t);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [projects, setProjects] = useState<ProjectDocument[]>([]);
  const currentId = useUiStore((state) => state.currentProjectId);
  const setCurrentId = useUiStore((state) => state.setCurrentProjectId);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<ProjectSnapshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ProjectDocument | null>(null);
  const snapshotRequestRef = useRef(0);
  const titleId = useId();

  const refreshProjects = async () => {
    const records = await listProjects();
    setProjects(records);
    const current = records.find((project) => project.id === currentId);
    if (current && !title) setTitle(current.title);
  };

  useEffect(() => {
    if (!open) return;
    setBusy(true);
    refreshProjects()
      .catch(() => useEditorStore.getState().showToast(t('projectStorageError'), 'error'))
      .finally(() => setBusy(false));
    // `title` is deliberately not a dependency; opening must not overwrite a draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentId, t]);

  const captureDocument = (documentId: string): DocumentData | null => {
    const state = useEditorStore.getState();
    if (!state.canvas) return null;
    return {
      documentId,
      version: DOCUMENT_VERSION,
      ...serializeCanvasSnapshot({
        canvas: state.canvas,
        canvasWidth: state.canvasWidth,
        canvasHeight: state.canvasHeight,
        backgroundColor: state.backgroundColor,
        drawingMode: state.drawingMode,
        cadUnit: state.cadUnit,
        scale: state.scale,
        cadWidth: state.cadWidth,
        cadHeight: state.cadHeight,
        gridVisible: state.gridVisible,
        gridSize: state.gridSize,
        snapToGrid: state.snapToGrid,
        snapToObjects: state.snapToObjects,
        showRulers: state.showRulers,
        guides: state.guides,
        snapToGuides: state.snapToGuides,
        orthoMode: state.orthoMode,
      }),
    };
  };

  const save = async (saveAsNew: boolean) => {
    if (!canvas || !title.trim() || busy) return;
    const existing = saveAsNew ? undefined : projects.find((project) => project.id === currentId);
    const documentId = existing?.id ?? createId('doc');
    const document = captureDocument(documentId);
    if (!document) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      let thumbnail: string | undefined;
      try {
        thumbnail = canvas.toDataURL({ format: 'png', multiplier: 0.15 });
      } catch {
        thumbnail = existing?.thumbnail;
      }
      const project: ProjectDocument = {
        id: documentId,
        title: title.trim(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        latest: document,
        thumbnail,
      };
      const snapshot: ProjectSnapshot = {
        id: createId('snapshot'),
        documentId,
        label: new Date(now).toLocaleString(),
        createdAt: now,
        data: document,
      };
      await saveProjectVersion(project, snapshot);
      setCurrentId(documentId);
      await refreshProjects();
      if (expandedId === documentId) setSnapshots(await listProjectSnapshots(documentId));
      useEditorStore.getState().showToast(t('projectSaved'), 'success');
    } catch {
      useEditorStore.getState().showToast(t('projectStorageError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const restore = async (data: DocumentData, project: ProjectDocument) => {
    if (!canvas || busy) return;
    setBusy(true);
    const state = useEditorStore.getState();
    try {
      await restoreDocumentData(canvas, data, {
        setCanvasSize: state.setCanvasSize,
        setBackgroundColor: state.setBackgroundColor,
        setDrawingMode: state.setDrawingMode,
        setCadUnit: state.setCadUnit,
        setScale: state.setScale,
        setCadSize: state.setCadSize,
        restoreEditorSettings: (snapshot) => useEditorStore.setState({
          gridVisible: snapshot.gridVisible ?? false,
          gridSize: snapshot.gridSize ?? 20,
          snapToGrid: snapshot.snapToGrid ?? false,
          snapToObjects: snapshot.snapToObjects ?? false,
          showRulers: snapshot.showRulers ?? false,
          guides: snapshot.guides ?? [],
          snapToGuides: snapshot.snapToGuides ?? false,
          orthoMode: snapshot.orthoMode ?? false,
        }),
      }, {
        rollbackSnapshot: captureCurrentEditorSnapshot() ?? undefined,
      });
      setCurrentId(project.id);
      setTitle(project.title);
      useEditorStore.getState().showToast(t('projectOpened'), 'success');
      setOpen(false);
    } catch (error: unknown) {
      if (isDocumentRestoreSupersededError(error)) return;
      useEditorStore.getState().showToast(t('loadError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleSnapshots = async (project: ProjectDocument) => {
    if (expandedId === project.id) {
      snapshotRequestRef.current += 1;
      setExpandedId(null);
      setSnapshots([]);
      return;
    }
    setExpandedId(project.id);
    setSnapshots([]);
    setBusy(true);
    const requestId = ++snapshotRequestRef.current;
    try {
      const next = await listProjectSnapshots(project.id);
      if (snapshotRequestRef.current === requestId) setSnapshots(next);
    } catch {
      if (snapshotRequestRef.current === requestId) {
        setSnapshots([]);
        useEditorStore.getState().showToast(t('projectStorageError'), 'error');
      }
    } finally {
      if (snapshotRequestRef.current === requestId) setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete || busy) return;
    setBusy(true);
    try {
      await deleteProject(pendingDelete.id);
      if (currentId === pendingDelete.id) {
        setCurrentId(null);
      }
      setPendingDelete(null);
      await refreshProjects();
    } catch {
      useEditorStore.getState().showToast(t('projectStorageError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeSnapshot = async (snapshot: ProjectSnapshot) => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteProjectSnapshot(snapshot.id);
      setSnapshots((current) => current.filter((item) => item.id !== snapshot.id));
    } catch {
      useEditorStore.getState().showToast(t('projectStorageError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="toolbar-btn" onClick={() => setOpen(true)} title={t('projectManager')}>
        {t('projects')}
      </button>
      {open && (
        <Dialog title={t('projectManager')} onClose={() => setOpen(false)} closeLabel={t('measureClose')} className="project-dialog">
          <div className="modal-body">
            <div className="project-save-row">
              <label htmlFor={titleId}>{t('projectTitle')}</label>
              <input id={titleId} value={title} onChange={(event) => setTitle(event.target.value)} data-autofocus />
              <button className="toolbar-btn" onClick={() => save(false)} disabled={busy || !title.trim()}>{t('saveSnapshot')}</button>
              <button className="toolbar-btn" onClick={() => save(true)} disabled={busy || !title.trim()}>{t('saveAsProject')}</button>
            </div>
            <div className="project-list" aria-busy={busy}>
              {!busy && projects.length === 0 && <p className="layer-empty">{t('noProjects')}</p>}
              {projects.map((project) => (
                <div key={project.id} className={`project-card ${project.id === currentId ? 'active' : ''}`}>
                  {project.thumbnail && <img src={project.thumbnail} alt="" />}
                  <div className="project-card-main">
                    <strong>{project.title}</strong>
                    <time dateTime={project.updatedAt}>{new Date(project.updatedAt).toLocaleString()}</time>
                    <div className="project-actions">
                      <button className="toolbar-btn" onClick={() => restore(project.latest, project)} disabled={busy}>{t('openProject')}</button>
                      <button className="toolbar-btn" onClick={() => toggleSnapshots(project)} disabled={busy}>{t('versions')}</button>
                      <IconButton className="project-delete" onClick={() => setPendingDelete(project)} disabled={busy} label={t('deleteProject')}>×</IconButton>
                    </div>
                  </div>
                  {expandedId === project.id && (
                    <div className="snapshot-list">
                      {snapshots.map((snapshot) => (
                        <div key={snapshot.id} className="snapshot-row">
                          <button onClick={() => restore(snapshot.data, project)} disabled={busy}>{snapshot.label}</button>
                          <IconButton onClick={() => removeSnapshot(snapshot)} disabled={busy} label={t('deleteSnapshot')}>×</IconButton>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Dialog>
      )}
      {pendingDelete && (
        <Dialog title={t('deleteProject')} onClose={() => setPendingDelete(null)} closeLabel={t('cancel')} className="confirm-dialog">
          <div className="modal-body">
            <p>{t('deleteProjectConfirm').replace('{name}', pendingDelete.title)}</p>
          </div>
          <div className="nm-actions">
            <button className="toolbar-btn nm-btn" onClick={confirmDelete} disabled={busy}>{t('delete')}</button>
            <button className="toolbar-btn nm-btn nm-cancel" onClick={() => setPendingDelete(null)}>{t('cancel')}</button>
          </div>
        </Dialog>
      )}
    </>
  );
}
