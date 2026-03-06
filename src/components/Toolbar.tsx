import { useRef, useState } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import type { DocumentData } from '../types';
import { ensureObjectIdsRecursive, reassignObjectIdsRecursive } from '../utils/objectIds';
import NumericMoveDialog from './NumericMoveDialog';
import CadExportDialog from './CadExportDialog';

export default function Toolbar() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [showNumericMove, setShowNumericMove] = useState(false);
  const [showCadExport, setShowCadExport] = useState(false);
  const canvas = useEditorStore((s) => s.canvas);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const historyIndex = useEditorStore((s) => s.historyIndex);
  const historyLength = useEditorStore((s) => s.history.length);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const backgroundColor = useEditorStore((s) => s.backgroundColor);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  const gridVisible = useEditorStore((s) => s.gridVisible);
  const toggleGrid = useEditorStore((s) => s.toggleGrid);
  const t = useI18n((s) => s.t);

  const drawingMode = useEditorStore((s) => s.drawingMode);
  const cadUnit = useEditorStore((s) => s.cadUnit);
  const scale = useEditorStore((s) => s.scale);

  const cadWidth = useEditorStore((s) => s.cadWidth);
  const cadHeight = useEditorStore((s) => s.cadHeight);

  const handleSaveJSON = () => {
    if (!canvas) return;
    const data: DocumentData = {
      documentId: `doc_${Date.now()}`,
      canvas: { width: canvasWidth, height: canvasHeight, backgroundColor },
      objects: JSON.stringify(canvas.toObject(['id', 'name', 'selectable', 'evented'])),
      version: 1,
      drawingMode,
      cadUnit,
      scale,
      cadWidth,
      cadHeight,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vector-drawing.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoadJSON = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !canvas) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data: DocumentData = JSON.parse(ev.target?.result as string);
        const { setCanvasSize, setBackgroundColor, setDrawingMode, setCadUnit, setScale, setCadSize } = useEditorStore.getState();
        setCanvasSize(data.canvas.width, data.canvas.height);
        setBackgroundColor(data.canvas.backgroundColor);
        if (data.drawingMode) setDrawingMode(data.drawingMode);
        if (data.cadUnit) setCadUnit(data.cadUnit);
        if (data.scale) setScale(data.scale);
        if (data.cadWidth && data.cadHeight) setCadSize(data.cadWidth, data.cadHeight);
        const json = JSON.parse(data.objects);
        canvas.loadFromJSON(json).then(() => {
          canvas.getObjects().forEach((obj) => ensureObjectIdsRecursive(obj));
          canvas.requestRenderAll();
          pushHistory();
        });
      } catch {
        alert(t('loadError'));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleImport = () => {
    importInputRef.current?.click();
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !canvas) return;
    const reader = new FileReader();
    const isSvg = file.type === 'image/svg+xml' || file.name.endsWith('.svg');

    reader.onload = (ev) => {
      try {
        const result = ev.target?.result as string;
        if (isSvg) {
          // Import SVG as editable objects
          fabric.loadSVGFromString(result).then((loaded) => {
            const objects = loaded.objects.filter(Boolean) as fabric.FabricObject[];
            if (objects.length === 0) return;
            let obj: fabric.FabricObject;
            if (objects.length === 1) {
              obj = objects[0];
            } else {
              obj = new fabric.Group(objects);
            }
            ensureObjectIdsRecursive(obj);
            canvas.add(obj);
            canvas.setActiveObject(obj);
            canvas.requestRenderAll();
            pushHistory();
          });
        } else {
          // Import raster image
          fabric.Image.fromURL(result).then((img) => {
            ensureObjectIdsRecursive(img);
            // Scale down if larger than canvas
            const maxW = canvas.width || 800;
            const maxH = canvas.height || 600;
            const imgW = img.width || 100;
            const imgH = img.height || 100;
            const scale = Math.min(1, maxW * 0.8 / imgW, maxH * 0.8 / imgH);
            if (scale < 1) {
              img.set({ scaleX: scale, scaleY: scale });
            }
            canvas.add(img);
            canvas.setActiveObject(img);
            canvas.requestRenderAll();
            pushHistory();
          });
        }
      } catch {
        alert(t('importError'));
      }
    };

    if (isSvg) {
      reader.readAsText(file);
    } else {
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const handleExportSVG = () => {
    if (!canvas) return;
    const svg = canvas.toSVG();
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vector-drawing.svg';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPNG = () => {
    if (!canvas) return;
    const dataUrl = canvas.toDataURL({
      format: 'png',
      multiplier: 2,
    });
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'vector-drawing.png';
    a.click();
  };

  const handleExportPDF = async () => {
    if (!canvas) return;
    const { jsPDF } = await import('jspdf');
    await import('svg2pdf.js');

    const svgStr = canvas.toSVG();
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgStr, 'image/svg+xml');
    const svgEl = svgDoc.documentElement;

    const w = canvasWidth;
    const h = canvasHeight;
    const orientation = w >= h ? 'landscape' : 'portrait';
    const pdf = new jsPDF({
      orientation,
      unit: 'px',
      format: [w, h],
      hotfixes: ['px_scaling'],
    });

    await pdf.svg(svgEl, { x: 0, y: 0, width: w, height: h });
    pdf.save('vector-drawing.pdf');
  };

  const handleDeleteSelected = () => {
    if (!canvas) return;
    const active = canvas.getActiveObjects();
    if (active.length === 0) return;
    active.forEach((obj) => canvas.remove(obj));
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    pushHistory();
  };

  const handleSelectAll = () => {
    if (!canvas) return;
    canvas.discardActiveObject();
    const objects = canvas.getObjects();
    if (objects.length === 0) return;
    const selection = new fabric.ActiveSelection(objects, { canvas });
    canvas.setActiveObject(selection);
    canvas.requestRenderAll();
  };

  const handleDuplicate = () => {
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active) return;
    active.clone().then((cloned: fabric.FabricObject) => {
      reassignObjectIdsRecursive(cloned);
      cloned.set({ left: (cloned.left || 0) + 20, top: (cloned.top || 0) + 20 });
      if (cloned instanceof fabric.ActiveSelection) {
        cloned.forEachObject((obj: fabric.FabricObject) => {
          canvas.add(obj);
        });
        cloned.setCoords();
      } else {
        canvas.add(cloned);
      }
      canvas.setActiveObject(cloned);
      canvas.requestRenderAll();
      pushHistory();
    });
  };

  const bringForward = () => {
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (obj) { canvas.bringObjectForward(obj); canvas.requestRenderAll(); pushHistory(); }
  };
  const sendBackward = () => {
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (obj) { canvas.sendObjectBackwards(obj); canvas.requestRenderAll(); pushHistory(); }
  };
  const bringToFront = () => {
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (obj) { canvas.bringObjectToFront(obj); canvas.requestRenderAll(); pushHistory(); }
  };
  const sendToBack = () => {
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (obj) { canvas.sendObjectToBack(obj); canvas.requestRenderAll(); pushHistory(); }
  };

  const alignObjects = (alignment: string) => {
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
        <span className="toolbar-group-label">{t('edit')}</span>
        <button className="toolbar-btn" onClick={undo} disabled={historyIndex <= 0} title={t('tip_undo')}>{t('undo')}</button>
        <button className="toolbar-btn" onClick={redo} disabled={historyIndex >= historyLength - 1} title={t('tip_redo')}>{t('redo')}</button>
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
        {drawingMode === 'cad' ? (
          <button className="toolbar-btn" onClick={() => setShowCadExport(true)} title={t('cadExport')}>{t('cadExport')}</button>
        ) : (
          <>
            <button className="toolbar-btn" onClick={handleExportSVG} title={t('tip_svg')}>{t('svg')}</button>
            <button className="toolbar-btn" onClick={handleExportPNG} title={t('tip_png')}>{t('png')}</button>
            <button className="toolbar-btn" onClick={handleExportPDF} title={t('tip_pdf')}>{t('pdf')}</button>
          </>
        )}
      </div>
      {showNumericMove && (
        <NumericMoveDialog onClose={() => setShowNumericMove(false)} />
      )}
      {showCadExport && (
        <CadExportDialog onClose={() => setShowCadExport(false)} />
      )}
    </div>
  );
}
