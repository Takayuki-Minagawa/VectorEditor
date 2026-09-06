import * as fabric from 'fabric';
import { DXF_UNIT_SCALE, MAX_DXF_BYTES, type DxfDrawing, type DxfUnit } from '../domain/dxf';
import { layerDashArray } from '../domain/cadLayer';
import { setFabricMetadataValues } from '../utils/fabricObjectMetadata';
import { reassignObjectIdsAndReferences } from '../utils/objectIds';
import { assignCadLayer, mergeObjectLayers } from '../utils/cadLayers';
import { useEditorStore } from '../store/useEditorStore';

export function readDxfFile(file: File, encoding: 'utf-8' | 'shift_jis', signal: AbortSignal): Promise<DxfDrawing> {
  return new Promise((resolve, reject) => {
    if (!file.size || file.size > MAX_DXF_BYTES) { reject(new Error('DXF size limit')); return; }
    if (signal.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    const worker = new Worker(new URL('../workers/dxfWorker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (drawing?: DxfDrawing, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); signal.removeEventListener('abort', cancel); worker.terminate();
      if (drawing) resolve(drawing); else reject(error);
    };
    const cancel = () => finish(undefined, new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(undefined, new Error('DXF parsing timed out')), 15000);
    signal.addEventListener('abort', cancel, { once: true });
    worker.onmessage = (event: MessageEvent<{ drawing?: DxfDrawing; error?: string }>) => finish(event.data.drawing, new Error(event.data.error ?? 'Invalid DXF response'));
    worker.onerror = () => finish(undefined, new Error('DXF worker failed'));
    void file.arrayBuffer().then((buffer) => { if (!settled) worker.postMessage({ buffer, encoding }, [buffer]); }).catch((error: unknown) => finish(undefined, error));
  });
}

/** Prepare all editable objects before mutating the current document. Coordinates stay in world mm. */
export function dxfToFabricObjects(drawing: DxfDrawing, unit: DxfUnit, drawingHeight: number): fabric.FabricObject[] {
  const scale = DXF_UNIT_SCALE[unit];
  if (!scale || !Number.isFinite(drawingHeight)) throw new Error('Invalid input unit');
  const number = (n: number) => { const result = n * scale; if (!Number.isFinite(result) || Math.abs(result) > 1e9) throw new Error('DXF exceeds coordinate limits'); return result; };
  const point = (p: { x: number; y: number }) => new fabric.Point(number(p.x), drawingHeight - number(p.y));
  const objects: fabric.FabricObject[] = [];
  try {
    for (const entity of drawing.entities) {
      const layer = drawing.layers.find((l) => l.id === entity.layerId)!;
      const lineType = entity.lineType ?? layer.lineType;
      const color = entity.color ?? layer.color;
      const style = { fill: 'transparent', stroke: color, strokeWidth: layer.lineWidth, strokeDashArray: layerDashArray({ ...layer, lineType }), objectCaching: false };
      let object: fabric.FabricObject;
      if (entity.type === 'LINE') {
        const from = point(entity.from); const to = point(entity.to);
        object = new fabric.Line([from.x, from.y, to.x, to.y], style);
      } else if (entity.type === 'POLYLINE') {
        const points = entity.points.map(point);
        object = entity.closed ? new fabric.Polygon(points, style) : new fabric.Polyline(points, style);
      } else if (entity.type === 'CIRCLE') {
        const center = point(entity.center);
        object = new fabric.Circle({ ...style, radius: number(entity.radius), left: center.x, top: center.y, originX: 'center', originY: 'center' });
      } else {
        const text = new fabric.IText(entity.text, { fill: color, stroke: null, strokeWidth: 0, fontFamily: 'Arial', fontSize: number(entity.height), angle: -entity.angle, objectCaching: false });
        const at = point(entity.at); const angle = -entity.angle * Math.PI / 180;
        const x = -text.width / 2; const y = -text.height / 2 + text.fontSize;
        text.setPositionByOrigin(new fabric.Point(at.x - x * Math.cos(angle) + y * Math.sin(angle), at.y - x * Math.sin(angle) - y * Math.cos(angle)), 'center', 'center');
        object = text;
      }
      assignCadLayer([object], layer.id, entity.color || entity.lineType ? 'object' : 'layer');
      setFabricMetadataValues(object, { cadVisible: true, locked: false });
      object.setCoords(); objects.push(object);
    }
    reassignObjectIdsAndReferences(objects);
    return objects;
  } catch (error) { objects.forEach((object) => object.dispose()); throw error; }
}

export function insertDxfDrawing(drawing: DxfDrawing, unit: DxfUnit): void {
  const state = useEditorStore.getState(); const canvas = state.canvas;
  if (!canvas || state.isRestoring || state.drawingMode !== 'cad') throw new Error('CAD canvas is unavailable');
  const objects = dxfToFabricObjects(drawing, unit, state.cadHeight);
  if (!objects.length) throw new Error('No supported DXF entities');
  const previousLayers = structuredClone(state.cadLayers); const previousSelection = canvas.getActiveObjects();
  const renderOnAddRemove = canvas.renderOnAddRemove;
  state.beginHistoryTransaction(); canvas.renderOnAddRemove = false;
  try {
    mergeObjectLayers(canvas, objects, drawing.layers);
    canvas.discardActiveObject();
    canvas.add(...objects);
    // Selection is optional: preserve source hidden/locked layer state.
    const selectable = objects.filter((object) => { const layer = useEditorStore.getState().cadLayers.find((l) => l.id === object.get('cadLayerId')); return layer?.visible && !layer.locked; });
    if (selectable.length === 1) canvas.setActiveObject(selectable[0]);
    else if (selectable.length > 1) canvas.setActiveObject(new fabric.ActiveSelection(selectable, { canvas }));
    state.pushHistory(); state.endHistoryTransaction();
  } catch (error) {
    canvas.discardActiveObject(); canvas.remove(...objects.filter((object) => canvas.contains(object)));
    objects.forEach((object) => object.dispose());
    state.setCadLayers(previousLayers, state.activeCadLayerId, false); state.cancelHistoryTransaction();
    if (previousSelection.length === 1) canvas.setActiveObject(previousSelection[0]);
    else if (previousSelection.length > 1) canvas.setActiveObject(new fabric.ActiveSelection(previousSelection, { canvas }));
    throw error;
  } finally { canvas.renderOnAddRemove = renderOnAddRemove; canvas.requestRenderAll(); }
  const visible = objects.filter((object) => object.visible);
  if (visible.length) {
    const boxes = visible.map((object) => object.getBoundingRect());
    const left = Math.min(...boxes.map((b) => b.left)); const top = Math.min(...boxes.map((b) => b.top));
    const width = Math.max(...boxes.map((b) => b.left + b.width)) - left;
    const height = Math.max(...boxes.map((b) => b.top + b.height)) - top;
    const zoom = Math.max(.001, Math.min(100, canvas.width * .85 / Math.max(width, 1), canvas.height * .85 / Math.max(height, 1)));
    canvas.setViewportTransform([zoom, 0, 0, zoom, canvas.width / 2 - (left + width / 2) * zoom, canvas.height / 2 - (top + height / 2) * zoom]);
    state.setZoom(zoom); canvas.requestRenderAll();
  }
}
