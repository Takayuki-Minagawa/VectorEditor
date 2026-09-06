import type { DocumentData } from '../types';

const DB_NAME = 'vectoreditor-projects';
const DB_VERSION = 1;
const DOCUMENT_STORE = 'documents';
const SNAPSHOT_STORE = 'snapshots';
const MAX_SNAPSHOTS_PER_DOCUMENT = 20;

export interface ProjectDocument {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  latest: DocumentData;
  thumbnail?: string;
}

export interface ProjectSnapshot {
  id: string;
  documentId: string;
  label: string;
  createdAt: string;
  data: DocumentData;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DOCUMENT_STORE)) {
        database.createObjectStore(DOCUMENT_STORE, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
        const store = database.createObjectStore(SNAPSHOT_STORE, { keyPath: 'id' });
        store.createIndex('documentId', 'documentId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the project database.'));
  });
}

export async function listProjects(): Promise<ProjectDocument[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(DOCUMENT_STORE, 'readonly');
    const done = transactionDone(transaction);
    const projects = await requestResult(transaction.objectStore(DOCUMENT_STORE).getAll() as IDBRequest<ProjectDocument[]>);
    await done;
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } finally {
    database.close();
  }
}

export async function listProjectSnapshots(documentId: string): Promise<ProjectSnapshot[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SNAPSHOT_STORE, 'readonly');
    const done = transactionDone(transaction);
    const index = transaction.objectStore(SNAPSHOT_STORE).index('documentId');
    const snapshots = await requestResult(index.getAll(documentId) as IDBRequest<ProjectSnapshot[]>);
    await done;
    return snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } finally {
    database.close();
  }
}

export async function saveProjectVersion(
  project: ProjectDocument,
  snapshot: ProjectSnapshot,
): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([DOCUMENT_STORE, SNAPSHOT_STORE], 'readwrite');
    transaction.objectStore(DOCUMENT_STORE).put(project);
    const snapshotStore = transaction.objectStore(SNAPSHOT_STORE);
    snapshotStore.put(snapshot);
    const existingRequest = snapshotStore.index('documentId').getAll(project.id) as IDBRequest<ProjectSnapshot[]>;
    existingRequest.onsuccess = () => {
      const stale = existingRequest.result
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(MAX_SNAPSHOTS_PER_DOCUMENT);
      stale.forEach((item) => snapshotStore.delete(item.id));
    };
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function deleteProjectSnapshot(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SNAPSHOT_STORE, 'readwrite');
    transaction.objectStore(SNAPSHOT_STORE).delete(id);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function deleteProject(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([DOCUMENT_STORE, SNAPSHOT_STORE], 'readwrite');
    transaction.objectStore(DOCUMENT_STORE).delete(id);
    const snapshotStore = transaction.objectStore(SNAPSHOT_STORE);
    const cursorRequest = snapshotStore.index('documentId').openKeyCursor(IDBKeyRange.only(id));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      snapshotStore.delete(cursor.primaryKey);
      cursor.continue();
    };
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

/** Insert a restored bundle without overwriting any existing project/version. */
export async function insertProjectBundle(project: ProjectDocument, snapshots: ProjectSnapshot[]): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([DOCUMENT_STORE, SNAPSHOT_STORE], 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(DOCUMENT_STORE).add(project);
    snapshots.forEach((snapshot) => transaction.objectStore(SNAPSHOT_STORE).add(snapshot));
    await done;
  } finally { database.close(); }
}
