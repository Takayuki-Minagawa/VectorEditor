import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent } from 'react';
import * as fabric from 'fabric';
import { ALL_TOOLS } from '../domain/tools';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import { ensureObjectId } from '../utils/objectIds';
import {
  applyPersistentObjectState,
  getFabricMetadata,
  setFabricMetadata,
} from '../utils/fabricObjectMetadata';
import IconButton from './IconButton';

interface LayerItem {
  id: string;
  label: string;
  visible: boolean;
  locked: boolean;
  object: fabric.FabricObject;
  rootObject: fabric.FabricObject;
  children: LayerItem[];
}

function objectFallbackLabel(object: fabric.FabricObject, t: ReturnType<typeof useI18n.getState>['t']): string {
  const { objectKind } = getFabricMetadata(object);
  if (object instanceof fabric.Textbox || object instanceof fabric.IText || object instanceof fabric.Text) {
    const text = object.text || '';
    return `T: ${text.slice(0, 18)}${text.length > 18 ? '…' : ''}`;
  }
  const toolDefinition = ALL_TOOLS.find((tool) => tool.objectKind === objectKind);
  if (toolDefinition) return t(toolDefinition.labelKey);
  if (object instanceof fabric.Group) return `${t('layerGroup')} (${object.getObjects().length})`;
  if (object instanceof fabric.Line) return t('layerLine');
  if (object instanceof fabric.Rect) return t('layerRect');
  if (object instanceof fabric.Circle) return t('layerCircle');
  if (object instanceof fabric.Ellipse) return t('layerEllipse');
  if (object instanceof fabric.Triangle) return t('layerTriangle');
  if (object instanceof fabric.Polygon) return t('layerPolygon');
  if (object instanceof fabric.Polyline) return t('layerPolyline');
  return object.type || 'Object';
}

function toLayerItem(
  object: fabric.FabricObject,
  rootObject: fabric.FabricObject,
  t: ReturnType<typeof useI18n.getState>['t'],
): LayerItem {
  const id = ensureObjectId(object);
  const metadata = getFabricMetadata(object);
  const children = object instanceof fabric.Group
    ? object.getObjects().map((child) => toLayerItem(child, rootObject, t)).reverse()
    : [];
  return {
    id,
    label: metadata.name?.trim() || objectFallbackLabel(object, t),
    visible: object.visible !== false,
    locked: metadata.locked ?? Boolean(object.lockMovementX),
    object,
    rootObject,
    children,
  };
}

function filterLayer(item: LayerItem, query: string): LayerItem | null {
  if (!query) return item;
  const children = item.children
    .map((child) => filterLayer(child, query))
    .filter((child): child is LayerItem => child !== null);
  if (item.label.toLocaleLowerCase().includes(query) || children.length > 0) {
    return { ...item, children };
  }
  return null;
}

