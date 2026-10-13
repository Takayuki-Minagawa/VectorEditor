import { useEffect, useRef } from 'react';
import { selectCanvasStateInput, useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import {
  DOCUMENT_VERSION,
  parseAutoSaveData,
  serializeCanvasSnapshot,
} from '../utils/documentSerializer';
import type { AutoSaveData } from '../utils/documentSerializer';
import {
  clearAutoSaveRaw,
  loadAutoSaveCandidates,
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
      if (state.isRestoring) return;
      const input = selectCanvasStateInput(state);
      if (!input) return;

      const payload = serializeCanvasSnapshot(input);
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
          useEditorStore.getState().showToast(useI18n.getState().t('autoSaveFailed'), 'error');
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
