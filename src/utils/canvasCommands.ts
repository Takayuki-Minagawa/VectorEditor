import * as fabric from 'fabric';
import { getFabricMetadata, setPersistentObjectLocked } from './fabricObjectMetadata';
import {
  assignNewObjectId,
  ensureObjectIdsRecursive,
  reassignObjectIdsRecursive,
} from './objectIds';
import { updateLinkedSemanticObjects } from './semanticObjects';
import { historyService } from './historyService';
import { collectFabricObjectTree } from './fabricObjectTree';

export type PushHistory = () => void;
export type SetClipboard = (objects: fabric.FabricObject[] | null) => void;

export interface CanvasCommandContext {
  canvas: fabric.Canvas;
  pushHistory?: PushHistory;
}

export interface CanvasCommandOptions<T> {
  render?: boolean;
  recordHistory?: boolean;
  didChange?: (result: T) => boolean;
  /**
   * Limit associative dimension/connector refresh work performed at commit.
   * Omitted means all semantic objects for backwards-compatible low-level
   * callers; commands should pass IDs for geometry changes or `none` when the
   * document geometry is unchanged.
   */
  semanticUpdate?: SemanticUpdateScope | ((result: T) => SemanticUpdateScope);
}

export type SemanticUpdateScope = 'all' | 'none' | readonly string[];

let defaultPushHistory: PushHistory | undefined;

export function createAsyncCanvasMutationGuard(canvas: fabric.StaticCanvas): () => boolean {
  const epoch = historyService.currentMutationEpoch;
  const startedWhileRestoring = historyService.isRestoring;
  return () => (
    !startedWhileRestoring
    && historyService.isMutationEpochCurrent(epoch)
    && !canvas.destroyed
    && !canvas.disposed
  );
}

/** Allows the editor store to supply history for legacy callers that omit it. */
export function setDefaultCanvasCommandHistory(pushHistory: PushHistory | undefined): void {
  defaultPushHistory = pushHistory;
}

function commitCommand(
  { canvas, pushHistory }: CanvasCommandContext,
  render: boolean,
  recordHistory: boolean,
  semanticUpdate: SemanticUpdateScope,
): void {
  if (recordHistory && semanticUpdate !== 'none') {
    const changedIds = semanticUpdate === 'all' ? undefined : semanticUpdate;
    if (!changedIds || changedIds.length > 0) {
      updateLinkedSemanticObjects(canvas, undefined, changedIds);
    }
  }
  if (render) canvas.requestRenderAll();
  if (recordHistory) (pushHistory ?? defaultPushHistory)?.();
}

function commandChanged<T>(result: T, options: CanvasCommandOptions<T>): boolean {
  return options.didChange ? options.didChange(result) : result !== false;
}

function runCanvasCommand<T>(
  context: CanvasCommandContext,
  mutation: () => T | Promise<T>,
  options: CanvasCommandOptions<T>,
): T | Promise<T> {
  const finish = (result: T): T => {
    if (commandChanged(result, options)) {
      const semanticUpdate = typeof options.semanticUpdate === 'function'
        ? options.semanticUpdate(result)
        : options.semanticUpdate ?? 'all';
      commitCommand(
        context,
        options.render !== false,
        options.recordHistory !== false,
        semanticUpdate,
      );
    }
    return result;
  };

  const result = mutation();
  return result instanceof Promise ? result.then(finish) : finish(result);
}

export function executeCanvasCommand<T>(
  context: CanvasCommandContext,
  mutation: () => Promise<T>,
  options?: CanvasCommandOptions<T>,
): Promise<T>;
export function executeCanvasCommand<T>(
  context: CanvasCommandContext,
  mutation: () => T,
  options?: CanvasCommandOptions<T>,
): T;
export function executeCanvasCommand<T>(
  context: CanvasCommandContext,
  mutation: () => T | Promise<T>,
  options: CanvasCommandOptions<T> = {},
): T | Promise<T> {
  return runCanvasCommand(context, mutation, options);
}

/** A named alias for grouping several low-level mutations into one commit. */
export function executeCanvasTransaction<T>(
  context: CanvasCommandContext,
  mutation: () => Promise<T>,
  options?: CanvasCommandOptions<T>,
): Promise<T>;
export function executeCanvasTransaction<T>(
  context: CanvasCommandContext,
  mutation: () => T,
  options?: CanvasCommandOptions<T>,
): T;
export function executeCanvasTransaction<T>(
  context: CanvasCommandContext,
  mutation: () => T | Promise<T>,
  options: CanvasCommandOptions<T> = {},
): T | Promise<T> {
  return runCanvasCommand(context, mutation, options);
}

