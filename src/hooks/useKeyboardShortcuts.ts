import { useEffect } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../store/useEditorStore';

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
        canvas.discardActiveObject();
        const objects = canvas.getObjects();
        if (objects.length > 0) {
          const selection = new fabric.ActiveSelection(objects, { canvas });
          canvas.setActiveObject(selection);
          canvas.requestRenderAll();
        }
        return;
      }

      // Copy: Ctrl+C
      if (isMeta && e.key === 'c') {
        e.preventDefault();
        const active = canvas.getActiveObject();
        if (active) {
          active.clone().then((cloned: fabric.FabricObject) => {
            setClipboard([cloned]);
          });
        }
        return;
      }

      // Paste: Ctrl+V
      if (isMeta && e.key === 'v') {
        e.preventDefault();
        if (clipboard && clipboard.length > 0) {
          clipboard[0].clone().then((cloned: fabric.FabricObject) => {
            cloned.set({
              left: (cloned.left || 0) + 20,
              top: (cloned.top || 0) + 20,
            });
            if (cloned instanceof fabric.ActiveSelection) {
              cloned.forEachObject((obj: fabric.FabricObject) => canvas.add(obj));
            } else {
              canvas.add(cloned);
            }
            canvas.setActiveObject(cloned);
            canvas.requestRenderAll();
            pushHistory();
            // Update clipboard offset
            setClipboard([cloned]);
          });
        }
        return;
      }

      // Duplicate: Ctrl+D
      if (isMeta && e.key === 'd') {
        e.preventDefault();
        const active = canvas.getActiveObject();
        if (active) {
          active.clone().then((cloned: fabric.FabricObject) => {
            cloned.set({
              left: (cloned.left || 0) + 20,
              top: (cloned.top || 0) + 20,
            });
            if (cloned instanceof fabric.ActiveSelection) {
              cloned.forEachObject((obj: fabric.FabricObject) => canvas.add(obj));
            } else {
              canvas.add(cloned);
            }
            canvas.setActiveObject(cloned);
            canvas.requestRenderAll();
            pushHistory();
          });
        }
        return;
      }

      // Group: Ctrl+G
      if (isMeta && !e.shiftKey && e.key === 'g') {
        e.preventDefault();
        const active = canvas.getActiveObject();
        if (active && active instanceof fabric.ActiveSelection) {
          const objects = active.getObjects();
          canvas.discardActiveObject();
          const group = new fabric.Group(objects);
          objects.forEach((obj) => canvas.remove(obj));
          canvas.add(group);
          canvas.setActiveObject(group);
          canvas.requestRenderAll();
          pushHistory();
        }
        return;
      }

      // Ungroup: Ctrl+Shift+G
      if (isMeta && e.shiftKey && e.key === 'G') {
        e.preventDefault();
        const active = canvas.getActiveObject();
        if (active && active instanceof fabric.Group) {
          const items = [...active.getObjects()];
          active.remove(...items);
          canvas.remove(active);
          const sel: fabric.FabricObject[] = [];
          items.forEach((item) => {
            canvas.add(item);
            sel.push(item);
          });
          const selection = new fabric.ActiveSelection(sel, { canvas });
          canvas.setActiveObject(selection);
          canvas.requestRenderAll();
          pushHistory();
        }
        return;
      }

      // Delete
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const active = canvas.getActiveObjects();
        if (active.length > 0) {
          active.forEach((obj) => canvas.remove(obj));
          canvas.discardActiveObject();
          canvas.requestRenderAll();
          pushHistory();
        }
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
            active.set({ top: (active.top || 0) - step });
            break;
          case 'ArrowDown':
            active.set({ top: (active.top || 0) + step });
            break;
          case 'ArrowLeft':
            active.set({ left: (active.left || 0) - step });
            break;
          case 'ArrowRight':
            active.set({ left: (active.left || 0) + step });
            break;
        }
        active.setCoords();
        canvas.requestRenderAll();
        pushHistory();
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
