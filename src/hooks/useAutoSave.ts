import { useEffect, useRef } from 'react';
import { useEditorStore } from '../store/useEditorStore';

const STORAGE_KEY = 'vectoreditor_autosave';
const SAVE_INTERVAL = 10000; // 10 seconds

export function useAutoSave() {
  const lastSaved = useRef<string>('');

  useEffect(() => {
    const interval = setInterval(() => {
      const { canvas, canvasWidth, canvasHeight, backgroundColor } = useEditorStore.getState();
      if (!canvas) return;

      const json = JSON.stringify(canvas.toJSON(['id', 'name', 'selectable', 'evented']));
      if (json === lastSaved.current) return;

      const data = {
        canvas: { width: canvasWidth, height: canvasHeight, backgroundColor },
        objects: json,
        savedAt: new Date().toISOString(),
      };

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        lastSaved.current = json;
      } catch {
        // localStorage might be full
      }
    }, SAVE_INTERVAL);

    return () => clearInterval(interval);
  }, []);
}

export function loadAutoSave(): {
  canvas: { width: number; height: number; backgroundColor: string };
  objects: string;
} | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearAutoSave() {
  localStorage.removeItem(STORAGE_KEY);
}
