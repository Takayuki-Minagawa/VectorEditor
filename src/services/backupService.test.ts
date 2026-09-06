import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackup, parseBackup, recoverPendingBackups, restoreBackup, type EditorBackup } from './backupService';
import { listProjects, listProjectSnapshots, saveProjectVersion } from './projectRepository';
import * as symbols from './symbolRepository';
import type { DocumentData } from '../types';
const data: DocumentData = { version: 2, documentId: 'p1', canvas: { width: 800, height: 600, backgroundColor: '#ffffff' }, objects: { objects: [
  { type: 'Rect', id: 'r1', width: 100, height: 200 },
  { type: 'Group', id: 'd1', objectKind: 'dimension', dimensionData: { start: { x: 0, y: 0, objectId: 'r1', anchor: 'topLeft' }, end: { x: 100, y: 0, objectId: 'r1', anchor: 'topRight' } }, objects: [] },
] } };
const now = '2026-09-06T00:00:00.000Z';
async function seed() {
  await saveProjectVersion({ id: 'p1', title: 'Plan', createdAt: now, updatedAt: now, latest: data }, { id: 'v1', documentId: 'p1', label: 'One', createdAt: now, data });
  await symbols.saveSymbol({ id: 's1', name: 'Door', objects: data.objects.objects, createdAt: now, updatedAt: now });
}
async function resetDatabase(name: string) {
  await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error); });
}
beforeEach(async () => {
  vi.restoreAllMocks();
  for (const db of ['vectoreditor-projects', 'vectoreditor-symbol-library', 'vectoreditor-backup-journal']) await resetDatabase(db);
});
describe('portable backup', () => {
  it('restores projects, versions and symbols as copies, preserving semantic references', async () => {
    await seed();
    const backup = await createBackup(['p1'], true);
    expect(parseBackup(JSON.stringify(backup))).toEqual(backup);
    await restoreBackup(backup);
    const projects = await listProjects();
    expect(projects).toHaveLength(2);
    expect(projects.find((p) => p.id === 'p1')?.latest).toEqual(data);
    const copy = projects.find((p) => p.id !== 'p1')!;
    expect(copy.latest.documentId).toBe(copy.id);
    expect(copy.latest.objects).toEqual(data.objects);
    const versions = await listProjectSnapshots(copy.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].data.documentId).toBe(copy.id);
    expect(versions[0].id).not.toBe('v1');
    expect(await symbols.listSymbols()).toHaveLength(2);
  });
  it('restores to an empty environment and honors export filters', async () => {
    await seed(); const backup = await createBackup(['p1'], false);
    expect(backup.symbols).toHaveLength(0);
    expect((await createBackup([], true)).projects).toHaveLength(0);
    await resetDatabase('vectoreditor-projects'); await resetDatabase('vectoreditor-symbol-library');
    await restoreBackup(backup);
    expect(await listProjects()).toHaveLength(1);
    expect(await symbols.listSymbols()).toHaveLength(0);
  });
  it('rejects mismatched references, duplicate IDs and invalid documents before writing', async () => {
    await seed(); const backup = await createBackup(['p1'], true);
    const invalid = structuredClone(backup); invalid.projects[0].snapshots[0].documentId = 'other';
    await expect(restoreBackup(invalid)).rejects.toThrow();
    expect(() => parseBackup(JSON.stringify({ ...backup, version: 9 }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...backup, projects: [...backup.projects, ...backup.projects] }))).toThrow();
    const malformed = structuredClone(backup);
    malformed.symbols[0].objects = [{ type: 'Path', objectKind: 'sectionProfile' }];
    await expect(restoreBackup(malformed)).rejects.toThrow();
    expect(await listProjects()).toHaveLength(1);
  });
  it('rolls back both databases after a quota failure and retries without partial duplicates', async () => {
    await seed(); const backup = await createBackup(['p1'], true);
    const fail = vi.spyOn(symbols, 'insertSymbol').mockRejectedValueOnce(new DOMException('Full', 'QuotaExceededError'));
    await expect(restoreBackup(backup)).rejects.toThrow();
    expect(await listProjects()).toHaveLength(1); expect(await symbols.listSymbols()).toHaveLength(1);
    fail.mockRestore(); await restoreBackup(backup);
    expect(await listProjects()).toHaveLength(2); expect(await symbols.listSymbols()).toHaveLength(2);
  });
  it('cleans an interrupted restore on restart while preserving existing data', async () => {
    await seed();
    // Simulate a process dying after inserting a new project but before the next DB write.
    const partial = { ...data, documentId: 'partial' };
    await saveProjectVersion({ id: 'partial', title: 'Partial', createdAt: now, updatedAt: now, latest: partial }, { id: 'partial-v', documentId: 'partial', label: 'One', createdAt: now, data: partial });
    await recoverPendingBackups(); // create journal schema
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open('vectoreditor-backup-journal', 1);
      r.onsuccess = () => {
        const db = r.result; const tx = db.transaction('jobs', 'readwrite');
        tx.objectStore('jobs').add({ id: 'interrupted', projectIds: ['partial'], symbolIds: ['missing'] });
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
    await recoverPendingBackups(); await recoverPendingBackups();
    expect((await listProjects()).map((p) => p.id)).toEqual(['p1']);
    expect(await listProjectSnapshots('partial')).toHaveLength(0);
  });
  it('migrates v1 project documents before restoring', async () => {
    await seed(); const backup = await createBackup(['p1'], true);
    const legacy = structuredClone(backup) as EditorBackup;
    const old = { ...data, version: 1, objects: JSON.stringify(data.objects) };
    const raw = JSON.stringify(legacy).replace(JSON.stringify(data), JSON.stringify(old));
    expect(parseBackup(raw).projects[0].project.latest.version).toBe(2);
  });
});