function addObjectOrSelection(canvas: fabric.Canvas, object: fabric.FabricObject): fabric.FabricObject {
  if (object instanceof fabric.ActiveSelection) {
    const children = [...object.getObjects()];
    object.remove(...children);
    children.forEach((child) => canvas.add(child));
    object.dispose();
    return new fabric.ActiveSelection(children, { canvas });
  }
  canvas.add(object);
  return object;
}

function collectSemanticUpdateIds(
  objects: readonly fabric.FabricObject[],
  includeDescendants = false,
): string[] {
  const ids = new Set<string>();
  const addRoot = (object: fabric.FabricObject): void => {
    // ActiveSelection is interaction-only. Its children are document roots
    // and are expanded once by updateLinkedSemanticObjects.
    if (object instanceof fabric.ActiveSelection) {
      object.getObjects().forEach(addRoot);
      return;
    }
    const id = getFabricMetadata(object).id;
    if (id) ids.add(id);
  };
  if (includeDescendants) {
    collectFabricObjectTree(objects).forEach((object) => {
      if (!(object instanceof fabric.ActiveSelection)) addRoot(object);
    });
  } else {
    objects.forEach(addRoot);
  }
  return [...ids];
}

export function selectAll(canvas: fabric.Canvas): boolean {
  return executeCanvasCommand(
    { canvas },
    () => {
      canvas.discardActiveObject();
      const objects = canvas.getObjects();
      if (objects.length === 0) return false;
      canvas.setActiveObject(new fabric.ActiveSelection(objects, { canvas }));
      return true;
    },
    { recordHistory: false },
  );
}

export function copyActive(canvas: fabric.Canvas, setClipboard: SetClipboard): boolean {
  const active = canvas.getActiveObject();
  if (!active) return false;
  const canCommit = createAsyncCanvasMutationGuard(canvas);
  void active.clone().then((cloned: fabric.FabricObject) => {
    if (!canCommit()) {
      cloned.dispose();
      return;
    }
    setClipboard([cloned]);
  }).catch(() => undefined);
  return true;
}

export function pasteClipboard(
  canvas: fabric.Canvas,
  clipboard: fabric.FabricObject[] | null,
  setClipboard: SetClipboard,
  pushHistory: PushHistory,
): boolean {
  if (!clipboard || clipboard.length === 0) return false;
  let semanticUpdateIds: string[] = [];
  const operation = executeCanvasCommand(
    { canvas, pushHistory },
    async () => {
      const canCommit = createAsyncCanvasMutationGuard(canvas);
      const cloned = await clipboard[0].clone();
      if (!canCommit()) {
        cloned.dispose();
        return false;
      }
      reassignObjectIdsRecursive(cloned);
      cloned.set({
        left: (cloned.left || 0) + 20,
        top: (cloned.top || 0) + 20,
      });
      const active = addObjectOrSelection(canvas, cloned);
      canvas.setActiveObject(active);
      setClipboard([active]);
      semanticUpdateIds = collectSemanticUpdateIds([active]);
      return true;
    },
    { semanticUpdate: () => semanticUpdateIds },
  );
  // Preserve the existing immediate boolean API. Async users can call
  // executeCanvasCommand directly and await its result.
  void operation.catch(() => undefined);
  return true;
}

export function duplicateActive(canvas: fabric.Canvas, pushHistory: PushHistory): boolean {
  const active = canvas.getActiveObject();
  if (!active) return false;
  let semanticUpdateIds: string[] = [];
  const operation = executeCanvasCommand(
    { canvas, pushHistory },
    async () => {
      const canCommit = createAsyncCanvasMutationGuard(canvas);
      const cloned = await active.clone();
      if (!canCommit()) {
        cloned.dispose();
        return false;
      }
      reassignObjectIdsRecursive(cloned);
      cloned.set({
        left: (cloned.left || 0) + 20,
        top: (cloned.top || 0) + 20,
      });
      const duplicated = addObjectOrSelection(canvas, cloned);
      canvas.setActiveObject(duplicated);
      semanticUpdateIds = collectSemanticUpdateIds([duplicated]);
      return true;
    },
    { semanticUpdate: () => semanticUpdateIds },
  );
  void operation.catch(() => undefined);
  return true;
}

