import type { DocumentData } from '../types';
import { MAX_DOCUMENT_BYTES, parseDocumentData } from '../utils/documentSerializer';
import { deleteProject, insertProjectBundle, listProjects, listProjectSnapshots, type ProjectDocument, type ProjectSnapshot } from './projectRepository';
import { deleteSymbol, insertSymbol, listSymbols, type SymbolRecord } from './symbolRepository';

export const MAX_BACKUP_BYTES = MAX_DOCUMENT_BYTES;
interface ProjectBundle { project: ProjectDocument; snapshots: ProjectSnapshot[] }
export interface EditorBackup {
  kind: 'vectoreditor-backup';
  version: 1;
  createdAt: string;
  projects: ProjectBundle[];
  symbols: SymbolRecord[];
}
interface RestoreJournal { id: string; projectIds: string[]; symbolIds: string[] }
const JOURNAL_DB = 'vectoreditor-backup-journal';
const LOCK_NAME = 'vectoreditor-backup';
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request(LOCK_NAME, operation) : operation();
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid backup record');
  return value as Record<string, unknown>;
}
function string(value: unknown, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid backup text');
  return value;
}
function date(value: unknown): string {
  const text = string(value, 64);
  if (!Number.isFinite(Date.parse(text))) throw new Error('Invalid backup date');
  return text;
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('Invalid backup list');
  return value;
}
function thumbnail(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const result = string(value, 5_000_000);
  if (!/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(result)) throw new Error('Invalid thumbnail');
  return result;
}
function document(value: unknown): DocumentData { return parseDocumentData(JSON.stringify(value)); }
function unique(values: string[]): void {
  if (new Set(values).size !== values.length) throw new Error('Duplicate backup IDs');
}

export function parseBackup(raw: string): EditorBackup {
  if (new TextEncoder().encode(raw).byteLength > MAX_BACKUP_BYTES) throw new Error('Backup exceeds 100 MiB');
  const data = record(JSON.parse(raw));
  if (data.kind !== 'vectoreditor-backup' || data.version !== 1) throw new Error('Unsupported backup version');
  const projects = array(data.projects, 1000).map((item): ProjectBundle => {
    const bundle = record(item); const p = record(bundle.project);
    const id = string(p.id); const latest = document(p.latest);
    if (latest.documentId !== id) throw new Error('Project ID mismatch');
    const snapshots = array(bundle.snapshots, 20).map((item): ProjectSnapshot => {
      const s = record(item); const parsed = document(s.data);
      if (s.documentId !== id || parsed.documentId !== id) throw new Error('Snapshot ID mismatch');
      return { id: string(s.id), documentId: id, label: string(s.label), createdAt: date(s.createdAt), data: parsed };
    });
    return { project: { id, title: string(p.title), createdAt: date(p.createdAt), updatedAt: date(p.updatedAt),
      thumbnail: thumbnail(p.thumbnail), latest }, snapshots };
  });
  const symbols = array(data.symbols, 1000).map((item): SymbolRecord => {
    const s = record(item);
    // Use exactly the document validator for Fabric payloads and section metadata.
    const validated = document({ documentId: 'symbol-validation', version: 2,
      canvas: { width: 800, height: 600, backgroundColor: '#ffffff' }, objects: { objects: array(s.objects, 100000) } });
    return { id: string(s.id), name: string(s.name), createdAt: date(s.createdAt), updatedAt: date(s.updatedAt),
      thumbnail: thumbnail(s.thumbnail), objects: validated.objects.objects };
  });
  unique(projects.map((b) => b.project.id));
  unique(projects.flatMap((b) => b.snapshots.map((s) => s.id)));
  unique(symbols.map((s) => s.id));
  return { kind: 'vectoreditor-backup', version: 1, createdAt: date(data.createdAt), projects, symbols };
}

async function journal<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(JOURNAL_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('jobs', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = database.transaction('jobs', mode);
      const request = operation(tx.objectStore('jobs'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? new Error('Backup journal aborted'));
      tx.onerror = () => reject(tx.error ?? new Error('Backup journal failed'));
    });
  } finally { database.close(); }
}
async function cleanup(job: RestoreJournal): Promise<void> {
  // Journal stays durable until both databases are clean, allowing restart/retry.
  for (const id of job.projectIds) await deleteProject(id);
  for (const id of job.symbolIds) await deleteSymbol(id);
  await journal('readwrite', (store) => store.delete(job.id));
}
async function recover(): Promise<void> {
  const jobs = await journal('readonly', (store) => store.getAll() as IDBRequest<RestoreJournal[]>);
  for (const job of jobs) await cleanup(job);
}
export function recoverPendingBackups(): Promise<void> { return exclusive(recover); }

export function createBackup(projectIds: readonly string[], includeSymbols: boolean): Promise<EditorBackup> {
  return exclusive(async () => {
    await recover();
    const selected = new Set(projectIds);
    const projects: ProjectBundle[] = [];
    for (const project of await listProjects()) {
      if (selected.has(project.id)) projects.push({ project, snapshots: await listProjectSnapshots(project.id) });
    }
    if (projects.length !== selected.size) throw new Error('A selected project no longer exists');
    return parseBackup(JSON.stringify({ kind: 'vectoreditor-backup', version: 1, createdAt: new Date().toISOString(),
      projects, symbols: includeSymbols ? await listSymbols() : [] }));
  });
}

export function restoreBackup(input: EditorBackup): Promise<{ projects: number; symbols: number }> {
  return exclusive(async () => {
    const backup = parseBackup(JSON.stringify(input));
    await recover();
    const id = crypto.randomUUID();
    const projects = backup.projects.map(({ project, snapshots }, index): ProjectBundle => {
      const documentId = `restored_${id}_${index}`;
      // Object IDs are document-scoped: retain the complete graph and its links.
      return { project: { ...project, id: documentId, latest: { ...project.latest, documentId } },
        snapshots: snapshots.map((s, n) => ({ ...s, id: `snapshot_${id}_${index}_${n}`, documentId, data: { ...s.data, documentId } })) };
    });
    const symbols = backup.symbols.map((s, index) => ({ ...s, id: `symbol_${id}_${index}` }));
    const job: RestoreJournal = { id, projectIds: projects.map((b) => b.project.id), symbolIds: symbols.map((s) => s.id) };
    await journal('readwrite', (store) => store.add(job));
    try {
      for (const bundle of projects) await insertProjectBundle(bundle.project, bundle.snapshots);
      for (const symbol of symbols) await insertSymbol(symbol);
      await journal('readwrite', (store) => store.delete(id));
    } catch (error) {
      await cleanup(job); // If cleanup fails, the durable journal is retained.
      throw error;
    }
    return { projects: projects.length, symbols: symbols.length };
  });
}
