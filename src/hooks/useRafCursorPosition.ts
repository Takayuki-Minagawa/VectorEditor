import { useCallback, useEffect, useRef } from 'react';
import { useEditorStore } from '../store/useEditorStore';

export function useRafCursorPosition() {
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const lastPublishedRef = useRef<{ x: number; y: number } | null>(null);

  const flush = useCallback(() => {
    frameRef.current = null;
    const pending = pendingRef.current;
    if (!pending) return;
    const rounded = { x: Math.round(pending.x), y: Math.round(pending.y) };
    const previous = lastPublishedRef.current;
    if (!previous || previous.x !== rounded.x || previous.y !== rounded.y) {
      lastPublishedRef.current = rounded;
      useEditorStore.getState().setCursorPos(pending);
    }
  }, []);

  const scheduleCursorPosition = useCallback((point: { x: number; y: number }) => {
    pendingRef.current = point;
    if (frameRef.current === null) {
      frameRef.current = window.requestAnimationFrame(flush);
    }
  }, [flush]);

  const clearCursorPosition = useCallback(() => {
    pendingRef.current = null;
    lastPublishedRef.current = null;
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    useEditorStore.getState().setCursorPos(null);
  }, []);

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
  }, []);

  return { scheduleCursorPosition, clearCursorPosition };
}