export default function LayerPanel() {
  const canvas = useEditorStore((s) => s.canvas);
  const selectedObjectIds = useEditorStore((s) => s.selectedObjectIds);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  const setSelectedObjectIds = useEditorStore((s) => s.setSelectedObjectIds);
  const t = useI18n((s) => s.t);
  const [layers, setLayers] = useState<LayerItem[]>([]);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const cancelRenameRef = useRef(false);

  const refreshLayers = useCallback(() => {
    if (!canvas) {
      setLayers([]);
      return;
    }
    setLayers(canvas.getObjects().map((object) => toLayerItem(object, object, t)).reverse());
  }, [canvas, t]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- Fabric is an external mutable store.
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

  const visibleLayers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return layers.map((item) => filterLayer(item, normalized)).filter((item): item is LayerItem => item !== null);
  }, [layers, query]);

  const selectObject = (item: LayerItem, multi: boolean) => {
    if (!canvas) return;
    const object = item.rootObject;
    const current = canvas.getActiveObjects();
    let next: fabric.FabricObject[];
    if (multi) {
      next = current.includes(object) ? current.filter((value) => value !== object) : [...current, object];
    } else {
      next = [object];
    }
    canvas.discardActiveObject();
    if (next.length === 1) canvas.setActiveObject(next[0]);
    else if (next.length > 1) canvas.setActiveObject(new fabric.ActiveSelection(next, { canvas }));
    setSelectedObjectIds(next.map((value) => ensureObjectId(value)));
    canvas.requestRenderAll();
  };

  const activeOr = (fallback: fabric.FabricObject): fabric.FabricObject[] => {
    const active = canvas?.getActiveObjects() ?? [];
    return active.includes(fallback) && active.length > 0 ? active : [fallback];
  };

  const toggleVisibility = (item: LayerItem) => {
    if (!canvas) return;
    const targets = activeOr(item.object);
    const nextVisible = !targets.every((object) => object.visible !== false);
    targets.forEach((object) => object.set({ visible: nextVisible }));
    item.rootObject.dirty = true;
    if (!nextVisible) canvas.discardActiveObject();
    canvas.requestRenderAll();
    refreshLayers();
    pushHistory();
  };

  const toggleLock = (item: LayerItem) => {
    if (!canvas) return;
    const targets = activeOr(item.object);
    const nextLocked = !targets.every((object) => getFabricMetadata(object).locked ?? Boolean(object.lockMovementX));
    const setLockedRecursive = (object: fabric.FabricObject) => {
      setFabricMetadata(object, 'locked', nextLocked);
      if (object instanceof fabric.Group || object instanceof fabric.ActiveSelection) {
        object.getObjects().forEach(setLockedRecursive);
      }
      applyPersistentObjectState(object);
    };
    targets.forEach(setLockedRecursive);
    item.rootObject.dirty = true;
    canvas.requestRenderAll();
    refreshLayers();
    pushHistory();
  };

  const beginRename = (item: LayerItem) => {
    setEditingId(item.id);
    setNameDraft(getFabricMetadata(item.object).name ?? item.label);
  };

  const commitRename = (item: LayerItem) => {
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false;
      return;
    }
    if (editingId !== item.id) return;
    const value = nameDraft.trim();
    const oldName = getFabricMetadata(item.object).name ?? '';
    setEditingId(null);
    if (value === oldName) return;
    setFabricMetadata(item.object, 'name', value || undefined);
    refreshLayers();
    pushHistory();
  };

  const renameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape') {
      cancelRenameRef.current = true;
      setEditingId(null);
      event.currentTarget.blur();
    }
  };

  const moveLayer = (event: DragEvent, target: LayerItem) => {
    event.preventDefault();
    if (!canvas || !draggedId || draggedId === target.id) return;
    const dragged = layers.find((item) => item.id === draggedId);
    if (!dragged) return;
    const targetIndex = canvas.getObjects().indexOf(target.rootObject);
    if (targetIndex < 0 || !canvas.moveObjectTo(dragged.rootObject, targetIndex)) return;
    setDraggedId(null);
    canvas.requestRenderAll();
    refreshLayers();
    pushHistory();
  };

  const moveLayerBy = (item: LayerItem, offset: -1 | 1) => {
    if (!canvas || item.object !== item.rootObject) return;
    const objects = canvas.getObjects();
    const currentIndex = objects.indexOf(item.rootObject);
    const nextIndex = Math.max(0, Math.min(objects.length - 1, currentIndex + offset));
    if (currentIndex < 0 || currentIndex === nextIndex) return;
    canvas.moveObjectTo(item.rootObject, nextIndex);
    canvas.requestRenderAll();
    refreshLayers();
    pushHistory();
  };

  const toggleCollapsed = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderItem = (item: LayerItem, depth = 0) => {
    const selected = selectedObjectIds.includes(item.id) || selectedObjectIds.includes(ensureObjectId(item.rootObject));
    const isCollapsed = collapsed.has(item.id);
    const isRoot = item.object === item.rootObject;
    return (
      <div key={item.id}>
        <div
          className={`layer-item ${selected ? 'selected' : ''}`}
          style={{ paddingLeft: 4 + depth * 14 }}
          onClick={(event) => selectObject(item, event.metaKey || event.ctrlKey)}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
            event.preventDefault();
            selectObject(item, event.metaKey || event.ctrlKey);
          }}
          role="treeitem"
          tabIndex={0}
          aria-level={depth + 1}
          aria-selected={selected}
          aria-expanded={item.children.length > 0 ? !isCollapsed : undefined}
          draggable={isRoot && editingId !== item.id}
          onDragStart={() => setDraggedId(item.id)}
          onDragEnd={() => setDraggedId(null)}
          onDragOver={(event) => { if (isRoot) event.preventDefault(); }}
          onDrop={(event) => { if (isRoot) moveLayer(event, item); }}
        >
          {item.children.length > 0 ? (
            <IconButton
              className="layer-tree-toggle"
              label={isCollapsed ? t('expandGroup') : t('collapseGroup')}
              onClick={(event) => { event.stopPropagation(); toggleCollapsed(item.id); }}
            >
              {isCollapsed ? '▸' : '▾'}
            </IconButton>
          ) : <span className="layer-tree-spacer" />}
          {editingId === item.id ? (
            <input
              className="layer-name-input"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={() => commitRename(item)}
              onKeyDown={renameKeyDown}
              onClick={(event) => event.stopPropagation()}
              aria-label={t('renameLayer')}
              autoFocus
            />
          ) : (
            <span className="layer-label" onDoubleClick={(event) => { event.stopPropagation(); beginRename(item); }} title={t('renameLayer')}>
              {item.label}
            </span>
          )}
          <div className="layer-actions">
            {isRoot && (
              <>
                <IconButton
                  className="layer-action-btn"
                  onClick={(event) => { event.stopPropagation(); moveLayerBy(item, 1); }}
                  label={t('tip_forward')}
                >
                  ↑
                </IconButton>
                <IconButton
                  className="layer-action-btn"
                  onClick={(event) => { event.stopPropagation(); moveLayerBy(item, -1); }}
                  label={t('tip_backward')}
                >
                  ↓
                </IconButton>
              </>
            )}
            <IconButton
              className={`layer-action-btn ${!item.visible ? 'off' : ''}`}
              onClick={(event) => { event.stopPropagation(); toggleVisibility(item); }}
              label={item.visible ? t('hide') : t('show')}
              aria-pressed={!item.visible}
            >
              {item.visible ? '👁' : '−'}
            </IconButton>
            <IconButton
              className={`layer-action-btn ${item.locked ? 'on' : ''}`}
              onClick={(event) => { event.stopPropagation(); toggleLock(item); }}
              label={item.locked ? t('unlock') : t('lock')}
              aria-pressed={item.locked}
            >
              {item.locked ? '🔒' : '🔓'}
            </IconButton>
          </div>
        </div>
        {!isCollapsed && item.children.map((child) => renderItem(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="layer-panel">
      <div className="prop-section-title">{t('layers')}</div>
      <label className="sr-only" htmlFor="layer-search">{t('searchLayers')}</label>
      <input
        id="layer-search"
        className="layer-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('searchLayers')}
      />
      {layers.length === 0 && <div className="layer-empty">{t('noObjects')}</div>}
      {layers.length > 0 && visibleLayers.length === 0 && <div className="layer-empty">{t('noLayerMatches')}</div>}
      <div className="layer-list" role="tree" aria-label={t('layers')} aria-multiselectable="true">
        {visibleLayers.map((item) => renderItem(item))}
      </div>
    </div>
  );
}
