import * as fabric from 'fabric';
import {
  getFabricMetadata,
  setFabricMetadataValues,
  type SemanticAnchor,
} from './fabricObjectMetadata';
import { collectFabricObjectTree } from './fabricObjectTree';
import { generateObjectId } from './objectIds';
import { applyObjectDefaults } from './shapeFactory';
import {
  deletePathAnchor,
  findNearestPointOnSegments,
  insertAnchorOnSegment,
  listPathAnchors,
  listPathSegments,
  pointOnSegment,
  type NearestPathPointHit,
  type PathPoint,
  type SimplePathCommand,
} from './pathCommands';

/** Optional pointer adjustment (grid snap) applied while dragging a node. */
export type SnapPointFn = (point: { x: number; y: number }) => { x: number; y: number };

export type NodeEditableObject = fabric.Line | fabric.Polyline | fabric.Path;

export type NodeRef =
  | { type: 'line'; end: 'start' | 'end' }
  | { type: 'poly'; index: number }
  | { type: 'path'; commandIndex: number };

export interface SceneNode {
  ref: NodeRef;
  point: { x: number; y: number };
}

/** Objects whose nodes the node-edit tool can display and drag. */
export function isNodeEditableObject(object: fabric.FabricObject): object is NodeEditableObject {
  const metadata = getFabricMetadata(object);
  if (metadata.locked) return false;
  if (metadata.objectKind === 'dimension' || metadata.objectKind === 'connector') return false;
  // Section profiles derive their analysis geometry (area, centroid, CAD
  // snapping) from metadata, which node edits would silently desynchronise
  // from the visible path.
  if (metadata.objectKind === 'sectionProfile') return false;
  return object instanceof fabric.Line
    || object instanceof fabric.Polyline
    || object instanceof fabric.Path;
}

function lineLocalPoint(line: fabric.Line, end: 'start' | 'end'): fabric.Point {
  const centerX = (line.x1 + line.x2) / 2;
  const centerY = (line.y1 + line.y2) / 2;
  return end === 'start'
    ? new fabric.Point(line.x1 - centerX, line.y1 - centerY)
    : new fabric.Point(line.x2 - centerX, line.y2 - centerY);
}

/**
 * Moves one line endpoint to a scene-space position while keeping the other
 * endpoint fixed. Setting x1..y2 makes Fabric re-derive left/top from the raw
 * coordinates, so the untouched endpoint is re-anchored afterwards.
 */
export function moveLineEndpoint(
  line: fabric.Line,
  end: 'start' | 'end',
  scenePoint: { x: number; y: number },
): boolean {
  const other = end === 'start' ? 'end' : 'start';
  const anchorBefore = lineLocalPoint(line, other).transform(line.calcOwnMatrix());
  const pointerLocal = fabric.util.sendPointToPlane(
    new fabric.Point(scenePoint.x, scenePoint.y),
    undefined,
    line.calcOwnMatrix(),
  );
  const centerX = (line.x1 + line.x2) / 2;
  const centerY = (line.y1 + line.y2) / 2;
  if (end === 'start') {
    line.set({ x1: pointerLocal.x + centerX, y1: pointerLocal.y + centerY });
  } else {
    line.set({ x2: pointerLocal.x + centerX, y2: pointerLocal.y + centerY });
  }
  const anchorAfter = lineLocalPoint(line, other).transform(line.calcOwnMatrix());
  line.left -= anchorAfter.x - anchorBefore.x;
  line.top -= anchorAfter.y - anchorBefore.y;
  line.set('dirty', true);
  line.setCoords();
  return true;
}

type AnyActionHandler = (
  eventData: fabric.TPointerEvent,
  transform: fabric.Transform,
  x: number,
  y: number,
) => boolean;

function withSnappedPointer(handler: AnyActionHandler, snapPoint: SnapPointFn): AnyActionHandler {
  return function snappedHandler(this: unknown, eventData, transform, x, y) {
    const snapped = snapPoint({ x, y });
    return handler.call(this, eventData, transform, snapped.x, snapped.y);
  };
}

const NODE_CONTROL_OPTIONS = { cursorStyle: 'crosshair' } as const;

