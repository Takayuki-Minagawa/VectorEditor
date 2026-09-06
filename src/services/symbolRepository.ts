import type { CadLayer } from '../domain/cadLayer';
const DB_NAME = 'vectoreditor-symbol-library';
const STORE_NAME = 'symbols';
const DB_VERSION = 1;

export interface SymbolRecord {
  id: string;
  name: string;
  objects: unknown[];
  cadLayers?: CadLayer[];
  thumbnail?: string;
  createdAt: string;
  updatedAt: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the symbol library.'));
  });
}

async function transact<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      let result: T;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error ?? new Error('Symbol storage operation failed.'));
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error ?? new Error('Symbol storage transaction aborted.'));
      transaction.onerror = () => reject(transaction.error ?? new Error('Symbol storage transaction failed.'));
    });
  } finally {
    database.close();
  }
}

export async function listSymbols(): Promise<SymbolRecord[]> {
  const records = await transact<SymbolRecord[]>('readonly', (store) => store.getAll());
  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveSymbol(record: SymbolRecord): Promise<IDBValidKey> {
  return transact('readwrite', (store) => store.put(record));
}

export function deleteSymbol(id: string): Promise<undefined> {
  return transact('readwrite', (store) => store.delete(id)) as Promise<undefined>;
}

export function insertSymbol(record: SymbolRecord): Promise<IDBValidKey> {
  return transact('readwrite', (store) => store.add(record));
}
