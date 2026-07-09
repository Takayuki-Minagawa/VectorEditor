import { useEffect } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../store/useEditorStore';
import {
  copyActive,
  deleteSelected,
  duplicateActive,
  groupSelection,
  moveActiveBy,
  pasteClipboard,
  selectAll,
  ungroupActive,
} from '../utils/canvasCommands';

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const { canvas, undo, redo, pushHistory, setActiveTool, clipboard, setClipboard } =
        useEditorStore.getState();
      if (!canvas) return;

      const isMeta = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement;

      // Don't intercept when typing in inputs
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        return;
      }

      // Don't intercept when editing text in canvas
      const activeObj = canvas.getActiveObject();
      if (activeObj instanceof fabric.Textbox && activeObj.isEditing) {
        // Allow only Escape
        if (e.key === 'Escape') {
          activeObj.exitEditing();
          canvas.requestRenderAll();
          e.preventDefault();
        }
        return;
      }

      // Undo: Ctrl+Z
      if (isMeta && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        undo();
        return;
      }

      // Redo: Ctrl+Shift+Z or Ctrl+Y
      if ((isMeta && e.shiftKey && e.key === 'z') || (isMeta && e.key === 'y')) {
        e.preventDefault();
        redo();
        return;
      }

      // Select all: Ctrl+A
      if (isMeta && e.key === 'a') {
        e.preventDefault();
        selectAll(canvas);
        return;
      }

      // Copy: Ctrl+C
      if (isMeta && e.key === 'c') {
        e.preventDefault();
        copyActive(canvas, setClipboard);
        return;
      }

      // Paste: Ctrl+V
      if (isMeta && e.key === 'v') {
        e.preventDefault();
        pasteClipboard(canvas, clipboard, setClipboard, pushHistory);
        return;
      }

      // Duplicate: Ctrl+D
      if (isMeta && e.key === 'd') {
        e.preventDefault();
        duplicateActive(canvas, pushHistory);
        return;
      }

      // Group: Ctrl+G
      if (isMeta && !e.shiftKey && e.key === 'g') {
        e.preventDefault();
        groupSelection(canvas, pushHistory);
        return;
      }

      // Ungroup: Ctrl+Shift+G
      if (isMeta && e.shiftKey && e.key === 'G') {
        e.preventDefault();
        ungroupActive(canvas, pushHistory);
        return;
      }

      // Delete
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected(canvas, pushHistory);
        return;
      }

      // Arrow keys: move selected objects
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const active = canvas.getActiveObject();
        if (!active) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        switch (e.key) {
          case 'ArrowUp':
            moveActiveBy(canvas, 0, -step, pushHistory);
            break;
          case 'ArrowDown':
            moveActiveBy(canvas, 0, step, pushHistory);
            break;
          case 'ArrowLeft':
            moveActiveBy(canvas, -step, 0, pushHistory);
            break;
          case 'ArrowRight':
            moveActiveBy(canvas, step, 0, pushHistory);
            break;
        }
        return;
      }

      // Escape: deselect
      if (e.key === 'Escape') {
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        setActiveTool('select');
        return;
      }

      // V for select tool
      if (e.key === 'v' && !isMeta) {
        setActiveTool('select');
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