// The pen represents a curved closing edge explicitly, followed by Z. Its
// final endpoint and M are the same logical node, even though Fabric exposes
// both as separate path controls.
function closedPathSeam(commands: readonly SimplePathCommand[]): number | null {
  const end = commands.length - 2;
  if (end < 3 || commands[0]?.[0] !== 'M' || commands[end + 1]?.[0] !== 'Z') return null;
  const last = commands[end];
  if (!last || !['L', 'C'].includes(last[0])) return null;
  return last[last.length - 2] === commands[0][1]
    && last[last.length - 1] === commands[0][2] ? end : null;
}

function buildPolyControls(
  poly: fabric.Polyline,
  snapPoint: SnapPointFn,
): Record<string, fabric.Control> {
  const controls: Record<string, fabric.Control> = {};
  for (let index = 0; index < poly.points.length; index += 1) {
    controls[`p${index}`] = new fabric.Control({
      actionName: 'modifyPoly',
      positionHandler: fabric.controlsUtils.createPolyPositionHandler(index),
      actionHandler: withSnappedPointer(
        fabric.controlsUtils.createPolyActionHandler(index) as AnyActionHandler,
        snapPoint,
      ),
      ...NODE_CONTROL_OPTIONS,
    });
  }
  return controls;
}

function buildLineControls(snapPoint: SnapPointFn): Record<string, fabric.Control> {
  const makeControl = (end: 'start' | 'end') => new fabric.Control({
    actionName: 'modifyLine',
    positionHandler: (_dim, _finalMatrix, object) => {
      const line = object as fabric.Line;
      return lineLocalPoint(line, end).transform(fabric.util.multiplyTransformMatrices(
        line.getViewportTransform(),
        line.calcTransformMatrix(),
      ));
    },
    actionHandler: (_eventData, transform, x, y) => moveLineEndpoint(
      transform.target as fabric.Line,
      end,
      snapPoint({ x, y }),
    ),
    ...NODE_CONTROL_OPTIONS,
  });
  return { lineStart: makeControl('start'), lineEnd: makeControl('end') };
}

function buildPathControls(
  path: fabric.Path,
  snapPoint: SnapPointFn,
): Record<string, fabric.Control> {
  const controls = fabric.controlsUtils.createPathControls(path, {
    ...NODE_CONTROL_OPTIONS,
    pointStyle: { controlFill: '#2196F3', controlStroke: '#ffffff' },
    controlPointStyle: { controlFill: '#ffffff', controlStroke: '#2196F3', connectionDashArray: [3, 3] },
  });
  const seamEnd = closedPathSeam(path.path as unknown as SimplePathCommand[]);
  if (seamEnd !== null) delete controls[`c_${seamEnd}_${path.path[seamEnd][0]}`];
  // Anchor and Bézier handle drags follow the same grid snapping as the
  // line/polyline node handles.
  Object.entries(controls).forEach(([key, control]) => {
    const handler = control.actionHandler as AnyActionHandler | undefined;
    if (!handler) return;
    const snapped = withSnappedPointer(handler, snapPoint);
    control.actionHandler = function constrained(eventData, transform, x, y) {
      const commandMatch = /^c_(\d+)_/.exec(key);
      const index = commandMatch ? Number(commandMatch[1]) : -1;
      const controlsPath = transform.target as fabric.Path;
      const commands = controlsPath.path as unknown as SimplePathCommand[];
      const numbers = commands as unknown as number[][];
      const seam = closedPathSeam(commands);
      const before = index >= 0 && commands[index] ? [...commands[index]] : undefined;
      const result = snapped.call(this, eventData, transform, x, y);
      if (!result || !before || !commands[index]) return result;
      const isFirstHandle = key.endsWith('_CP_1');
      const isSecondHandle = key.endsWith('_CP_2');
      if (!isFirstHandle && !isSecondHandle) {
        const oldX = before[before.length - 2] as number;
        const oldY = before[before.length - 1] as number;
        const command = numbers[index];
        const dx = command[command.length - 2] - oldX;
        const dy = command[command.length - 1] - oldY;
        if (dx !== 0 || dy !== 0) {
          const anchor = new fabric.Point(command[command.length - 2], command[command.length - 1]);
          withAnchoredGeometry(controlsPath, anchor, () => {
            if (commands[index][0] === 'C') { command[3] += dx; command[4] += dy; }
            const next = numbers[index + 1];
            if (commands[index + 1]?.[0] === 'C') { next[1] += dx; next[2] += dy; }
            if (seam !== null && (index === 0 || index === seam)) {
              const paired = numbers[index === 0 ? seam : 0];
              paired[paired.length - 2] += dx;
              paired[paired.length - 1] += dy;
              if (index === 0 && commands[seam][0] === 'C') {
                numbers[seam][3] += dx;
                numbers[seam][4] += dy;
              }
              if (index === seam && commands[1][0] === 'C') {
                numbers[1][1] += dx;
                numbers[1][2] += dy;
              }
            }
          });
        }
        return result;
      }
      const anchorIndex = seam !== null && ((isFirstHandle && index === 1) || (isSecondHandle && index === seam))
        ? 0 : isFirstHandle ? index - 1 : index;
      const mode = getFabricMetadata(controlsPath).bezierNodeModes?.[String(anchorIndex)] ?? 'cusp';
      if (mode === 'cusp') return result;
      const anchorCommand = numbers[anchorIndex];
      const oppositeIndex = seam !== null && anchorIndex === 0
        ? (isFirstHandle ? seam : 1)
        : (isFirstHandle ? anchorIndex : index + 1);
      const opposite = numbers[oppositeIndex];
      if (!anchorCommand || !opposite || commands[oppositeIndex][0] !== 'C') return result;
      const anchor = { x: anchorCommand[anchorCommand.length - 2], y: anchorCommand[anchorCommand.length - 1] };
      const moved = numbers[index];
      const movedX = moved[isFirstHandle ? 1 : 3], movedY = moved[isFirstHandle ? 2 : 4];
      const oppositeXIndex = isFirstHandle ? 3 : 1;
      const oppositeYIndex = oppositeXIndex + 1;
      const oldLength = Math.hypot(opposite[oppositeXIndex] - anchor.x, opposite[oppositeYIndex] - anchor.y);
      const movedLength = Math.hypot(movedX - anchor.x, movedY - anchor.y);
      if (movedLength < 1e-9) return result;
      const length = mode === 'symmetric' ? movedLength : oldLength;
      withAnchoredGeometry(controlsPath, new fabric.Point(anchor.x, anchor.y), () => {
        opposite[oppositeXIndex] = anchor.x - (movedX - anchor.x) * length / movedLength;
        opposite[oppositeYIndex] = anchor.y - (movedY - anchor.y) * length / movedLength;
      });
      return result;
    };
  });
  return controls;
}

