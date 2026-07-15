import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteSymbol, listSymbols, saveSymbol } from './symbolRepository';

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('vectoreditor-symbol-library');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Database deletion was blocked.'));
  });
}

describe('symbol repository', () => {
  beforeEach(deleteDatabase);

  it('commits saves and deletes before resolving', async () => {
    const record = {
      id: 'symbol-1',
      name: 'Door',
      objects: [{ type: 'Rect', width: 10, height: 20 }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await saveSymbol(record);
    expect(await listSymbols()).toEqual([record]);
    await deleteSymbol(record.id);
    expect(await listSymbols()).toEqual([]);
  });

  it('round-trips section profile metadata in a symbol record', async () => {
    const record = {
      id: 'symbol-section',
      name: 'Hollow section',
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
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    await saveSymbol(record);

    expect(await listSymbols()).toEqual([record]);
  });
});
