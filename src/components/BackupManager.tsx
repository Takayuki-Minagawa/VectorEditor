import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/useI18n';
import { useEditorStore } from '../store/useEditorStore';
import { listProjects, type ProjectDocument } from '../services/projectRepository';
import { createBackup, MAX_BACKUP_BYTES, parseBackup, recoverPendingBackups, restoreBackup, type EditorBackup } from '../services/backupService';
import Dialog from './Dialog';

export default function BackupManager() {
  const t = useI18n((s) => s.t);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<ProjectDocument[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [includeSymbols, setIncludeSymbols] = useState(true);
  const [pending, setPending] = useState<{ data: EditorBackup; size: number } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBusy(true); setError(false); setPending(null);
    recoverPendingBackups().then(listProjects).then((items) => {
      if (!cancelled) { setProjects(items); setSelected(items.map((p) => p.id)); }
    }).catch(() => { if (!cancelled) setError(true); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [open]);
  const download = async () => {
    setBusy(true); setError(false);
    try {
      const data = await createBackup(selected, includeSymbols);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url;
      link.download = `vectoreditor-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError(true); } finally { setBusy(false); }
  };
  const read = async (file?: File) => {
    if (!file) return;
    setBusy(true); setError(false); setPending(null);
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('Too large');
      setPending({ data: parseBackup(await file.text()), size: file.size });
    } catch { setError(true); } finally { setBusy(false); }
  };
  const restore = async () => {
    if (!pending) return;
    setBusy(true); setError(false);
    try {
      await restoreBackup(pending.data);
      setPending(null);
      setProjects(await listProjects());
      useEditorStore.getState().showToast(t('backupRestored'), 'success');
    } catch { setError(true); } finally { setBusy(false); }
  };
  return <>
    <button className="toolbar-btn" onClick={() => setOpen(true)}>{t('backupTitle')}</button>
    {open && <Dialog title={t('backupTitle')} onClose={() => setOpen(false)} dismissible={!busy} closeLabel={t('close')} className="backup-dialog">
      <div className="modal-body" aria-busy={busy}>
        <p className="feature-help">{t('backupDescription')}</p>
        <fieldset className="feature-fieldset" disabled={busy}>
          <legend>{t('backupExport')}</legend>
          <div className="backup-project-list">
            {projects.map((p) => <label className="feature-check" key={p.id}><input type="checkbox" checked={selected.includes(p.id)} onChange={(e) => setSelected((ids) => e.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id))} />{p.title}</label>)}
            {projects.length === 0 && <p>{t('noProjects')}</p>}
          </div>
          <label className="feature-check"><input type="checkbox" checked={includeSymbols} onChange={(e) => setIncludeSymbols(e.target.checked)} />{t('backupSymbols')}</label>
          <button className="toolbar-btn" disabled={!selected.length && !includeSymbols} onClick={() => void download()}>{t('backupDownload')}</button>
        </fieldset>
        <fieldset className="feature-fieldset" disabled={busy}>
          <legend>{t('backupImport')}</legend>
          <label htmlFor="backup-file">{t('backupFile')}</label>
          <input id="backup-file" type="file" accept=".json,application/json" onChange={(e) => { void read(e.target.files?.[0]); e.target.value = ''; }} />
          {pending && <>
            <p>{t('backupPreview').replace('{projects}', String(pending.data.projects.length)).replace('{snapshots}', String(pending.data.projects.reduce((n, b) => n + b.snapshots.length, 0))).replace('{symbols}', String(pending.data.symbols.length))} / {(pending.size / 1024).toFixed(1)} KiB</p>
            <ul>{pending.data.projects.map((b) => <li key={b.project.id}>{b.project.title}</li>)}</ul>
            <p className="feature-help">{t('backupCopyNotice')}</p>
            <button className="toolbar-btn" disabled={!pending.data.projects.length && !pending.data.symbols.length} onClick={() => void restore()}>{t('backupRestore')}</button>
          </>}
        </fieldset>
        {busy && <p role="status">{t('backupWorking')}</p>}
        {error && <p role="alert">{t('backupError')}</p>}
      </div>
    </Dialog>}
  </>;
}
