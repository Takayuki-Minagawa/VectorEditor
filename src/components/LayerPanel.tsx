import { useEffect, useState, useCallback } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import { ensureObjectId } from '../utils/objectIds';

interface LayerItem {
  id: string;
  label: string;
  visible: boolean;
  locked: boolean;
  object: fabric.FabricObject;
}

export default function LayerPanel() {
  const canvas = useEditorStore((s) => s.canvas);
  const selectedObjectIds = useEditorStore((s) => s.selectedObjectIds);
  const t = useI18n((s) => s.t);
  const [layers, setLayers] = useState<LayerItem[]>([]);

  const refreshLayers = useCallback(() => {
    if (!canvas) return;
    const objects = canvas.getObjects();
    const items: LayerItem[] = objects.map((obj) => {
      const objId = ensureObjectId(obj);
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
        id: objId,
        label,
        visible: obj.visible !== false,
        locked: !!obj.lockMovementX,
        object: obj,
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

  const selectObject = (obj: fabric.FabricObject) => {
    if (!canvas) return;
    canvas.discardActiveObject();
    canvas.setActiveObject(obj);
    canvas.requestRenderAll();
  };

  const toggleVisibility = (obj: fabric.FabricObject) => {
    if (!canvas) return;
    obj.set({ visible: !obj.visible });
    canvas.requestRenderAll();
    refreshLayers();
  };

  const toggleLock = (obj: fabric.FabricObject) => {
    if (!canvas) return;
    const locked = !obj.lockMovementX;
    obj.set({ lockMovementX: locked, lockMovementY: locked, lockScalingX: locked, lockScalingY: locked, lockRotation: locked, hasControls: !locked });
    canvas.requestRenderAll();
    refreshLayers();
  };

  return (
    <div className="layer-panel">
      <div className="prop-section-title">{t('layers')}</div>
      {layers.length === 0 && <div className="layer-empty">{t('noObjects')}</div>}
      <div className="layer-list">
        {layers.map((layer, index) => (
          <div
            key={`${layer.id}_${index}`}
            className={`layer-item ${selectedObjectIds.includes(layer.id) ? 'selected' : ''}`}
            onClick={() => selectObject(layer.object)}
          >
            <span className="layer-label">{layer.label}</span>
            <div className="layer-actions">
              <button
                className={`layer-action-btn ${!layer.visible ? 'off' : ''}`}
                onClick={(e) => { e.stopPropagation(); toggleVisibility(layer.object); }}
                title={layer.visible ? t('hide') : t('show')}
              >
                {layer.visible ? '👁' : '−'}
              </button>
              <button
                className={`layer-action-btn ${layer.locked ? 'on' : ''}`}
                onClick={(e) => { e.stopPropagation(); toggleLock(layer.object); }}
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
