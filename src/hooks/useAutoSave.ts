import { useEffect, useRef } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import {
  parseAutoSaveData,
  serializeCanvasSnapshot,
} from '../utils/documentSerializer';
import type { AutoSaveData } from '../utils/documentSerializer';

const STORAGE_KEY = 'vectoreditor_autosave';
const SAVE_INTERVAL = 10000; // 10 seconds

export type { AutoSaveData } from '../utils/documentSerializer';

export function useAutoSave(paused = false) {
  const lastSavedSnapshot = useRef<string>('');
  // Keep the latest `paused` value readable inside the interval without
  // recreating it on every change.
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const interval = setInterval(() => {
      // While a restore decision is pending, don't overwrite the saved snapshot.
      if (pausedRef.current) return;
      const { canvas, canvasWidth, canvasHeight, backgroundColor, drawingMode, cadUnit, scale, cadWidth, cadHeight } = useEditorStore.getState();
      if (!canvas) return;

      const payload = serializeCanvasSnapshot({
        canvas,
        canvasWidth,
        canvasHeight,
        backgroundColor,
        drawingMode,
        cadUnit,
        scale,
        cadWidth,
        cadHeight,
      });
      const snapshot = JSON.stringify(payload);
      if (snapshot === lastSavedSnapshot.current) return;

      try {
        const dataToStore: AutoSaveData = {
          ...payload,
          savedAt: new Date().toISOString(),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToStore));
        lastSavedSnapshot.current = snapshot;
      } catch {
        // localStorage might be full
      }
    }, SAVE_INTERVAL);

    return () => clearInterval(interval);
  }, []);
}

export function loadAutoSave(): AutoSaveData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return parseAutoSaveData(raw);
  } catch {
    return null;
  }
}

export function clearAutoSave() {
  localStorage.removeItem(STORAGE_KEY);
}
