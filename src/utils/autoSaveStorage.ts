export const LEGACY_AUTOSAVE_STORAGE_KEY = 'vectoreditor_autosave';
export const AUTOSAVE_DATABASE_NAME = 'vectoreditor-autosave';
export const AUTOSAVE_OBJECT_STORE = 'snapshots';
export const AUTOSAVE_RECORD_KEY = 'current';

const DATABASE_VERSION = 1;

interface AutoSaveRecord {
  key: string;
  value: string;
  updatedAt: string;
}

export interface StoredAutoSave {
  raw: string;
  source: 'indexeddb' | 'localstorage';
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDatabase(): Promise<IDBDatabase> {
  if (!hasIndexedDb()) return Promise.reject(new Error('IndexedDB is unavailable'));

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(AUTOSAVE_DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(AUTOSAVE_OBJECT_STORE)) {
        database.createObjectStore(AUTOSAVE_OBJECT_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open autosave storage'));
    request.onblocked = () => reject(new Error('Autosave storage upgrade is blocked'));
  });
}

async function readFromIndexedDb(): Promise<string | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(AUTOSAVE_OBJECT_STORE, 'readonly');
      const request = transaction.objectStore(AUTOSAVE_OBJECT_STORE).get(AUTOSAVE_RECORD_KEY);
      request.onsuccess = () => {
        const record = request.result as AutoSaveRecord | undefined;
        resolve(record?.value ?? null);
      };
      request.onerror = () => reject(request.error ?? new Error('Failed to read autosave'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Autosave read was aborted'));
    });
  } finally {
    database.close();
  }
}

async function writeToIndexedDb(raw: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(AUTOSAVE_OBJECT_STORE, 'readwrite');
      transaction.objectStore(AUTOSAVE_OBJECT_STORE).put({
        key: AUTOSAVE_RECORD_KEY,
        value: raw,
        updatedAt: new Date().toISOString(),
      } satisfies AutoSaveRecord);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Failed to write autosave'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Autosave write was aborted'));
    });
  } finally {
    database.close();
  }
}

async function deleteFromIndexedDb(): Promise<void> {
  if (!hasIndexedDb()) return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(AUTOSAVE_OBJECT_STORE, 'readwrite');
      transaction.objectStore(AUTOSAVE_OBJECT_STORE).delete(AUTOSAVE_RECORD_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Failed to clear autosave'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Autosave clear was aborted'));
    });
  } finally {
    database.close();
  }
}

function readLegacyLocalStorage(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(LEGACY_AUTOSAVE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function removeLegacyLocalStorage(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(LEGACY_AUTOSAVE_STORAGE_KEY);
  } catch {
    // IndexedDB remains the source of truth even if legacy cleanup is denied.
  }
}

export function loadLegacyAutoSaveRaw(): string | null {
  return readLegacyLocalStorage();
}

/**
 * Read every storage location independently.  During an IndexedDB migration
 * both stores can legitimately contain data (for example, if a previous
 * IndexedDB write succeeded but legacy cleanup was denied).  Validation and
 * recency selection happen at the document-schema boundary in useAutoSave.
 */
export async function loadAutoSaveCandidates(): Promise<StoredAutoSave[]> {
  const candidates: StoredAutoSave[] = [];
  try {
    const raw = await readFromIndexedDb();
    if (raw) candidates.push({ raw, source: 'indexeddb' });
  } catch {
    // Browsers can deny IndexedDB (for example in restricted/private modes).
  }

  const legacy = readLegacyLocalStorage();
  if (legacy) candidates.push({ raw: legacy, source: 'localstorage' });
  return candidates;
}

/** Compatibility helper for callers that only need the preferred store. */
export async function loadAutoSaveRaw(): Promise<StoredAutoSave | null> {
  return (await loadAutoSaveCandidates())[0] ?? null;
}

/** IndexedDB first, with localStorage retained as a compatibility fallback. */
export async function saveAutoSaveRaw(raw: string): Promise<void> {
  try {
    await writeToIndexedDb(raw);
    removeLegacyLocalStorage();
    return;
  } catch (indexedDbError) {
    if (typeof localStorage === 'undefined') throw indexedDbError;
    try {
      localStorage.setItem(LEGACY_AUTOSAVE_STORAGE_KEY, raw);
      return;
    } catch (localStorageError) {
      throw new AggregateError(
        [indexedDbError, localStorageError],
        'No browser storage accepted the autosave snapshot',
      );
    }
  }
}

export async function migrateLegacyAutoSave(raw: string): Promise<void> {
  if (!hasIndexedDb()) return;
  await writeToIndexedDb(raw);
  removeLegacyLocalStorage();
}

export async function clearAutoSaveRaw(): Promise<void> {
  removeLegacyLocalStorage();
  try {
    await deleteFromIndexedDb();
  } catch {
    // Clearing the compatibility store still prevents a synchronous legacy
    // restore; a denied IndexedDB connection cannot be acted on here.
  }
}