export function setBezierNodeMode(path: fabric.Path, index: number, mode: 'cusp' | 'smooth' | 'symmetric'): boolean {
  const commands = path.path as unknown as SimplePathCommand[];
  const numbers = commands as unknown as number[][];
  const seam = closedPathSeam(commands);
  if (seam !== null && (index === 0 || index === seam)) {
    const anchor = { x: numbers[0][1], y: numbers[0][2] };
    if (mode !== 'cusp') {
      withAnchoredGeometry(path, new fabric.Point(anchor.x, anchor.y), () => {
        if (commands[seam][0] === 'L') {
          const previous = numbers[seam - 1];
          const start = { x: previous[previous.length - 2], y: previous[previous.length - 1] };
          commands[seam] = ['C', start.x + (anchor.x - start.x) / 3, start.y + (anchor.y - start.y) / 3,
            anchor.x - (anchor.x - start.x) / 3, anchor.y - (anchor.y - start.y) / 3, anchor.x, anchor.y];
        }
        if (commands[1][0] === 'L') {
          const end = { x: numbers[1][1], y: numbers[1][2] };
          commands[1] = ['C', anchor.x + (end.x - anchor.x) / 3, anchor.y + (end.y - anchor.y) / 3,
            end.x - (end.x - anchor.x) / 3, end.y - (end.y - anchor.y) / 3, end.x, end.y];
        }
        const incoming = numbers[seam];
        const outgoing = numbers[1];
        const dx = outgoing[1] - anchor.x;
        const dy = outgoing[2] - anchor.y;
        const outLength = Math.hypot(dx, dy);
        const inLength = Math.hypot(incoming[3] - anchor.x, incoming[4] - anchor.y);
        if (outLength > 1e-9) {
          const length = mode === 'symmetric' ? outLength : inLength;
          incoming[3] = anchor.x - dx * length / outLength;
          incoming[4] = anchor.y - dy * length / outLength;
        }
      });
    }
    setFabricMetadataValues(path, { bezierNodeModes: { ...getFabricMetadata(path).bezierNodeModes, 0: mode, [seam]: mode } });
    return true;
  }
  const command = numbers[index];
  if (!command || commands[index][0] === 'Z') return false;
  const anchor = { x: command[command.length - 2], y: command[command.length - 1] };
  if (mode !== 'cusp') {
    withAnchoredGeometry(path, new fabric.Point(anchor.x, anchor.y), () => {
      const previous = numbers[index - 1];
      if (commands[index][0] === 'L' && previous) {
        const start = { x: previous[previous.length - 2], y: previous[previous.length - 1] };
        commands[index] = ['C', start.x + (anchor.x - start.x) / 3, start.y + (anchor.y - start.y) / 3,
          anchor.x - (anchor.x - start.x) / 3, anchor.y - (anchor.y - start.y) / 3, anchor.x, anchor.y];
      }
      const next = numbers[index + 1];
      if (commands[index + 1]?.[0] === 'L') {
        const end = { x: next[1], y: next[2] };
        commands[index + 1] = ['C', anchor.x + (end.x - anchor.x) / 3, anchor.y + (end.y - anchor.y) / 3,
          end.x - (end.x - anchor.x) / 3, end.y - (end.y - anchor.y) / 3, end.x, end.y];
      }
      const incoming = numbers[index];
      const outgoing = numbers[index + 1];
      if (commands[index]?.[0] === 'C' && commands[index + 1]?.[0] === 'C') {
        const dx = outgoing[1] - anchor.x, dy = outgoing[2] - anchor.y;
        const outLength = Math.hypot(dx, dy);
        const inLength = Math.hypot(incoming[3] - anchor.x, incoming[4] - anchor.y);
        if (outLength > 1e-9) {
          const length = mode === 'symmetric' ? outLength : inLength;
          incoming[3] = anchor.x - dx * length / outLength;
          incoming[4] = anchor.y - dy * length / outLength;
        }
      }
    });
  }
  setFabricMetadataValues(path, { bezierNodeModes: { ...getFabricMetadata(path).bezierNodeModes, [index]: mode } });
  return true;
}

