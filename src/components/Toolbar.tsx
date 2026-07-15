import { useEffect, useRef, useState } from 'react';
import * as fabric from 'fabric';
import { captureCurrentEditorSnapshot, useEditorStore } from '../store/useEditorStore';
import { useUiStore } from '../store/useUiStore';
import { useI18n } from '../i18n/useI18n';
import { reassignObjectIdsRecursive } from '../utils/objectIds';
import {
  createAsyncCanvasMutationGuard,
  deleteSelected,
  duplicateActive,
  selectAll,
  stackActive,
} from '../utils/canvasCommands';
import {
  createDocumentData,
  isDocumentRestoreSupersededError,
  parseDocumentData,
  restoreDocumentData,
} from '../utils/documentSerializer';
import NumericMoveDialog from './NumericMoveDialog';
import ExportDialog from './ExportDialog';
import { updateLinkedSemanticObjects } from '../utils/semanticObjects';
import { OPEN_SECTION_OPERATIONS_EVENT } from '../utils/sectionUiEvents';
import SectionOperationsDialog from './SectionOperationsDialog';

type Alignment = 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

export default function Toolbar() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [showNumericMove, setShowNumericMove] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showSectionOperations, setShowSectionOperations] = useState(false);
  const canvas = useEditorStore((s) => s.canvas);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const historyIndex = useEditorStore((s) => s.historyIndex);
  const historyLength = useEditorStore((s) => s.history.length);
  const isRestoring = useEditorStore((s) => s.isRestoring);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const backgroundColor = useEditorStore((s) => s.backgroundColor);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  const gridVisible = useEditorStore((s) => s.gridVisible);
  const toggleGrid = useEditorStore((s) => s.toggleGrid);
  const showToast = useEditorStore((s) => s.showToast);
  const t = useI18n((s) => s.t);

  const drawingMode = useEditorStore((s) => s.drawingMode);
  const cadUnit = useEditorStore((s) => s.cadUnit);
  const scale = useEditorStore((s) => s.scale);

  const cadWidth = useEditorStore((s) => s.cadWidth);
  const cadHeight = useEditorStore((s) => s.cadHeight);

  useEffect(() => {
    const openSectionDialog = () => setShowSectionOperations(true);
    window.addEventListener(OPEN_SECTION_OPERATIONS_EVENT, openSectionDialog);
    return () => window.removeEventListener(OPEN_SECTION_OPERATIONS_EVENT, openSectionDialog);
  }, []);

  const handleSaveJSON = () => {
    if (!canvas) return;
    const state = useEditorStore.getState();
    const data = createDocumentData({
      canvas,
      canvasWidth,
      canvasHeight,
      backgroundColor,
      drawingMode,
      cadUnit,
      scale,
      cadWidth,
      cadHeight,
      gridVisible: state.gridVisible,
      gridSize: state.gridSize,
      snapToGrid: state.snapToGrid,
      snapToObjects: state.snapToObjects,
      showRulers: state.showRulers,
      guides: state.guides,
      snapToGuides: state.snapToGuides,
      orthoMode: state.orthoMode,
    });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vector-drawing.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast(t('saveDone'), 'success');
  };

  const handleLoadJSON = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !canvas) return;
    // File reads can take long enough for another history/document restore to
    // win ownership. Normal edits remain allowed; their latest state is
    // captured only after parsing, immediately before restore begins.
    const canStartRestore = createAsyncCanvasMutationGuard(canvas);
    try {
      const data = parseDocumentData(await file.text());
      if (!canStartRestore()) return;
      const rollbackSnapshot = captureCurrentEditorSnapshot() ?? undefined;
      const {
        setCanvasSize,
        setBackgroundColor,
        setDrawingMode,
        setCadUnit,
        setScale,
        setCadSize,
        restoreEditorSettings,
      } = useEditorStore.getState();
      // No await belongs between the ownership check / rollback capture and
      // this call: restoreDocumentData claims the HistoryService generation
      // synchronously before its first suspension point.
      await restoreDocumentData(canvas, data, {
        setCanvasSize,
        setBackgroundColor,
        setDrawingMode,
        setCadUnit,
        setScale,
        setCadSize,
        restoreEditorSettings,
      }, {
        rollbackSnapshot,
      });
      useUiStore.getState().setCurrentProjectId(null);
      pushHistory();
      showToast(t('loadDone'), 'success');
    } catch (error: unknown) {
      if (isDocumentRestoreSupersededError(error)) return;
      showToast(t('loadError'), 'error');
    }
  };

  const handleImport = () => {
    importInputRef.current?.click();
  };

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !canvas) return;
    const isSvg = file.type === 'image/svg+xml' || file.name.endsWith('.svg');
    const canCommit = createAsyncCanvasMutationGuard(canvas);

    try {
      if (isSvg) {
        const loaded = await fabric.loadSVGFromString(await file.text());
        const objects = loaded.objects.filter(Boolean) as fabric.FabricObject[];
        if (!canCommit()) {
          objects.forEach((object) => object.dispose());
          return;
        }
        if (objects.length === 0) throw new Error('SVG has no exportable objects.');
        const object = objects.length === 1 ? objects[0] : new fabric.Group(objects);
        // SVG element ids are author-controlled and commonly repeat when the
        // same asset is imported more than once. Always allocate document ids.
        reassignObjectIdsRecursive(object);
        canvas.add(object);
        canvas.setActiveObject(object);
      } else {
        const image = await fabric.Image.fromURL(await readFileAsDataUrl(file));
        if (!canCommit()) {
          image.dispose();
          return;
        }
        reassignObjectIdsRecursive(image);
        const maxWidth = canvas.width || 800;
        const maxHeight = canvas.height || 600;
        const imageWidth = image.width || 100;
        const imageHeight = image.height || 100;
        const imageScale = Math.min(
          1,
          maxWidth * 0.8 / imageWidth,
          maxHeight * 0.8 / imageHeight,
        );
        if (imageScale < 1) {
          image.set({ scaleX: imageScale, scaleY: imageScale });
        }
        canvas.add(image);
        canvas.setActiveObject(image);
      }
      canvas.requestRenderAll();
      pushHistory();
    } catch {
      showToast(t('importError'), 'error');
    }
  };

  const handleDeleteSelected = () => {
    if (!canvas) return;
    deleteSelected(canvas, pushHistory);
  };

  const handleSelectAll = () => {
    if (!canvas) return;
    selectAll(canvas);
  };

  const handleDuplicate = () => {
    if (!canvas) return;
    duplicateActive(canvas, pushHistory);
  };

  const bringForward = () => {
    if (!canvas) return;
    stackActive(canvas, 'bringForward', pushHistory);
  };
  const sendBackward = () => {
    if (!canvas) return;
    stackActive(canvas, 'sendBackward', pushHistory);
  };
  const bringToFront = () => {
    if (!canvas) return;
    stackActive(canvas, 'bringToFront', pushHistory);
  };
  const sendToBack = () => {
    if (!canvas) return;
    stackActive(canvas, 'sendToBack', pushHistory);
  };

  const alignObjects = (alignment: Alignment) => {
    if (!canvas) return;
    const activeObj = canvas.getActiveObject();
    if (!activeObj || !(activeObj instanceof fabric.ActiveSelection)) return;
    const objects = activeObj.getObjects();
    if (objects.length < 2) return;
    const bound = activeObj.getBoundingRect();
    objects.forEach((obj) => {
      const objBound = obj.getBoundingRect();
      switch (alignment) {
        case 'left':
          obj.set({ left: (obj.left || 0) + (bound.left - objBound.left) }); break;
        case 'centerH':
          obj.set({ left: (obj.left || 0) + (bound.left + bound.width / 2 - (objBound.left + objBound.width / 2)) }); break;
        case 'right':
          obj.set({ left: (obj.left || 0) + (bound.left + bound.width - (objBound.left + objBound.width)) }); break;
        case 'top':
          obj.set({ top: (obj.top || 0) + (bound.top - objBound.top) }); break;
        case 'centerV':
          obj.set({ top: (obj.top || 0) + (bound.top + bound.height / 2 - (objBound.top + objBound.height / 2)) }); break;
        case 'bottom':
          obj.set({ top: (obj.top || 0) + (bound.top + bound.height - (objBound.top + objBound.height)) }); break;
      }
      obj.setCoords();
    });
    activeObj.setCoords();
    updateLinkedSemanticObjects(canvas);
    canvas.requestRenderAll();
    pushHistory();
  };

  const distributeObjects = (direction: 'horizontal' | 'vertical') => {
    if (!canvas) return;
    const activeObj = canvas.getActiveObject();
    if (!activeObj || !(activeObj instanceof fabric.ActiveSelection)) return;
    const objects = activeObj.getObjects();
    if (objects.length < 3) return;
    const bounds = objects.map((obj) => ({ obj, rect: obj.getBoundingRect() }));
    if (direction === 'horizontal') {
      bounds.sort((a, b) => a.rect.left - b.rect.left);
      const totalWidth = bounds.reduce((sum, b) => sum + b.rect.width, 0);
      const first = bounds[0].rect.left;
      const last = bounds[bounds.length - 1].rect.left + bounds[bounds.length - 1].rect.width;
      const gap = (last - first - totalWidth) / (bounds.length - 1);
      let x = first;
      bounds.forEach((b) => { b.obj.set({ left: (b.obj.left || 0) + (x - b.rect.left) }); b.obj.setCoords(); x += b.rect.width + gap; });
    } else {
      bounds.sort((a, b) => a.rect.top - b.rect.top);
      const totalHeight = bounds.reduce((sum, b) => sum + b.rect.height, 0);
      const first = bounds[0].rect.top;
      const last = bounds[bounds.length - 1].rect.top + bounds[bounds.length - 1].rect.height;
      const gap = (last - first - totalHeight) / (bounds.length - 1);
      let y = first;
      bounds.forEach((b) => { b.obj.set({ top: (b.obj.top || 0) + (y - b.rect.top) }); b.obj.setCoords(); y += b.rect.height + gap; });
    }
    activeObj.setCoords();
    updateLinkedSemanticObjects(canvas);
    canvas.requestRenderAll();
    pushHistory();
  };

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <span className="toolbar-group-label">{t('file')}</span>
        <button className="toolbar-btn" onClick={handleSaveJSON} title={t('tip_save')}>{t('save')}</button>
        <button className="toolbar-btn" onClick={handleLoadJSON} title={t('tip_load')}>{t('load')}</button>
        <button className="toolbar-btn" onClick={handleImport} title={t('tip_import')}>{t('import')}</button>
        <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileChange} />
        <input ref={importInputRef} type="file" accept=".svg,.png,.jpg,.jpeg,.gif,.webp" style={{ display: 'none' }} onChange={handleImportFileChange} />
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <span className="toolbar-group-label">{t('section')}</span>
        <button
          className="toolbar-btn"
          onClick={() => setShowSectionOperations(true)}
          title={t('sectionDialogTitle')}
          disabled={!canvas || drawingMode !== 'cad' || isRestoring}
        >
          {t('section')}
        </button>
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <span className="toolbar-group-label">{t('edit')}</span>
        <button className="toolbar-btn" onClick={undo} disabled={isRestoring || historyIndex <= 0} title={t('tip_undo')}>{t('undo')}</button>
        <button className="toolbar-btn" onClick={redo} disabled={isRestoring || historyIndex >= historyLength - 1} title={t('tip_redo')}>{t('redo')}</button>
        <button className="toolbar-btn" onClick={handleDuplicate} title={t('tip_duplicate')}>{t('duplicate')}</button>
        <button className="toolbar-btn" onClick={handleDeleteSelected} title={t('tip_delete')}>{t('delete')}</button>
        <button className="toolbar-btn" onClick={handleSelectAll} title={t('tip_selectAll')}>{t('selectAll')}</button>
        <button className="toolbar-btn" onClick={() => setShowNumericMove(true)} title={t('tip_numericMove')}>{t('numericMove')}</button>
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <span className="toolbar-group-label">{t('arrange')}</span>
        <button className="toolbar-btn" onClick={bringToFront} title={t('tip_toFront')}>{t('toFront')}</button>
        <button className="toolbar-btn" onClick={bringForward} title={t('tip_forward')}>{t('forward')}</button>
        <button className="toolbar-btn" onClick={sendBackward} title={t('tip_backward')}>{t('backward')}</button>
        <button className="toolbar-btn" onClick={sendToBack} title={t('tip_toBack')}>{t('toBack')}</button>
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <span className="toolbar-group-label">{t('align')}</span>
        <button className="toolbar-btn" onClick={() => alignObjects('left')} title={t('tip_alignLeft')}>{t('alignLeft')}</button>
        <button className="toolbar-btn" onClick={() => alignObjects('centerH')} title={t('tip_alignCenterH')}>{t('alignCenterH')}</button>
        <button className="toolbar-btn" onClick={() => alignObjects('right')} title={t('tip_alignRight')}>{t('alignRight')}</button>
        <button className="toolbar-btn" onClick={() => alignObjects('top')} title={t('tip_alignTop')}>{t('alignTop')}</button>
        <button className="toolbar-btn" onClick={() => alignObjects('centerV')} title={t('tip_alignCenterV')}>{t('alignCenterV')}</button>
        <button className="toolbar-btn" onClick={() => alignObjects('bottom')} title={t('tip_alignBottom')}>{t('alignBottom')}</button>
        <button className="toolbar-btn" onClick={() => distributeObjects('horizontal')} title={t('tip_distributeH')}>{t('distributeH')}</button>
        <button className="toolbar-btn" onClick={() => distributeObjects('vertical')} title={t('tip_distributeV')}>{t('distributeV')}</button>
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <span className="toolbar-group-label">{t('view')}</span>
        <button className={`toolbar-btn ${gridVisible ? 'active' : ''}`} onClick={toggleGrid}>{t('grid')}</button>
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <span className="toolbar-group-label">{t('export')}</span>
        <button
          className="toolbar-btn"
          onClick={() => setShowExport(true)}
          title={t('exportDialogTitle')}
        >
          {t('cadExportBtn')}
        </button>
      </div>
      {showNumericMove && (
        <NumericMoveDialog onClose={() => setShowNumericMove(false)} />
      )}
      {showExport && (
        <ExportDialog onClose={() => setShowExport(false)} />
      )}
      {showSectionOperations && (
        <SectionOperationsDialog onClose={() => setShowSectionOperations(false)} />
      )}
    </div>
  );
}
