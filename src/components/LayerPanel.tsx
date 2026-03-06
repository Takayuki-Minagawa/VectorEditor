import { useEffect, useState, useCallback } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';

interface LayerItem {
  id: string;
  label: string;
  visible: boolean;
  locked: boolean;
}

export default function LayerPanel() {
  const canvas = useEditorStore((s) => s.canvas);
  const selectedObjectIds = useEditorStore((s) => s.selectedObjectIds);
  const t = useI18n((s) => s.t);
  const [layers, setLayers] = useState<LayerItem[]>([]);

  const refreshLayers = useCallback(() => {
    if (!canvas) return;
    const objects = canvas.getObjects();
    const items: LayerItem[] = objects.map((obj, i) => {
      const typed = obj as fabric.FabricObject & { id?: string };
      const objId = typed.id || '';
      let label = obj.type || 'object';
      if (objId.startsWith('latex_')) {
        label = t('layerLatex');
      } else if (obj instanceof fabric.Textbox || obj instanceof fabric.IText) {
        const text = (obj as fabric.Textbox).text || '';
        label = `T: ${text.slice(0, 12)}${text.length > 12 ? '...' : ''}`;
      } else if (obj instanceof fabric.Group) {
        const items = (obj as fabric.Group).getObjects();
        // Detect dimension line (group with line + ticks + text)
        const hasText = items.some((it) => it instanceof fabric.Text);
        const lineCount = items.filter((it) => it instanceof fabric.Line).length;
        if (hasText && lineCount >= 2) {
          label = t('layerDimension');
        } else {
          label = `${t('layerGroup')} (${items.length})`;
        }
      } else if (obj instanceof fabric.Line) { label = t('layerLine');
      } else if (obj instanceof fabric.Rect) {
        if (objId.startsWith('wall_')) label = t('layerWall');
        else if (objId.startsWith('column_')) label = t('layerColumn');
        else label = t('layerRect');
      } else if (obj instanceof fabric.Circle) { label = t('layerCircle');
      } else if (obj instanceof fabric.Ellipse) { label = t('layerEllipse');
      } else if (obj instanceof fabric.Triangle) { label = t('layerTriangle');
      } else if (obj instanceof fabric.Polygon) { label = t('layerPolygon');
      } else if (obj instanceof fabric.Polyline) { label = t('layerPolyline');
      }
      return {
        id: typed.id || `obj_${i}`,
        label,
        visible: obj.visible !== false,
        locked: !!obj.lockMovementX,
      };
    });
    setLayers(items.reverse());
  }, [canvas, t]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- refreshLayers reads external canvas state
  useEffect(() => { refreshLayers(); }, [selectedObjectIds, refreshLayers]);

  useEffect(() => {
    if (!canvas) return;
    const handler = () => refreshLayers();
    canvas.on('object:added', handler);
    canvas.on('object:removed', handler);
    canvas.on('object:modified', handler);
    return () => {
      canvas.off('object:added', handler);
      canvas.off('object:removed', handler);
      canvas.off('object:modified', handler);
    };
  }, [canvas, refreshLayers]);

  const findObj = (id: string) =>
    canvas?.getObjects().find((o) => (o as fabric.FabricObject & { id?: string }).id === id);

  const selectObject = (id: string) => {
    if (!canvas) return;
    const obj = findObj(id);
    if (obj) { canvas.discardActiveObject(); canvas.setActiveObject(obj); canvas.requestRenderAll(); }
  };

  const toggleVisibility = (id: string) => {
    if (!canvas) return;
    const obj = findObj(id);
    if (obj) { obj.set({ visible: !obj.visible }); canvas.requestRenderAll(); }
  };

  const toggleLock = (id: string) => {
    if (!canvas) return;
    const obj = findObj(id);
    if (obj) {
      const locked = !obj.lockMovementX;
      obj.set({ lockMovementX: locked, lockMovementY: locked, lockScalingX: locked, lockScalingY: locked, lockRotation: locked, hasControls: !locked });
      canvas.requestRenderAll(); refreshLayers();
    }
  };

  return (
    <div className="layer-panel">
      <div className="prop-section-title">{t('layers')}</div>
      {layers.length === 0 && <div className="layer-empty">{t('noObjects')}</div>}
      <div className="layer-list">
        {layers.map((layer) => (
          <div
            key={layer.id}
            className={`layer-item ${selectedObjectIds.includes(layer.id) ? 'selected' : ''}`}
            onClick={() => selectObject(layer.id)}
          >
            <span className="layer-label">{layer.label}</span>
            <div className="layer-actions">
              <button
                className={`layer-action-btn ${!layer.visible ? 'off' : ''}`}
                onClick={(e) => { e.stopPropagation(); toggleVisibility(layer.id); }}
                title={layer.visible ? t('hide') : t('show')}
              >
                {layer.visible ? '👁' : '−'}
              </button>
              <button
                className={`layer-action-btn ${layer.locked ? 'on' : ''}`}
                onClick={(e) => { e.stopPropagation(); toggleLock(layer.id); }}
                title={layer.locked ? t('unlock') : t('lock')}
              >
                {layer.locked ? '🔒' : '🔓'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