function buildControlsFor(
  object: NodeEditableObject,
  snapPoint: SnapPointFn,
): Record<string, fabric.Control> {
  if (object instanceof fabric.Line) return buildLineControls(snapPoint);
  if (object instanceof fabric.Polyline) return buildPolyControls(object, snapPoint);
  return buildPathControls(object, snapPoint);
}

interface SavedInteractionState {
  hasBorders: boolean;
  hasControls: boolean;
  hadOwnControls: boolean;
  controls: Record<string, fabric.Control>;
}

const nodeEditState = new WeakMap<fabric.FabricObject, SavedInteractionState>();

export function hasNodeEditControls(object: fabric.FabricObject): boolean {
  return nodeEditState.has(object);
}

/** Swaps the object's transform controls for per-node handles. */
export function attachNodeEditControls(object: NodeEditableObject, snapPoint: SnapPointFn): void {
  if (!nodeEditState.has(object)) {
    nodeEditState.set(object, {
      hasBorders: object.hasBorders,
      hasControls: object.hasControls,
      hadOwnControls: Object.prototype.hasOwnProperty.call(object, 'controls'),
      controls: object.controls,
    });
  }
  object.controls = buildControlsFor(object, snapPoint);
  // Whole-object translation is suppressed by the node-edit interaction layer
  // (an object:moving guard) rather than via lockMovementX/Y, because the
  // legacy lock bridge would persist those flags as metadata.locked on the
  // next history snapshot.
  object.set({
    hasBorders: false,
    hasControls: true,
  });
  object.setCoords();
}

/** Rebuilds node handles after the node count changed. */
export function refreshNodeEditControls(object: NodeEditableObject, snapPoint: SnapPointFn): void {
  if (!nodeEditState.has(object)) return;
  object.controls = buildControlsFor(object, snapPoint);
  object.setCoords();
}

/** Restores the interaction state saved by attachNodeEditControls. */
export function detachNodeEditControls(object: fabric.FabricObject): void {
  const saved = nodeEditState.get(object);
  if (!saved) return;
  nodeEditState.delete(object);
  if (saved.hadOwnControls) {
    object.controls = saved.controls;
  } else {
    delete (object as { controls?: Record<string, fabric.Control> }).controls;
  }
  object.set({
    hasBorders: saved.hasBorders,
    hasControls: saved.hasControls,
  });
  object.setCoords();
}

