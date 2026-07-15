import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { loadAutoSaveAsync } from '../hooks/useAutoSave';
import {
  LEGACY_AUTOSAVE_STORAGE_KEY,
  clearAutoSaveRaw,
  loadAutoSaveRaw,
  saveAutoSaveRaw,
} from './autoSaveStorage';

describe('autosave storage fallback', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('indexedDB', undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the legacy store when IndexedDB is unavailable', async () => {
    await saveAutoSaveRaw('{"version":2}');

    expect(localStorage.getItem(LEGACY_AUTOSAVE_STORAGE_KEY)).toBe('{"version":2}');
    await expect(loadAutoSaveRaw()).resolves.toEqual({
      raw: '{"version":2}',
      source: 'localstorage',
    });
  });

  it('surfaces quota failures when no browser store accepts the snapshot', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });

    await expect(saveAutoSaveRaw('large snapshot')).rejects.toThrow(
      'No browser storage accepted the autosave snapshot',
    );
  });

  it('clears the compatibility snapshot', async () => {
    localStorage.setItem(LEGACY_AUTOSAVE_STORAGE_KEY, 'old');
    await clearAutoSaveRaw();
    expect(localStorage.getItem(LEGACY_AUTOSAVE_STORAGE_KEY)).toBeNull();
  });
});

function validAutoSave(savedAt: string, width: number): string {
  return JSON.stringify({
    version: 2,
    savedAt,
    canvas: { width, height: 600, backgroundColor: '#ffffff' },
    objects: { objects: [] },
  });
}

describe('autosave candidate selection', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('indexedDB', new IDBFactory());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('selects and migrates a newer valid localStorage snapshot', async () => {
    await saveAutoSaveRaw(validAutoSave('2026-07-15T01:00:00.000Z', 800));
    localStorage.setItem(
      LEGACY_AUTOSAVE_STORAGE_KEY,
      validAutoSave('2026-07-15T02:00:00.000Z', 900),
    );

    const loaded = await loadAutoSaveAsync();

    expect(loaded?.savedAt).toBe('2026-07-15T02:00:00.000Z');
    expect(loaded?.canvas.width).toBe(900);
    expect(localStorage.getItem(LEGACY_AUTOSAVE_STORAGE_KEY)).toBeNull();
    const migrated = await loadAutoSaveRaw();
    expect(migrated?.source).toBe('indexeddb');
    expect(JSON.parse(migrated?.raw ?? '{}')).toMatchObject({
      savedAt: '2026-07-15T02:00:00.000Z',
      canvas: { width: 900 },
    });
  });

  it('keeps a newer valid IndexedDB snapshot when localStorage is older', async () => {
    await saveAutoSaveRaw(validAutoSave('2026-07-15T03:00:00.000Z', 1000));
    localStorage.setItem(
      LEGACY_AUTOSAVE_STORAGE_KEY,
      validAutoSave('2026-07-15T02:00:00.000Z', 900),
    );

    const loaded = await loadAutoSaveAsync();

    expect(loaded?.savedAt).toBe('2026-07-15T03:00:00.000Z');
    expect(loaded?.canvas.width).toBe(1000);
  });

  it('falls back to a valid localStorage snapshot when IndexedDB is corrupt', async () => {
    await saveAutoSaveRaw('{not valid json');
    localStorage.setItem(
      LEGACY_AUTOSAVE_STORAGE_KEY,
      validAutoSave('2026-07-15T04:00:00.000Z', 1100),
    );

    const loaded = await loadAutoSaveAsync();

    expect(loaded?.savedAt).toBe('2026-07-15T04:00:00.000Z');
    expect(loaded?.canvas.width).toBe(1100);
  });

  it('ignores a corrupt localStorage snapshot when IndexedDB is valid', async () => {
    await saveAutoSaveRaw(validAutoSave('2026-07-15T05:00:00.000Z', 1200));
    localStorage.setItem(LEGACY_AUTOSAVE_STORAGE_KEY, '{not valid json');

    const loaded = await loadAutoSaveAsync();

    expect(loaded?.savedAt).toBe('2026-07-15T05:00:00.000Z');
    expect(loaded?.canvas.width).toBe(1200);
  });
});
