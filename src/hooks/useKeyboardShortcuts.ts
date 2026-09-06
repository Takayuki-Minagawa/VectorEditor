import { useEffect } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../store/useEditorStore';
import {
  deleteSelected,
  duplicateActive,
  groupSelection,
  moveActiveBy,
  selectAll,
  ungroupActive,
} from '../utils/canvasCommands';

export function useKeyboardShortcuts() {
  useEffect(() => {
    let arrowTransactionActive = false;

    const handler = (e: KeyboardEvent) => {
      const { canvas, isRestoring, undo, redo, pushHistory, setActiveTool, beginHistoryTransaction } =
        useEditorStore.getState();
      if (!canvas || isRestoring) return;

      const isMeta = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement;
      const key = e.key.toLocaleLowerCase();

      // Modal dialogs own their keyboard interaction. Never mutate the
      // document behind an open dialog.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;

      // Don't intercept when typing in inputs
      if (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        return;
      }

      // Don't intercept when editing text in canvas
      const activeObj = canvas.getActiveObject();
      if ((activeObj instanceof fabric.Textbox || activeObj instanceof fabric.IText) && activeObj.isEditing) {
        // Allow only Escape
        if (e.key === 'Escape') {
          activeObj.exitEditing();
          canvas.requestRenderAll();
          e.preventDefault();
        }
        return;
      }

      if (['calibrate', 'distanceMeasure', 'angleMeasure'].includes(useEditorStore.getState().activeTool)) {
        if (e.key === 'Escape') setActiveTool('select');
        return;
      }

      // Undo: Ctrl+Z
      if (isMeta && !e.shiftKey && key === 'z') {
        e.preventDefault();
        // Store-level Undo cancels an open gesture to its baseline. Reset the
        // local flag too so a still-held arrow key starts a fresh transaction.
        arrowTransactionActive = false;
        undo();
        return;
      }

      // Redo: Ctrl+Shift+Z or Ctrl+Y
      if ((isMeta && e.shiftKey && key === 'z') || (isMeta && key === 'y')) {
        e.preventDefault();
        arrowTransactionActive = false;
        redo();
        return;
      }

      // Select all: Ctrl+A
      if (isMeta && key === 'a') {
        e.preventDefault();
        selectAll(canvas);
        return;
      }

      // Native copy/paste events arbitrate editor selections and external images.
      if (isMeta && (key === 'c' || key === 'v')) return;

      // Duplicate: Ctrl+D
      if (isMeta && key === 'd') {
        e.preventDefault();
        duplicateActive(canvas, pushHistory);
        return;
      }

      // Group: Ctrl+G
      if (isMeta && !e.shiftKey && key === 'g') {
        e.preventDefault();
        groupSelection(canvas, pushHistory);
        return;
      }

      // Ungroup: Ctrl+Shift+G
      if (isMeta && e.shiftKey && key === 'g') {
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
        if (!arrowTransactionActive) {
          beginHistoryTransaction();
          arrowTransactionActive = true;
        }
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
      if (key === 'v' && !isMeta) {
        setActiveTool('select');
        return;
      }
    };

    const finishArrowTransaction = (event?: Event) => {
      if (event instanceof KeyboardEvent && !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      if (!arrowTransactionActive) return;
      arrowTransactionActive = false;
      useEditorStore.getState().endHistoryTransaction();
    };

    window.addEventListener('keydown', handler);
    window.addEventListener('keyup', finishArrowTransaction);
    window.addEventListener('blur', finishArrowTransaction);
    return () => {
      finishArrowTransaction();
      window.removeEventListener('keydown', handler);
      window.removeEventListener('keyup', finishArrowTransaction);
      window.removeEventListener('blur', finishArrowTransaction);
    };
  }, []);
}