function pathOffsetOf(object: fabric.Polyline | fabric.Path): fabric.Point {
  return object.pathOffset ?? new fabric.Point(0, 0);
}

function rawLocalToScene(
  object: fabric.Polyline | fabric.Path,
  point: { x: number; y: number },
): { x: number; y: number } {
  const offset = pathOffsetOf(object);
  const transformed = fabric.util.transformPoint(
    new fabric.Point(point.x - offset.x, point.y - offset.y),
    object.calcTransformMatrix(),
  );
  return { x: transformed.x, y: transformed.y };
}

/** All draggable/removable anchors in scene coordinates. */
export function listNodesInScene(object: NodeEditableObject): SceneNode[] {
  if (object instanceof fabric.Line) {
    const matrix = object.calcTransformMatrix();
    return (['start', 'end'] as const).map((end) => {
      const point = lineLocalPoint(object, end).transform(matrix);
      return { ref: { type: 'line', end }, point: { x: point.x, y: point.y } };
    });
  }
  if (object instanceof fabric.Polyline) {
    return object.points.map((point, index) => ({
      ref: { type: 'poly', index },
      point: rawLocalToScene(object, point),
    }));
  }
  const commands = object.path as unknown as SimplePathCommand[];
  const seam = closedPathSeam(commands);
  return listPathAnchors(commands).filter((anchor) => anchor.commandIndex !== seam).map((anchor) => ({
    ref: { type: 'path', commandIndex: anchor.commandIndex },
    point: rawLocalToScene(object, anchor.point),
  }));
}

