import { useEffect, useRef } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import type { CadUnit, DrawingMode } from '../types';

const STORAGE_KEY = 'vectoreditor_autosave';
const SAVE_INTERVAL = 10000; // 10 seconds

export interface AutoSaveData {
  canvas: { width: number; height: number; backgroundColor: string };
  objects: string;
  drawingMode?: DrawingMode;
  cadUnit?: CadUnit;
  scale?: string;
  cadWidth?: number;
  cadHeight?: number;
  savedAt?: string;
}

export function useAutoSave() {
  const lastSavedSnapshot = useRef<string>('');

  useEffect(() => {
    const interval = setInterval(() => {
      const { canvas, canvasWidth, canvasHeight, backgroundColor, drawingMode, cadUnit, scale, cadWidth, cadHeight } = useEditorStore.getState();
      if (!canvas) return;

      const objects = JSON.stringify(canvas.toObject(['id', 'name', 'selectable', 'evented']));
      const payload: AutoSaveData = {
        canvas: { width: canvasWidth, height: canvasHeight, backgroundColor },
        objects,
        drawingMode,
        cadUnit,
        scale,
        cadWidth,
        cadHeight,
      };
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
    const parsed = JSON.parse(raw) as AutoSaveData;
    if (!parsed || !parsed.canvas || typeof parsed.objects !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearAutoSave() {
  localStorage.removeItem(STORAGE_KEY);
}
