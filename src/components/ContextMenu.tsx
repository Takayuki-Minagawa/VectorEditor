import { useEffect, useState, useCallback } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';

interface MenuPos { x: number; y: number; }

export default function ContextMenu() {
  const [pos, setPos] = useState<MenuPos | null>(null);
  const canvas = useEditorStore((s) => s.canvas);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  const setClipboard = useEditorStore((s) => s.setClipboard);
  const clipboard = useEditorStore((s) => s.clipboard);
  const t = useI18n((s) => s.t);

  const close = useCallback(() => setPos(null), []);

  useEffect(() => {
    if (!canvas) return;
    canvas.upperCanvasEl.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.on('mouse:down:before', (opt) => {
      const me = opt.e as MouseEvent;
      if (me.button !== 2) close();
    });
    canvas.on('mouse:up', (opt) => {
      const me = opt.e as MouseEvent;
      if (me.button === 2) setPos({ x: me.clientX, y: me.clientY });
    });
    return () => { canvas.off('mouse:down:before'); canvas.off('mouse:up'); };
  }, [canvas, close]);

  useEffect(() => {
    if (pos) {
      const handler = () => close();
      window.addEventListener('click', handler);
      window.addEventListener('keydown', handler);
      return () => { window.removeEventListener('click', handler); window.removeEventListener('keydown', handler); };
    }
  }, [pos, close]);

  if (!pos || !canvas) return null;

  const active = canvas.getActiveObject();
  const hasSelection = !!active;
  const isGroup = active instanceof fabric.Group;
  const isMultiple = active instanceof fabric.ActiveSelection;

  const exec = (fn: () => void) => { fn(); close(); };

  const handleCopy = () => exec(() => {
    if (active) active.clone().then((c: fabric.FabricObject) => setClipboard([c]));
  });
  const handlePaste = () => exec(() => {
    if (!clipboard || clipboard.length === 0) return;
    clipboard[0].clone().then((cloned: fabric.FabricObject) => {
      cloned.set({ left: (cloned.left || 0) + 20, top: (cloned.top || 0) + 20 });
      if (cloned instanceof fabric.ActiveSelection) cloned.forEachObject((obj: fabric.FabricObject) => canvas.add(obj));
      else canvas.add(cloned);
      canvas.setActiveObject(cloned); canvas.requestRenderAll(); pushHistory(); setClipboard([cloned]);
    });
  });
  const handleDuplicate = () => exec(() => {
    if (!active) return;
    active.clone().then((cloned: fabric.FabricObject) => {
      cloned.set({ left: (cloned.left || 0) + 20, top: (cloned.top || 0) + 20 });
      if (cloned instanceof fabric.ActiveSelection) cloned.forEachObject((obj: fabric.FabricObject) => canvas.add(obj));
      else canvas.add(cloned);
      canvas.setActiveObject(cloned); canvas.requestRenderAll(); pushHistory();
    });
  });
  const handleDelete = () => exec(() => {
    canvas.getActiveObjects().forEach((o) => canvas.remove(o));
    canvas.discardActiveObject(); canvas.requestRenderAll(); pushHistory();
  });
  const handleGroup = () => exec(() => {
    if (!isMultiple) return;
    const objects = (active as fabric.ActiveSelection).getObjects();
    canvas.discardActiveObject();
    const group = new fabric.Group(objects);
    objects.forEach((o) => canvas.remove(o));
    canvas.add(group); canvas.setActiveObject(group); canvas.requestRenderAll(); pushHistory();
  });
  const handleUngroup = () => exec(() => {
    if (!isGroup) return;
    const items = (active as fabric.Group).getObjects();
    const group = active as fabric.Group;
    group.remove(...items);
    canvas.remove(active);
    const sel: fabric.FabricObject[] = [];
    items.forEach((item) => { canvas.add(item); sel.push(item); });
    canvas.setActiveObject(new fabric.ActiveSelection(sel, { canvas }));
    canvas.requestRenderAll(); pushHistory();
  });
  const handleBringToFront = () => exec(() => { if (active) { canvas.bringObjectToFront(active); canvas.requestRenderAll(); pushHistory(); } });
  const handleSendToBack = () => exec(() => { if (active) { canvas.sendObjectToBack(active); canvas.requestRenderAll(); pushHistory(); } });
  const handleBringForward = () => exec(() => { if (active) { canvas.bringObjectForward(active); canvas.requestRenderAll(); pushHistory(); } });
  const handleSendBackward = () => exec(() => { if (active) { canvas.sendObjectBackwards(active); canvas.requestRenderAll(); pushHistory(); } });
  const handleLock = () => exec(() => {
    if (!active) return;
    const locked = !active.lockMovementX;
    active.set({ lockMovementX: locked, lockMovementY: locked, lockScalingX: locked, lockScalingY: locked, lockRotation: locked, hasControls: !locked });
    canvas.requestRenderAll();
  });

  return (
    <div className="context-menu" style={{ left: pos.x, top: pos.y }} onClick={(e) => e.stopPropagation()}>
      {hasSelection ? (
        <>
          <button className="context-item" onClick={handleCopy}>{t('ctx_copy')}</button>
          <button className="context-item" onClick={handleDuplicate}>{t('ctx_duplicate')}</button>
          <div className="context-divider" />
          <button className="context-item" onClick={handleBringToFront}>{t('ctx_toFront')}</button>
          <button className="context-item" onClick={handleBringForward}>{t('ctx_forward')}</button>
          <button className="context-item" onClick={handleSendBackward}>{t('ctx_backward')}</button>
          <button className="context-item" onClick={handleSendToBack}>{t('ctx_toBack')}</button>
          <div className="context-divider" />
          {isMultiple && <button className="context-item" onClick={handleGroup}>{t('ctx_group')}</button>}
          {isGroup && <button className="context-item" onClick={handleUngroup}>{t('ctx_ungroup')}</button>}
          <button className="context-item" onClick={handleLock}>{active.lockMovementX ? t('ctx_unlock') : t('ctx_lock')}</button>
          <div className="context-divider" />
          <button className="context-item danger" onClick={handleDelete}>{t('ctx_delete')}</button>
        </>
      ) : (
        <button className="context-item" onClick={handlePaste} disabled={!clipboard}>{t('ctx_paste')}</button>
      )}
    </div>
  );
}
