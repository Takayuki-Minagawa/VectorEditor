import { useEffect, useRef } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import {
  DOCUMENT_VERSION,
  parseAutoSaveData,
  serializeCanvasSnapshot,
} from '../utils/documentSerializer';
import type { AutoSaveData } from '../utils/documentSerializer';
import {
  clearAutoSaveRaw,
  loadAutoSaveCandidates,
  loadLegacyAutoSaveRaw,
  migrateLegacyAutoSave,
  saveAutoSaveRaw,
} from '../utils/autoSaveStorage';

const SAVE_INTERVAL = 10000;

export type { AutoSaveData } from '../utils/documentSerializer';

export function useAutoSave(paused = false) {
  const lastSavedSnapshot = useRef<string>('');
  const lastFailedSnapshot = useRef<string>('');
  const saveInFlight = useRef(false);
  // Keep the latest `paused` value readable inside the interval without
  // recreating it on every change.
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const save = async (): Promise<void> => {
      if (pausedRef.current || saveInFlight.current) return;
      const state = useEditorStore.getState();
      const { canvas } = state;
      if (!canvas || state.isRestoring) return;

      const payload = serializeCanvasSnapshot({
        canvas,
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
      });
      const snapshot = JSON.stringify(payload);
      if (snapshot === lastSavedSnapshot.current) return;

      saveInFlight.current = true;
      try {
        const dataToStore: AutoSaveData = {
          ...payload,
          version: DOCUMENT_VERSION,
          savedAt: new Date().toISOString(),
        };
        await saveAutoSaveRaw(JSON.stringify(dataToStore));
        lastSavedSnapshot.current = snapshot;
        lastFailedSnapshot.current = '';
      } catch {
        // Do not claim autosave succeeded when browser quotas or storage
        // permissions reject the write. Avoid repeating the same toast every
        // interval until the document changes or a later save succeeds.
        if (lastFailedSnapshot.current !== snapshot) {
          lastFailedSnapshot.current = snapshot;
          useEditorStore.getState().showToast(
            '自動保存に失敗しました。ブラウザの保存容量を確認してください。',
            'error',
          );
        }
      } finally {
        saveInFlight.current = false;
      }
    };

    const interval = window.setInterval(() => {
      void save();
    }, SAVE_INTERVAL);

    return () => window.clearInterval(interval);
  }, []);
}

/**
 * Synchronous compatibility API for the old localStorage-backed startup.
 * New callers should use loadAutoSaveAsync so IndexedDB snapshots are found.
 */
export function loadAutoSave(): AutoSaveData | null {
  try {
    const raw = loadLegacyAutoSaveRaw();
    return raw ? parseAutoSaveData(raw) : null;
  } catch {
    return null;
  }
}

export async function loadAutoSaveAsync(): Promise<AutoSaveData | null> {
  const candidates = await loadAutoSaveCandidates();
  const valid = candidates.flatMap((stored) => {
    try {
      return [{ stored, data: parseAutoSaveData(stored.raw) }];
    } catch {
      return [];
    }
  });
  if (valid.length === 0) return null;

  const timestamp = (data: AutoSaveData): number => (
    data.savedAt ? Date.parse(data.savedAt) : Number.NEGATIVE_INFINITY
  );
  const latest = valid.reduce((selected, candidate) => {
    const selectedTime = timestamp(selected.data);
    const candidateTime = timestamp(candidate.data);
    if (candidateTime > selectedTime) return candidate;
    if (
      candidateTime === selectedTime
      && selected.stored.source === 'localstorage'
      && candidate.stored.source === 'indexeddb'
    ) return candidate;
    return selected;
  });

  if (latest.stored.source === 'localstorage') {
    try {
      await migrateLegacyAutoSave(JSON.stringify(latest.data));
    } catch {
      // The validated localStorage copy remains available as a fallback.
    }
  }
  return latest.data;
}

export function clearAutoSave(): Promise<void> {
  return clearAutoSaveRaw();
}
