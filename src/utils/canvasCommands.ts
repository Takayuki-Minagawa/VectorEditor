import * as fabric from 'fabric';
import {
  assignNewObjectId,
  ensureObjectIdsRecursive,
  reassignObjectIdsRecursive,
} from './objectIds';

type PushHistory = () => void;
type SetClipboard = (objects: fabric.FabricObject[] | null) => void;

function finishMutation(canvas: fabric.Canvas, pushHistory?: PushHistory): void {
  canvas.requestRenderAll();
  pushHistory?.();
}

function addObjectOrSelection(canvas: fabric.Canvas, obj: fabric.FabricObject): fabric.FabricObject {
  if (obj instanceof fabric.ActiveSelection) {
    const objects = obj.getObjects();
    objects.forEach((child) => canvas.add(child));
    const selection = new fabric.ActiveSelection(objects, { canvas });
    selection.setCoords();
    return selection;
  }
  canvas.add(obj);
  return obj;
}

export function selectAll(canvas: fabric.Canvas): boolean {
  canvas.discardActiveObject();
  const objects = canvas.getObjects();
  if (objects.length === 0) return false;
  canvas.setActiveObject(new fabric.ActiveSelection(objects, { canvas }));
  canvas.requestRenderAll();
  return true;
}

export function copyActive(canvas: fabric.Canvas, setClipboard: SetClipboard): boolean {
  const active = canvas.getActiveObject();
  if (!active) return false;
  active.clone().then((cloned: fabric.FabricObject) => {
    setClipboard([cloned]);
  });
  return true;
}

export function pasteClipboard(
  canvas: fabric.Canvas,
  clipboard: fabric.FabricObject[] | null,
  setClipboard: SetClipboard,
  pushHistory: PushHistory,
): boolean {
  if (!clipboard || clipboard.length === 0) return false;
  clipboard[0].clone().then((cloned: fabric.FabricObject) => {
    reassignObjectIdsRecursive(cloned);
    cloned.set({
      left: (cloned.left || 0) + 20,
      top: (cloned.top || 0) + 20,
    });
    const active = addObjectOrSelection(canvas, cloned);
    canvas.setActiveObject(active);
    finishMutation(canvas, pushHistory);
    setClipboard([active]);
  });
  return true;
}

export function duplicateActive(canvas: fabric.Canvas, pushHistory: PushHistory): boolean {
  const active = canvas.getActiveObject();
  if (!active) return false;
  active.clone().then((cloned: fabric.FabricObject) => {
    reassignObjectIdsRecursive(cloned);
    cloned.set({
      left: (cloned.left || 0) + 20,
      top: (cloned.top || 0) + 20,
    });
    const duplicated = addObjectOrSelection(canvas, cloned);
    canvas.setActiveObject(duplicated);
    finishMutation(canvas, pushHistory);
  });
  return true;
}

export function deleteSelected(canvas: fabric.Canvas, pushHistory: PushHistory): boolean {
  const active = canvas.getActiveObjects();
  if (active.length === 0) return false;
  active.forEach((obj) => canvas.remove(obj));
  canvas.discardActiveObject();
  finishMutation(canvas, pushHistory);
  return true;
}

export function groupSelection(canvas: fabric.Canvas, pushHistory: PushHistory): boolean {
  const active = canvas.getActiveObject();
  if (!(active instanceof fabric.ActiveSelection)) return false;
  const objects = active.getObjects();
  canvas.discardActiveObject();
  const group = new fabric.Group(objects);
  assignNewObjectId(group, 'group');
  objects.forEach((obj) => canvas.remove(obj));
  canvas.add(group);
  canvas.setActiveObject(group);
  finishMutation(canvas, pushHistory);
  return true;
}

export function ungroupActive(canvas: fabric.Canvas, pushHistory: PushHistory): boolean {
  const active = canvas.getActiveObject();
  if (!(active instanceof fabric.Group)) return false;
  const items = [...active.getObjects()];
  active.remove(...items);
  canvas.remove(active);
  items.forEach((item) => {
    ensureObjectIdsRecursive(item);
    canvas.add(item);
  });
  canvas.setActiveObject(new fabric.ActiveSelection(items, { canvas }));
  finishMutation(canvas, pushHistory);
  return true;
}

export function moveActiveBy(canvas: fabric.Canvas, dx: number, dy: number, pushHistory: PushHistory): boolean {
  const active = canvas.getActiveObject();
  if (!active) return false;
  active.set({
    left: (active.left || 0) + dx,
    top: (active.top || 0) + dy,
  });
  active.setCoords();
  finishMutation(canvas, pushHistory);
  return true;
}

export type StackCommand = 'bringForward' | 'sendBackward' | 'bringToFront' | 'sendToBack';

export function stackActive(canvas: fabric.Canvas, command: StackCommand, pushHistory: PushHistory): boolean {
  const obj = canvas.getActiveObject();
  if (!obj) return false;
  switch (command) {
    case 'bringForward':
      canvas.bringObjectForward(obj);
      break;
    case 'sendBackward':
      canvas.sendObjectBackwards(obj);
      break;
    case 'bringToFront':
      canvas.bringObjectToFront(obj);
      break;
    case 'sendToBack':
      canvas.sendObjectToBack(obj);
      break;
  }
  finishMutation(canvas, pushHistory);
  return true;
}

export function flipActive(canvas: fabric.Canvas, axis: 'x' | 'y', pushHistory: PushHistory): boolean {
  const active = canvas.getActiveObject();
  if (!active) return false;
  if (axis === 'x') active.set('flipX', !active.flipX);
  else active.set('flipY', !active.flipY);
  active.setCoords();
  finishMutation(canvas, pushHistory);
  return true;
}

export function toggleActiveLock(canvas: fabric.Canvas, pushHistory?: PushHistory): boolean {
  const active = canvas.getActiveObject();
  if (!active) return false;
  const locked = !active.lockMovementX;
  active.set({
    lockMovementX: locked,
    lockMovementY: locked,
    lockScalingX: locked,
    lockScalingY: locked,
    lockRotation: locked,
    hasControls: !locked,
  });
  finishMutation(canvas, pushHistory);
  return true;
}
