import * as fabric from 'fabric';
import { defaultCadLayers, layerDashArray, validateCadLayers, type CadLayer } from '../domain/cadLayer';
import { getFabricMetadata, setFabricMetadataValues, type CadOwnAppearance } from './fabricObjectMetadata';
import { collectFabricObjectTree } from './fabricObjectTree';

interface LayerContext { layers: CadLayer[]; activeId: string; replace: (layers: CadLayer[]) => void }
const contexts = new WeakMap<fabric.StaticCanvas, LayerContext>();
const protectedObjects = new WeakSet<fabric.FabricObject>();
const clipboardLayers = new WeakMap<fabric.FabricObject, CadLayer[]>();
export const isCadLayerLocked = (object: fabric.FabricObject): boolean => protectedObjects.has(object);
export function setCanvasLayerContext(canvas: fabric.StaticCanvas, context: LayerContext): void { contexts.set(canvas, context); }
export function canvasCadLayers(canvas: fabric.StaticCanvas): CadLayer[] { return contexts.get(canvas)?.layers ?? defaultCadLayers(); }

function ownAppearance(object: fabric.FabricObject): CadOwnAppearance {
  return { stroke: object.stroke instanceof fabric.Gradient ? object.stroke.toObject() : typeof object.stroke === 'string' ? object.stroke : null,
    fill: object.fill instanceof fabric.Gradient ? object.fill.toObject() : object.fill instanceof fabric.Pattern ? undefined : object.fill,
    strokeWidth: object.strokeWidth, strokeDashArray: object.strokeDashArray ? [...object.strokeDashArray] : null };
}
export function restoreIndividualAppearance(object: fabric.FabricObject, own: CadOwnAppearance): void {
  const paint = (value: CadOwnAppearance['stroke']) => value && typeof value === 'object' ? new fabric.Gradient(value) : value;
  object.set({ stroke: paint(own.stroke), strokeWidth: own.strokeWidth, strokeDashArray: own.strokeDashArray,
    ...(own.fill !== undefined ? { fill: paint(own.fill) } : {}) });
}
export function makeLayerStyleIndividual(roots: readonly fabric.FabricObject[], restore = false): void {
  for (const object of collectFabricObjectTree(roots)) {
    const own = getFabricMetadata(object).cadOwnAppearance;
    if (restore && own) restoreIndividualAppearance(object, own);
    setFabricMetadataValues(object, { cadStyleMode: 'object', cadOwnAppearance: undefined });
    object.dirty = true;
  }
}
export function assignCadLayer(roots: readonly fabric.FabricObject[], id: string, mode: 'object' | 'layer'): void {
  if (mode === 'layer' && collectFabricObjectTree(roots).some((object) => object.stroke instanceof fabric.Pattern)) throw new Error('Pattern strokes require individual styling');
  if (mode === 'object') makeLayerStyleIndividual(roots, true);
  for (const object of collectFabricObjectTree(roots)) {
    if (mode === 'layer' && !getFabricMetadata(object).cadOwnAppearance) setFabricMetadataValues(object, { cadOwnAppearance: ownAppearance(object) });
    setFabricMetadataValues(object, { cadLayerId: id, cadStyleMode: mode });
  }
}
/** Attach a new root to the active layer; restored/cloned objects keep their membership. */
export function initializeObjectLayer(canvas: fabric.StaticCanvas, root: fabric.FabricObject, cad: boolean): void {
  const context = contexts.get(canvas);
  if (!context || getFabricMetadata(root).cadLayerId !== undefined) return;
  const id = cad ? context.activeId : '0';
  if (root instanceof fabric.Group && root.getObjects().some((o) => getFabricMetadata(o).cadLayerId !== undefined)) {
    setFabricMetadataValues(root, { cadLayerId: '0', cadStyleMode: 'object' });
  } else assignCadLayer([root], id, cad && id !== '0' ? 'layer' : 'object');
}