export function deleteSelected(canvas: fabric.Canvas, pushHistory: PushHistory): boolean {
  let semanticUpdateIds: string[] = [];
  return executeCanvasCommand(
    { canvas, pushHistory },
    () => {
      const active = canvas.getActiveObjects();
      if (active.length === 0) return false;
      // Deleted groups are absent from the post-mutation index, so retain all
      // descendant IDs while the object trees are still available.
      semanticUpdateIds = collectSemanticUpdateIds(active, true);
      active.forEach((object) => canvas.remove(object));
      canvas.discardActiveObject();
      return true;
    },
    { semanticUpdate: () => semanticUpdateIds },
  );
}

export function groupSelection(canvas: fabric.Canvas, pushHistory: PushHistory): boolean {
  let semanticUpdateIds: string[] = [];
  return executeCanvasCommand(
    { canvas, pushHistory },
    () => {
      const active = canvas.getActiveObject();
      if (!(active instanceof fabric.ActiveSelection)) return false;
      const objects = active.getObjects();
      canvas.discardActiveObject();
      const group = new fabric.Group(objects);
      assignNewObjectId(group, 'group');
      objects.forEach((object) => canvas.remove(object));
      canvas.add(group);
      canvas.setActiveObject(group);
      semanticUpdateIds = collectSemanticUpdateIds([group]);
      return true;
    },
    { semanticUpdate: () => semanticUpdateIds },
  );
}

export function ungroupActive(canvas: fabric.Canvas, pushHistory: PushHistory): boolean {
  let semanticUpdateIds: string[] = [];
  return executeCanvasCommand(
    { canvas, pushHistory },
    () => {
      const active = canvas.getActiveObject();
      if (!(active instanceof fabric.Group)) return false;
      const removedGroupId = collectSemanticUpdateIds([active]);
      const items = [...active.getObjects()];
      active.remove(...items);
      canvas.remove(active);
      items.forEach((item) => {
        ensureObjectIdsRecursive(item);
        canvas.add(item);
      });
      semanticUpdateIds = [
        ...removedGroupId,
        ...collectSemanticUpdateIds(items),
      ];
      canvas.setActiveObject(new fabric.ActiveSelection(items, { canvas }));
      return true;
    },
    { semanticUpdate: () => semanticUpdateIds },
  );
}

export function moveActiveBy(
  canvas: fabric.Canvas,
  dx: number,
  dy: number,
  pushHistory: PushHistory,
): boolean {
  let semanticUpdateIds: string[] = [];
  return executeCanvasCommand(
    { canvas, pushHistory },
    () => {
      const active = canvas.getActiveObject();
      if (!active) return false;
      active.set({
        left: (active.left || 0) + dx,
        top: (active.top || 0) + dy,
      });
      active.setCoords();
      semanticUpdateIds = collectSemanticUpdateIds([active]);
      return true;
    },
    { semanticUpdate: () => semanticUpdateIds },
  );
}

export type StackCommand = 'bringForward' | 'sendBackward' | 'bringToFront' | 'sendToBack';

export function stackActive(
  canvas: fabric.Canvas,
  command: StackCommand,
  pushHistory: PushHistory,
): boolean {
  return executeCanvasCommand({ canvas, pushHistory }, () => {
    const object = canvas.getActiveObject();
    if (!object) return false;
    switch (command) {
      case 'bringForward':
        canvas.bringObjectForward(object);
        break;
      case 'sendBackward':
        canvas.sendObjectBackwards(object);
        break;
      case 'bringToFront':
        canvas.bringObjectToFront(object);
        break;
      case 'sendToBack':
        canvas.sendObjectToBack(object);
        break;
    }
    return true;
  }, { semanticUpdate: 'none' });
}

export function flipActive(
  canvas: fabric.Canvas,
  axis: 'x' | 'y',
  pushHistory: PushHistory,
): boolean {
  let semanticUpdateIds: string[] = [];
  return executeCanvasCommand(
    { canvas, pushHistory },
    () => {
      const active = canvas.getActiveObject();
      if (!active) return false;
      if (axis === 'x') active.set('flipX', !active.flipX);
      else active.set('flipY', !active.flipY);
      active.setCoords();
      semanticUpdateIds = collectSemanticUpdateIds([active]);
      return true;
    },
    { semanticUpdate: () => semanticUpdateIds },
  );
}

export function toggleActiveLock(canvas: fabric.Canvas, pushHistory?: PushHistory): boolean {
  return executeCanvasCommand({ canvas, pushHistory }, () => {
    const active = canvas.getActiveObject();
    if (!active) return false;
    const objects = active instanceof fabric.ActiveSelection ? active.getObjects() : [active];
    const shouldLock = objects.some((object) => !object.lockMovementX);
    objects.forEach((object) => setPersistentObjectLocked(object, shouldLock));
    active.set({ hasControls: !shouldLock });
    return true;
  }, { semanticUpdate: 'none' });
}
