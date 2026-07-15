import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DocumentData } from '../types';
import {
  deleteProject,
  listProjects,
  listProjectSnapshots,
  saveProjectVersion,
} from './projectRepository';

const documentData: DocumentData = {
  documentId: 'doc-1',
  version: 2,
  canvas: { width: 800, height: 600, backgroundColor: '#fff' },
  objects: {
    version: '7.4.0',
    objects: [{
      type: 'Path',
      objectKind: 'sectionProfile',
      sectionProfileData: {
        version: 1,
        analysisToleranceMm: 0.01,
        approximate: false,
        rings: [{
          role: 'outer',
          points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }],
        }],
      },
    }],
  },
};

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('vectoreditor-projects');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Database deletion was blocked.'));
  });
}

describe('project repository', () => {
  beforeEach(deleteDatabase);

  it('stores projects and keeps the newest 20 versions', async () => {
    for (let index = 0; index < 22; index += 1) {
      const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
      await saveProjectVersion(
        { id: 'doc-1', title: 'Drawing', createdAt, updatedAt: createdAt, latest: documentData },
        { id: `snapshot-${index}`, documentId: 'doc-1', label: String(index), createdAt, data: documentData },
      );
    }

    const projects = await listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].latest.objects.objects[0]).toMatchObject({
      objectKind: 'sectionProfile',
      sectionProfileData: expect.objectContaining({ version: 1 }),
    });
    const versions = await listProjectSnapshots('doc-1');
    expect(versions).toHaveLength(20);
    expect(versions[0].id).toBe('snapshot-21');
    expect(versions.some((version) => version.id === 'snapshot-0')).toBe(false);
  });

  it('deletes a project and all versions', async () => {
    await saveProjectVersion(
      { id: 'doc-1', title: 'Drawing', createdAt: '2026-01-01', updatedAt: '2026-01-01', latest: documentData },
      { id: 'snapshot-1', documentId: 'doc-1', label: 'v1', createdAt: '2026-01-01', data: documentData },
    );
    await deleteProject('doc-1');
    expect(await listProjects()).toEqual([]);
    expect(await listProjectSnapshots('doc-1')).toEqual([]);
  });
});