/** Resolve presentation without replacing the object's persistent lock/visibility. */
export function applyCadLayers(canvas: fabric.StaticCanvas): void {
  const context = contexts.get(canvas);
  if (!context) return;
  const layers = new Map(context.layers.map((layer) => [layer.id, layer]));
  const visit = (object: fabric.FabricObject, parentId = '0', parentVisible = true, parentLocked = false, parentMode: 'object' | 'layer' = 'object', semanticFill = false): boolean => {
    const metadata = getFabricMetadata(object);
    const id = metadata.cadLayerId ?? parentId;
    const layer = layers.get(id) ?? layers.get('0')!;
    const mode = metadata.cadStyleMode ?? parentMode;
    if (metadata.cadLayerId === undefined || metadata.cadStyleMode === undefined) setFabricMetadataValues(object, { cadLayerId: id, cadStyleMode: mode });
    const ownLocked = metadata.locked ?? Boolean(object.lockMovementX || object.lockMovementY || object.lockScalingX || object.lockScalingY || object.lockRotation);
    if (metadata.locked === undefined) setFabricMetadataValues(object, { locked: ownLocked });
    if (metadata.cadVisible === undefined) setFabricMetadataValues(object, { cadVisible: object.visible !== false });
    const visible = (metadata.cadVisible ?? object.visible !== false) && layer.visible && parentVisible;
    const inheritedLock = layer.locked || parentLocked;
    let locked = inheritedLock;
    if (mode === 'layer') {
      if (!metadata.cadOwnAppearance) setFabricMetadataValues(object, { cadOwnAppearance: ownAppearance(object) });
      if (!(object instanceof fabric.Group)) {
        object.set({ stroke: layer.color, strokeWidth: layer.lineWidth, strokeDashArray: layerDashArray(layer) });
        if (object instanceof fabric.FabricText) object.set({ fill: layer.color, stroke: null, strokeWidth: 0 });
        else if (semanticFill && object instanceof fabric.Polygon) object.set({ fill: layer.color });
      }
    }
    object.set({ visible });
    if (object instanceof fabric.Group) {
      const fillChildren = semanticFill || ['arrow', 'dimension', 'connector'].includes(metadata.objectKind ?? '');
      for (const child of object.getObjects()) locked = visit(child, id, visible, inheritedLock, mode, fillChildren) || locked;
      if (mode === 'layer') object.triggerLayout();
    }
    if (locked) protectedObjects.add(object); else protectedObjects.delete(object);
    object.set({ lockMovementX: ownLocked || locked, lockMovementY: ownLocked || locked, lockScalingX: ownLocked || locked,
      lockScalingY: ownLocked || locked, lockRotation: ownLocked || locked, hasControls: !ownLocked && !locked });
    if (locked || !visible) object.set({ selectable: false, evented: false });
    object.setCoords(); object.dirty = true;
    return locked;
  };
  canvas.getObjects().forEach((object) => visit(object));
  if (canvas instanceof fabric.Canvas && canvas.getActiveObjects().some((o) => isCadLayerLocked(o) || !o.visible)) canvas.discardActiveObject();
  canvas.requestRenderAll();
}

/** Canonical visibility belongs to the object; effective layer visibility is transient. */
export function canonicalizeSerializedLayers(objects: unknown[]): void {
  for (const value of objects) {
    if (!value || typeof value !== 'object') continue;
    const object = value as Record<string, unknown>;
    if (typeof object.cadVisible === 'boolean') object.visible = object.cadVisible;
    if (Array.isArray(object.objects)) canonicalizeSerializedLayers(object.objects);
  }
}
export function filterPrintableObjects(objects: unknown[], layers: readonly CadLayer[], parentId = '0'): unknown[] {
  const layerMap = new Map(layers.map((l) => [l.id, l]));
  const filter = (items: unknown[], inheritedId: string): unknown[] => items.flatMap((item) => {
    const object = item as Record<string, unknown>;
    const id = typeof object.cadLayerId === 'string' ? object.cadLayerId : inheritedId;
    if (layerMap.get(id)?.printable === false) return [];
    return [{ ...object, ...(Array.isArray(object.objects) ? { objects: filter(object.objects, id) } : {}) }];
  });
  return filter(objects, parentId);
}

export function mergeObjectLayers(canvas: fabric.StaticCanvas, objects: readonly fabric.FabricObject[], source: readonly CadLayer[]): void {
  const context = contexts.get(canvas);
  if (!context) return;
  const next = context.layers.map((l) => ({ ...l }));
  const map = new Map<string, string>();
  const used = new Set(collectFabricObjectTree(objects).map((o) => getFabricMetadata(o).cadLayerId ?? '0'));
  for (const layer of source.filter((l) => used.has(l.id))) {
    const properties = ['name', 'color', 'lineType', 'lineWidth', 'visible', 'locked', 'printable'] as const;
    const existing = next.find((l) => properties.every((key) => l[key] === layer[key]));
    if (existing) { map.set(layer.id, existing.id); continue; }
    const id = `layer_${crypto.randomUUID()}`;
    let name = layer.name; let index = 2;
    while (next.some((l) => l.name === name)) name = `${layer.name.slice(0, 70)} (${index++})`;
    next.push({ ...layer, id, name }); map.set(layer.id, id);
  }
  validateCadLayers(next);
  for (const object of collectFabricObjectTree(objects)) {
    const id = getFabricMetadata(object).cadLayerId;
    if (id && map.has(id)) setFabricMetadataValues(object, { cadLayerId: map.get(id) });
    else if (id && !next.some((l) => l.id === id)) {
      // Legacy material has no layer table: preserve its rendered style on 0.
      makeLayerStyleIndividual([object]); setFabricMetadataValues(object, { cadLayerId: '0' });
    }
  }
  context.replace(next);
}
export function rememberClipboardLayers(canvas: fabric.StaticCanvas, object: fabric.FabricObject): void { clipboardLayers.set(object, structuredClone(canvasCadLayers(canvas))); }
export function copiedCadLayers(object: fabric.FabricObject): CadLayer[] { return clipboardLayers.get(object) ?? []; }
export function setCopiedCadLayers(object: fabric.FabricObject, layers: CadLayer[]): void { clipboardLayers.set(object, structuredClone(layers)); }