function sceneDistanceSquared(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function findNodeAtScenePoint(
  object: NodeEditableObject,
  scenePoint: { x: number; y: number },
  toleranceScene: number,
): NodeRef | null {
  let best: NodeRef | null = null;
  let bestDistance = toleranceScene * toleranceScene;
  for (const node of listNodesInScene(object)) {
    const distance = sceneDistanceSquared(node.point, scenePoint);
    if (distance <= bestDistance) {
      best = node.ref;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Re-anchors the object's position after a geometry mutation. `anchorRaw`
 * must be a raw-local coordinate whose value is unchanged by the mutation.
 */
function withAnchoredGeometry<T>(
  object: fabric.Polyline | fabric.Path,
  anchorRaw: fabric.Point,
  mutate: () => T,
): T {
  const before = anchorRaw.subtract(pathOffsetOf(object)).transform(object.calcOwnMatrix());
  const result = mutate();
  object.setDimensions();
  const after = anchorRaw.subtract(pathOffsetOf(object)).transform(object.calcOwnMatrix());
  object.left -= after.x - before.x;
  object.top -= after.y - before.y;
  object.set('dirty', true);
  object.setCoords();
  return result;
}

/**
 * Inserts a vertex on the polyline/polygon segment nearest to the pointer.
 * Returns the inserted vertex index, or null when no segment is close enough.
 */
export function insertPolylineNode(
  poly: fabric.Polyline,
  scenePoint: { x: number; y: number },
  toleranceScene: number,
): number | null {
  const scenePoints = poly.points.map((point) => rawLocalToScene(poly, point));
  const closed = poly instanceof fabric.Polygon;
  const segmentCount = closed ? scenePoints.length : scenePoints.length - 1;
  let bestIndex = -1;
  let bestT = 0;
  let bestDistance = toleranceScene * toleranceScene;

  for (let index = 0; index < segmentCount; index += 1) {
    const start = scenePoints[index];
    const end = scenePoints[(index + 1) % scenePoints.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= Number.EPSILON) continue;
    const t = Math.min(1, Math.max(0,
      ((scenePoint.x - start.x) * dx + (scenePoint.y - start.y) * dy) / lengthSquared));
    const projected = { x: start.x + dx * t, y: start.y + dy * t };
    const distance = sceneDistanceSquared(projected, scenePoint);
    if (distance <= bestDistance) {
      bestIndex = index;
      bestT = t;
      bestDistance = distance;
    }
  }
  if (bestIndex < 0) return null;

  const localStart = poly.points[bestIndex];
  const localEnd = poly.points[(bestIndex + 1) % poly.points.length];
  const inserted = {
    x: localStart.x + (localEnd.x - localStart.x) * bestT,
    y: localStart.y + (localEnd.y - localStart.y) * bestT,
  };
  const anchorRaw = new fabric.Point(localStart.x, localStart.y);
  withAnchoredGeometry(poly, anchorRaw, () => {
    poly.points.splice(bestIndex + 1, 0, inserted);
  });
  return bestIndex + 1;
}

/** Removes a polyline/polygon vertex. Refuses below the minimum vertex count. */
export function deletePolylineNode(poly: fabric.Polyline, index: number): boolean {
  const minimum = poly instanceof fabric.Polygon ? 3 : 2;
  if (poly.points.length - 1 < minimum) return false;
  if (index < 0 || index >= poly.points.length) return false;
  const survivorIndex = index === 0 ? 1 : 0;
  const survivor = poly.points[survivorIndex];
  const anchorRaw = new fabric.Point(survivor.x, survivor.y);
  withAnchoredGeometry(poly, anchorRaw, () => {
    poly.points.splice(index, 1);
  });
  return true;
}

/**
 * Inserts an anchor on the path segment nearest to the pointer without
 * changing the drawn geometry (de Casteljau split for curve segments).
 * Returns the command index of the new anchor, or null when nothing is near.
 */
export function insertPathNode(
  path: fabric.Path,
  scenePoint: { x: number; y: number },
  toleranceScene: number,
): number | null {
  const commands = path.path as unknown as SimplePathCommand[];
  const segments = listPathSegments(commands);
  if (segments.length === 0) return null;

  // Compare candidate segments in scene space: with a non-uniform scale or
  // skew the raw-local distance order does not match what the user sees.
  // Affine transforms map Béziers to Béziers and preserve the parameter t,
  // so the scene-space t can split the raw-local segment directly.
  const toScene = (point: PathPoint): PathPoint => rawLocalToScene(path, point);
  const sceneSegments = segments.map((segment) => ({
    ...segment,
    start: toScene(segment.start),
    end: toScene(segment.end),
    control1: segment.control1 ? toScene(segment.control1) : undefined,
    control2: segment.control2 ? toScene(segment.control2) : undefined,
  }));
  const sceneHit = findNearestPointOnSegments(sceneSegments, scenePoint);
  if (!sceneHit || sceneHit.distanceSquared > toleranceScene * toleranceScene) return null;

  const segment = segments[sceneHit.segmentIndex];
  const hit: NearestPathPointHit = {
    segment,
    t: sceneHit.t,
    point: pointOnSegment(segment, sceneHit.t),
    distanceSquared: sceneHit.distanceSquared,
  };

  const anchors = listPathAnchors(commands);
  if (anchors.length === 0) return null;
  const anchorRaw = new fabric.Point(anchors[0].point.x, anchors[0].point.y);
  const insertedIndex = withAnchoredGeometry(path, anchorRaw, () => insertAnchorOnSegment(commands, hit));
  if (insertedIndex !== null) {
    const modes = getFabricMetadata(path).bezierNodeModes;
    if (modes) setFabricMetadataValues(path, { bezierNodeModes: Object.fromEntries(
      Object.entries(modes).map(([key, mode]) => [String(Number(key) >= insertedIndex ? Number(key) + 1 : Number(key)), mode])
        .concat([[String(insertedIndex), 'smooth']]),
    ) as typeof modes });
  }
  return insertedIndex;
}

/** Removes a path anchor. Refuses below the per-subpath minimum anchor count. */
export function deletePathNode(path: fabric.Path, commandIndex: number): boolean {
  const commands = path.path as unknown as SimplePathCommand[];
  const seam = closedPathSeam(commands);
  if (seam !== null && (commandIndex === 0 || commandIndex === seam)) {
    if (seam <= 3) return false;
    const next = commands[1];
    const x = next[next.length - 2] as number;
    const y = next[next.length - 1] as number;
    withAnchoredGeometry(path, new fabric.Point(x, y), () => {
      commands.splice(0, 2, ['M', x, y]);
      commands.splice(seam - 1, 1);
    });
    const modes = getFabricMetadata(path).bezierNodeModes;
    if (modes) setFabricMetadataValues(path, { bezierNodeModes: Object.fromEntries(
      Object.entries(modes).filter(([key]) => Number(key) > 0 && Number(key) < seam)
        .map(([key, value]) => [String(Number(key) - 1), value]),
    ) as typeof modes });
    return true;
  }
  const survivors = listPathAnchors(commands)
    .filter((anchor) => anchor.commandIndex !== commandIndex);
  if (survivors.length === 0) return false;
  const survivor = survivors[survivors.length - 1];
  const anchorRaw = new fabric.Point(survivor.point.x, survivor.point.y);
  let deleted = false;
  withAnchoredGeometry(path, anchorRaw, () => {
    deleted = deletePathAnchor(commands, commandIndex);
  });
  if (deleted) {
    const modes = getFabricMetadata(path).bezierNodeModes;
    if (modes) setFabricMetadataValues(path, { bezierNodeModes: Object.fromEntries(
      Object.entries(modes).filter(([key]) => Number(key) !== commandIndex)
        .map(([key, mode]) => [String(Number(key) > commandIndex ? Number(key) - 1 : Number(key)), mode]),
    ) as typeof modes });
  }
  return deleted;
}

/**
 * Replaces a line with an equivalent polyline that has one extra vertex at the
 * pointer position. Style, id and metadata are carried over so semantic
 * references stay resolvable. Returns null when the pointer is too far from
 * the line or on top of an endpoint.
 */
export function convertLineToPolylineWithNode(
  line: fabric.Line,
  scenePoint: { x: number; y: number },
  toleranceScene: number,
): fabric.Polyline | null {
  const matrix = line.calcTransformMatrix();
  const start = lineLocalPoint(line, 'start').transform(matrix);
  const end = lineLocalPoint(line, 'end').transform(matrix);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= Number.EPSILON) return null;
  const t = ((scenePoint.x - start.x) * dx + (scenePoint.y - start.y) * dy) / lengthSquared;
  if (t <= 0 || t >= 1) return null;
  const projected = { x: start.x + dx * t, y: start.y + dy * t };
  if (sceneDistanceSquared(projected, scenePoint) > toleranceScene * toleranceScene) return null;

  // Build the polyline in the line's own local space and carry the whole
  // transform over, so stroke rendering (strokeUniform, dashes, shadow) and
  // any scale/skew stay exactly as they were. The affine parameter t places
  // the new vertex at the projected scene position.
  const localStart = { x: line.x1, y: line.y1 };
  const localEnd = { x: line.x2, y: line.y2 };
  const localInserted = {
    x: localStart.x + (localEnd.x - localStart.x) * t,
    y: localStart.y + (localEnd.y - localStart.y) * t,
  };
  const sceneCenter = line.getCenterPoint();
  const polyline = new fabric.Polyline(
    [localStart, localInserted, localEnd],
    {
      fill: '',
      stroke: line.stroke as string | null ?? undefined,
      strokeWidth: line.strokeWidth,
      strokeDashArray: line.strokeDashArray ? [...line.strokeDashArray] : undefined,
      strokeDashOffset: line.strokeDashOffset,
      strokeLineCap: line.strokeLineCap,
      strokeLineJoin: line.strokeLineJoin,
      strokeMiterLimit: line.strokeMiterLimit,
      opacity: line.opacity,
      visible: line.visible,
      shadow: line.shadow ?? undefined,
      clipPath: line.clipPath,
      angle: line.angle,
      scaleX: line.scaleX,
      scaleY: line.scaleY,
      skewX: line.skewX,
      skewY: line.skewY,
      flipX: line.flipX,
      flipY: line.flipY,
    },
  );
  const metadata = getFabricMetadata(line);
  applyObjectDefaults(polyline, metadata.id ?? generateObjectId('polyline'), 'polyline');
  // applyObjectDefaults standardises strokeUniform for newly drawn shapes;
  // a conversion must keep the source line's rendering instead.
  polyline.set({ strokeUniform: line.strokeUniform });
  setFabricMetadataValues(polyline, { name: metadata.name, locked: metadata.locked });
  // A collinear inserted vertex leaves the local bbox unchanged, so pinning
  // the centre reproduces the line's exact scene geometry.
  polyline.setPositionByOrigin(sceneCenter, 'center', 'center');
  polyline.setCoords();
  return polyline;
}

type SemanticAnchorUpdate = (anchor: SemanticAnchor) => SemanticAnchor;

function updateSemanticAnchorsForObject(
  canvas: fabric.Canvas,
  objectId: string,
  update: SemanticAnchorUpdate,
): void {
  const apply = (anchor: SemanticAnchor): SemanticAnchor => (
    anchor.objectId === objectId ? update(anchor) : anchor
  );
  collectFabricObjectTree(canvas.getObjects()).forEach((object) => {
    const metadata = getFabricMetadata(object);
    if (metadata.dimensionData) {
      setFabricMetadataValues(object, {
        dimensionData: {
          ...metadata.dimensionData,
          start: apply(metadata.dimensionData.start),
          end: apply(metadata.dimensionData.end),
        },
      });
    }
    if (metadata.connectorData) {
      setFabricMetadataValues(object, {
        connectorData: {
          ...metadata.connectorData,
          from: apply(metadata.connectorData.from),
          to: apply(metadata.connectorData.to),
        },
      });
    }
  });
}

function staticAnchor(anchor: SemanticAnchor): SemanticAnchor {
  return { x: anchor.x, y: anchor.y };
}

/**
 * Keeps vertex-bound dimensions/connectors pointing at the same node after an
 * insert. Midpoint references name the segment's start vertex, so the split
 * segment's midpoint (which no longer exists) detaches to its coordinates and
 * only later segments shift.
 */
export function shiftVertexAnchorsAfterInsert(
  canvas: fabric.Canvas,
  objectId: string,
  insertedIndex: number,
): void {
  updateSemanticAnchorsForObject(canvas, objectId, (anchor) => {
    if (anchor.vertexIndex === undefined) return anchor;
    if (anchor.anchor === 'midpoint') {
      if (anchor.vertexIndex === insertedIndex - 1) return staticAnchor(anchor);
      if (anchor.vertexIndex >= insertedIndex) return { ...anchor, vertexIndex: anchor.vertexIndex + 1 };
      return anchor;
    }
    if (anchor.vertexIndex < insertedIndex) return anchor;
    return { ...anchor, vertexIndex: anchor.vertexIndex + 1 };
  });
}

export interface VertexDeleteContext {
  /** True for closed polygons, whose last segment wraps back to vertex 0. */
  closed: boolean;
  /** Vertex count before the deletion. */
  pointCountBefore: number;
}

/** Shifts or detaches vertex- and midpoint-bound references after a node deletion. */
export function retargetVertexAnchorsAfterDelete(
  canvas: fabric.Canvas,
  objectId: string,
  deletedIndex: number,
  context?: VertexDeleteContext,
): void {
  // Both segments adjacent to the deleted vertex merge into one, so their
  // midpoints detach instead of silently following the merged segment.
  const previousSegmentIndex = deletedIndex > 0
    ? deletedIndex - 1
    : (context?.closed ? context.pointCountBefore - 1 : -1);
  updateSemanticAnchorsForObject(canvas, objectId, (anchor) => {
    if (anchor.vertexIndex === undefined) return anchor;
    if (anchor.anchor === 'midpoint') {
      if (anchor.vertexIndex === deletedIndex || anchor.vertexIndex === previousSegmentIndex) {
        return staticAnchor(anchor);
      }
      if (anchor.vertexIndex > deletedIndex) return { ...anchor, vertexIndex: anchor.vertexIndex - 1 };
      return anchor;
    }
    if (anchor.vertexIndex < deletedIndex) return anchor;
    if (anchor.vertexIndex === deletedIndex) return staticAnchor(anchor);
    return { ...anchor, vertexIndex: anchor.vertexIndex - 1 };
  });
}

/** Rebinds line start/end references onto the replacing polyline's vertices. */
export function remapLineAnchorsToPolyline(
  canvas: fabric.Canvas,
  objectId: string,
  lastVertexIndex: number,
): void {
  updateSemanticAnchorsForObject(canvas, objectId, (anchor) => {
    if (anchor.anchor === 'start') return { ...anchor, anchor: 'vertex', vertexIndex: 0 };
    if (anchor.anchor === 'end') return { ...anchor, anchor: 'vertex', vertexIndex: lastVertexIndex };
    if (anchor.anchor === 'midpoint') return staticAnchor(anchor);
    return anchor;
  });
}
