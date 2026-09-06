import { useEffect } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import { copyActive, pasteClipboard, createAsyncCanvasMutationGuard, currentClipboardMarker, waitForClipboardCopy } from '../utils/canvasCommands';
import { clipboardImage, importDrawingFile } from '../services/importService';

export function useExternalClipboard() {
  useEffect(() => {
    let queue: Promise<unknown> = Promise.resolve();
    const editorOwnsEvent = (event: ClipboardEvent) => {
      const state = useEditorStore.getState(); const target = event.target;
      if (!state.canvas || state.isRestoring || state.activeTool !== 'select' || document.querySelector('[role="dialog"][aria-modal="true"]')) return false;
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return false;
      const active = state.canvas.getActiveObject();
      return !(active instanceof fabric.IText && active.isEditing);
    };
    const copy = (event: ClipboardEvent) => {
      if (!editorOwnsEvent(event) || !event.clipboardData) return;
      const { canvas, setClipboard } = useEditorStore.getState();
      if (!canvas?.getActiveObjects().length) return;
      event.preventDefault();
      copyActive(canvas, setClipboard, (marker) => event.clipboardData!.setData('text/plain', marker));
    };
    const paste = (event: ClipboardEvent) => {
      if (!editorOwnsEvent(event) || !event.clipboardData) return;
      const state = useEditorStore.getState(); const data = event.clipboardData;
      const file = clipboardImage(data);
      if (file) {
        event.preventDefault();
        const canvas = state.canvas!;
        // Queue imports to preserve paste order. Each import validates document ownership.
        const canCommit = createAsyncCanvasMutationGuard(canvas);
        queue = queue.then(async () => {
          if (useEditorStore.getState().canvas !== canvas || useEditorStore.getState().isRestoring) return;
          if (!canCommit()) return;
          await importDrawingFile(canvas, file, state.pushHistory);
        }).catch(() => useEditorStore.getState().showToast(useI18n.getState().t('clipboardImportError'), 'error'));
      } else if (currentClipboardMarker() && data.getData('text/plain') === currentClipboardMarker()) {
        event.preventDefault();
        const marker = currentClipboardMarker(); const canCommit = createAsyncCanvasMutationGuard(state.canvas!);
        void waitForClipboardCopy().then(() => {
          if (!canCommit() || marker !== currentClipboardMarker()) return;
          const current = useEditorStore.getState();
          pasteClipboard(state.canvas!, current.clipboard, current.setClipboard, current.pushHistory);
        });
      } else if (data.types.length) {
        event.preventDefault(); useEditorStore.getState().showToast(useI18n.getState().t('clipboardImportUnsupported'), 'info');
      }
    };
    window.addEventListener('copy', copy); window.addEventListener('paste', paste);
    return () => { window.removeEventListener('copy', copy); window.removeEventListener('paste', paste); };
  }, []);
}
