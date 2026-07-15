import { useEffect, useState, useCallback } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import { disposeAll } from '../utils/disposers';
import {
  copyActive,
  deleteSelected,
  duplicateActive,
  flipActive,
  groupSelection,
  pasteClipboard,
  stackActive,
  toggleActiveLock,
  ungroupActive,
} from '../utils/canvasCommands';
import {
  createSectionFromSelection,
  subtractSelectionFromSection,
  unionSelectionAsSection,
} from '../utils/sectionCommands';
import { isSupportedSectionSourceObject } from '../utils/sectionGeometry';
import { openSectionOperations } from '../utils/sectionUiEvents';

interface MenuPos { x: number; y: number; }

export default function ContextMenu() {
  const [pos, setPos] = useState<MenuPos | null>(null);
  const canvas = useEditorStore((s) => s.canvas);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  const setClipboard = useEditorStore((s) => s.setClipboard);
  const clipboard = useEditorStore((s) => s.clipboard);
  const t = useI18n((s) => s.t);
  const drawingMode = useEditorStore((s) => s.drawingMode);
  const showToast = useEditorStore((s) => s.showToast);

  const close = useCallback(() => setPos(null), []);

  useEffect(() => {
    if (!canvas) return;
    const preventDefaultContextMenu = (e: MouseEvent) => e.preventDefault();
    const handleMouseDownBefore = (opt: fabric.TPointerEventInfo) => {
      const me = opt.e as MouseEvent;
      if (me.button !== 2) close();
    };
    const handleMouseUp = (opt: fabric.TPointerEventInfo) => {
      const me = opt.e as MouseEvent;
      if (me.button === 2) setPos({ x: me.clientX, y: me.clientY });
    };
    canvas.upperCanvasEl.addEventListener('contextmenu', preventDefaultContextMenu);
    return disposeAll([
      () => canvas.upperCanvasEl.removeEventListener('contextmenu', preventDefaultContextMenu),
      canvas.on('mouse:down:before', handleMouseDownBefore),
      canvas.on('mouse:up', handleMouseUp),
    ]);
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
  const canFillet = !!active && !isMultiple && isSupportedSectionSourceObject(active);

  const exec = (fn: () => void) => { fn(); close(); };

  const handleCopy = () => exec(() => copyActive(canvas, setClipboard));
  const handlePaste = () => exec(() => pasteClipboard(canvas, clipboard, setClipboard, pushHistory));
  const handleDuplicate = () => exec(() => duplicateActive(canvas, pushHistory));
  const handleDelete = () => exec(() => deleteSelected(canvas, pushHistory));
  const handleGroup = () => exec(() => groupSelection(canvas, pushHistory));
  const handleUngroup = () => exec(() => ungroupActive(canvas, pushHistory));
  const handleFlipH = () => exec(() => flipActive(canvas, 'x', pushHistory));
  const handleFlipV = () => exec(() => flipActive(canvas, 'y', pushHistory));
  const handleBringToFront = () => exec(() => stackActive(canvas, 'bringToFront', pushHistory));
  const handleSendToBack = () => exec(() => stackActive(canvas, 'sendToBack', pushHistory));
  const handleBringForward = () => exec(() => stackActive(canvas, 'bringForward', pushHistory));
  const handleSendBackward = () => exec(() => stackActive(canvas, 'sendBackward', pushHistory));
  const handleLock = () => exec(() => toggleActiveLock(canvas));
  const runSectionOperation = (operation: () => void) => exec(() => {
    try {
      operation();
      showToast(t('sectionOperationDone'), 'success');
    } catch (caught: unknown) {
      showToast(caught instanceof Error ? caught.message : t('sectionOperationFailed'), 'error');
    }
  });
  const handleSectionCreate = () => runSectionOperation(
    () => createSectionFromSelection(canvas, pushHistory),
  );
  const handleSectionSubtract = () => runSectionOperation(
    () => subtractSelectionFromSection(canvas, pushHistory),
  );
  const handleSectionUnion = () => runSectionOperation(
    () => unionSelectionAsSection(canvas, pushHistory),
  );
  const handleSectionFillet = () => exec(openSectionOperations);

  return (
    <div className="context-menu" style={{ left: pos.x, top: pos.y }} onClick={(e) => e.stopPropagation()}>
      {hasSelection ? (
        <>
          <button className="context-item" onClick={handleCopy}>{t('ctx_copy')}</button>
          <button className="context-item" onClick={handleDuplicate}>{t('ctx_duplicate')}</button>
          <div className="context-divider" />
          <button className="context-item" onClick={handleFlipH}>{t('ctx_flipH')}</button>
          <button className="context-item" onClick={handleFlipV}>{t('ctx_flipV')}</button>
          <div className="context-divider" />
          <button className="context-item" onClick={handleBringToFront}>{t('ctx_toFront')}</button>
          <button className="context-item" onClick={handleBringForward}>{t('ctx_forward')}</button>
          <button className="context-item" onClick={handleSendBackward}>{t('ctx_backward')}</button>
          <button className="context-item" onClick={handleSendToBack}>{t('ctx_toBack')}</button>
          <div className="context-divider" />
          {isMultiple && <button className="context-item" onClick={handleGroup}>{t('ctx_group')}</button>}
          {isGroup && <button className="context-item" onClick={handleUngroup}>{t('ctx_ungroup')}</button>}
          <button className="context-item" onClick={handleLock}>{active.lockMovementX ? t('ctx_unlock') : t('ctx_lock')}</button>
          {drawingMode === 'cad' && (
            <>
              <div className="context-divider" />
              <button className="context-item" onClick={handleSectionCreate}>{t('ctx_sectionCreate')}</button>
              {isMultiple && <button className="context-item" onClick={handleSectionUnion}>{t('ctx_sectionUnion')}</button>}
              {isMultiple && <button className="context-item" onClick={handleSectionSubtract}>{t('ctx_sectionSubtract')}</button>}
              {canFillet && <button className="context-item" onClick={handleSectionFillet}>{t('ctx_sectionFillet')}</button>}
            </>
          )}
          <div className="context-divider" />
          <button className="context-item danger" onClick={handleDelete}>{t('ctx_delete')}</button>
        </>
      ) : (
        <button className="context-item" onClick={handlePaste} disabled={!clipboard}>{t('ctx_paste')}</button>
      )}
    </div>
  );
}
