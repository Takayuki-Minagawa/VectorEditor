import { useRef } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import type { DocumentData } from '../types';

export default function Toolbar() {
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const handleSaveJSON = () => {
    if (!canvas) return;
    const data: DocumentData = {
      documentId: `doc_${Date.now()}`,
      canvas: { width: canvasWidth, height: canvasHeight, backgroundColor },
      objects: JSON.stringify(canvas.toJSON(['id', 'name', 'selectable', 'evented'])),
      version: 1,
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
        const { setCanvasSize, setBackgroundColor } = useEditorStore.getState();
        setCanvasSize(data.canvas.width, data.canvas.height);
        setBackgroundColor(data.canvas.backgroundColor);
        const json = JSON.parse(data.objects);
        canvas.loadFromJSON(json).then(() => {
          canvas.requestRenderAll();
          pushHistory();
        });
      } catch {
        alert('ファイルの読み込みに失敗しました。');
      }
    };
    reader.readAsText(file);
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

  // Z-order
  const bringForward = () => {
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (obj) {
      canvas.bringObjectForward(obj);
      canvas.requestRenderAll();
      pushHistory();
    }
  };
  const sendBackward = () => {
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (obj) {
      canvas.sendObjectBackwards(obj);
      canvas.requestRenderAll();
      pushHistory();
    }
  };
  const bringToFront = () => {
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (obj) {
      canvas.bringObjectToFront(obj);
      canvas.requestRenderAll();
      pushHistory();
    }
  };
  const sendToBack = () => {
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (obj) {
      canvas.sendObjectToBack(obj);
      canvas.requestRenderAll();
      pushHistory();
    }
  };

  // Alignment
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
          obj.set({ left: (obj.left || 0) + (bound.left - objBound.left) });
          break;
        case 'centerH':
          obj.set({
            left: (obj.left || 0) + (bound.left + bound.width / 2 - (objBound.left + objBound.width / 2)),
          });
          break;
        case 'right':
          obj.set({
            left: (obj.left || 0) + (bound.left + bound.width - (objBound.left + objBound.width)),
          });
          break;
        case 'top':
          obj.set({ top: (obj.top || 0) + (bound.top - objBound.top) });
          break;
        case 'centerV':
          obj.set({
            top: (obj.top || 0) + (bound.top + bound.height / 2 - (objBound.top + objBound.height / 2)),
          });
          break;
        case 'bottom':
          obj.set({
            top: (obj.top || 0) + (bound.top + bound.height - (objBound.top + objBound.height)),
          });
          break;
      }
      obj.setCoords();
    });
    canvas.requestRenderAll();
    pushHistory();
  };

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <span className="toolbar-group-label">ファイル</span>
        <button className="toolbar-btn" onClick={handleSaveJSON} title="JSON保存">
          保存
        </button>
        <button className="toolbar-btn" onClick={handleLoadJSON} title="JSON読込">
          読込
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <span className="toolbar-group-label">編集</span>
        <button className="toolbar-btn" onClick={undo} disabled={historyIndex <= 0} title="元に戻す (Ctrl+Z)">
          戻す
        </button>
        <button
          className="toolbar-btn"
          onClick={redo}
          disabled={historyIndex >= historyLength - 1}
          title="やり直し (Ctrl+Y)"
        >
          やり直し
        </button>
        <button className="toolbar-btn" onClick={handleDuplicate} title="複製 (Ctrl+D)">
          複製
        </button>
        <button className="toolbar-btn" onClick={handleDeleteSelected} title="削除 (Delete)">
          削除
        </button>
        <button className="toolbar-btn" onClick={handleSelectAll} title="全選択 (Ctrl+A)">
          全選択
        </button>
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <span className="toolbar-group-label">配置</span>
        <button className="toolbar-btn" onClick={bringToFront} title="最前面">
          最前面
        </button>
        <button className="toolbar-btn" onClick={bringForward} title="前面">
          前面
        </button>
        <button className="toolbar-btn" onClick={sendBackward} title="背面">
          背面
        </button>
        <button className="toolbar-btn" onClick={sendToBack} title="最背面">
          最背面
        </button>
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <span className="toolbar-group-label">整列</span>
        <button className="toolbar-btn" onClick={() => alignObjects('left')} title="左揃え">
          左
        </button>
        <button className="toolbar-btn" onClick={() => alignObjects('centerH')} title="左右中央">
          中央H
        </button>
        <button className="toolbar-btn" onClick={() => alignObjects('right')} title="右揃え">
          右
        </button>
        <button className="toolbar-btn" onClick={() => alignObjects('top')} title="上揃え">
          上
        </button>
        <button className="toolbar-btn" onClick={() => alignObjects('centerV')} title="上下中央">
          中央V
        </button>
        <button className="toolbar-btn" onClick={() => alignObjects('bottom')} title="下揃え">
          下
        </button>
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <span className="toolbar-group-label">表示</span>
        <button className={`toolbar-btn ${gridVisible ? 'active' : ''}`} onClick={toggleGrid}>
          グリッド
        </button>
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <span className="toolbar-group-label">書き出し</span>
        <button className="toolbar-btn" onClick={handleExportSVG} title="SVG書き出し">
          SVG
        </button>
        <button className="toolbar-btn" onClick={handleExportPNG} title="PNG書き出し">
          PNG
        </button>
      </div>
    </div>
  );
}
