import * as fabric from 'fabric';
import { mmToUnit } from '../types';
import type {
  ConnectorData,
  ConnectorRoute,
  DimensionData,
  SemanticAnchor,
} from './fabricObjectMetadata';
import {
  getFabricMetadata,
  setFabricMetadataValues,
} from './fabricObjectMetadata';
import { resolveSemanticAnchorFromIndex } from './cadSnapping';
import { collectFabricObjectTree } from './fabricObjectTree';
import type { EditorStyle } from './stylePresets';
import { DEFAULT_EDITOR_STYLE } from './stylePresets';

export type DimensionLabelFormatter = (distance: number) => string;

export const formatDefaultDimensionLabel: DimensionLabelFormatter = (distance) => (
  Math.round(distance).toString()
);

function formatDimensionDistance(
  distance: number,
  data: DimensionData,
  fallback: DimensionLabelFormatter,
): string {
  if (!data.unit) return fallback(distance);
  const precision = Math.max(0, Math.min(6, data.precision ?? 0));
  const value = mmToUnit(distance, data.unit);
  return `${value.toFixed(precision)} ${data.unit}`;
}

function distanceBetween(
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

function createDimensionChildren(
  start: { x: number; y: number },
  end: { x: number; y: number },
  labelText: string,
  style: EditorStyle,
): fabric.FabricObject[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const angle = Math.atan2(dy, dx);
  const perpendicular = angle + Math.PI / 2;
  const tickLength = 6;
  const tickDx = tickLength * Math.cos(perpendicular);
  const tickDy = tickLength * Math.sin(perpendicular);
  const labelOffset = 8;

  const mainLine = new fabric.Line([start.x, start.y, end.x, end.y], {
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    strokeDashArray: style.strokeDashArray ? [...style.strokeDashArray] : undefined,
    opacity: style.opacity,
    fill: '',
  });
  const startTick = new fabric.Line([
    start.x + tickDx,
    start.y + tickDy,
    start.x - tickDx,
    start.y - tickDy,
  ], {
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    strokeDashArray: style.strokeDashArray ? [...style.strokeDashArray] : undefined,
    opacity: style.opacity,
    fill: '',
  });
  const endTick = new fabric.Line([
    end.x + tickDx,
    end.y + tickDy,
    end.x - tickDx,
    end.y - tickDy,
  ], {
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    strokeDashArray: style.strokeDashArray ? [...style.strokeDashArray] : undefined,
    opacity: style.opacity,
    fill: '',
  });
  const label = new fabric.Text(labelText, {
    left: (start.x + end.x) / 2 + labelOffset * Math.cos(perpendicular),
    top: (start.y + end.y) / 2 + labelOffset * Math.sin(perpendicular),
    fontSize: Math.max(8, style.fontSize / 2),
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle as '' | 'normal' | 'italic' | 'oblique',
    fill: style.stroke,
    opacity: style.opacity,
    originX: 'center',
    originY: 'bottom',
    angle: angle * 180 / Math.PI,
  });
  return [mainLine, startTick, endTick, label];
}

function connectorPoints(
  from: { x: number; y: number },
  to: { x: number; y: number },
  route: ConnectorRoute,
): { x: number; y: number }[] {
  if (route === 'straight') return [from, to];
  const deltaX = Math.abs(to.x - from.x);
  const deltaY = Math.abs(to.y - from.y);
  return deltaX >= deltaY
    ? [from, { x: (from.x + to.x) / 2, y: from.y }, { x: (from.x + to.x) / 2, y: to.y }, to]
    : [from, { x: from.x, y: (from.y + to.y) / 2 }, { x: to.x, y: (from.y + to.y) / 2 }, to];
}

function createConnectorChildren(
  from: { x: number; y: number },
  to: { x: number; y: number },
  route: ConnectorRoute,
  style: EditorStyle,
): fabric.FabricObject[] {
  const points = connectorPoints(from, to, route);
  const lines: fabric.FabricObject[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    lines.push(new fabric.Line([start.x, start.y, end.x, end.y], {
      stroke: style.stroke,
      strokeWidth: style.strokeWidth,
      strokeDashArray: style.strokeDashArray ? [...style.strokeDashArray] : undefined,
      opacity: style.opacity,
      fill: '',
    }));
  }
  return lines;
}

function replaceGroupChildren(
  group: fabric.Group,
  children: fabric.FabricObject[],
): void {
  // Semantic groups are governed by their anchors.  Reset accidental group
  // transforms before fitting the replacement geometry to document space.
  group.set({
    angle: 0,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
    skewY: 0,
    flipX: false,
    flipY: false,
  });
  group.removeAll();
  group.add(...children);
  group.triggerLayout();
  group.setCoords();
  group.dirty = true;
}

function readSemanticStyle(group: fabric.Group): EditorStyle {
  const children = group.getObjects();
  const line = children.find((child) => child instanceof fabric.Line);
  const label = children.find((child) => child instanceof fabric.Text) as fabric.Text | undefined;
  return {
    ...DEFAULT_EDITOR_STYLE,
    stroke: typeof line?.stroke === 'string' ? line.stroke : DEFAULT_EDITOR_STYLE.stroke,
    strokeWidth: line?.strokeWidth ?? DEFAULT_EDITOR_STYLE.strokeWidth,
    strokeDashArray: line?.strokeDashArray ? [...line.strokeDashArray] : undefined,
    opacity: line?.opacity ?? DEFAULT_EDITOR_STYLE.opacity,
    fontFamily: label?.fontFamily ?? DEFAULT_EDITOR_STYLE.fontFamily,
    fontSize: label ? label.fontSize * 2 : DEFAULT_EDITOR_STYLE.fontSize,
    fontWeight: label?.fontWeight ?? DEFAULT_EDITOR_STYLE.fontWeight,
    fontStyle: label?.fontStyle ?? DEFAULT_EDITOR_STYLE.fontStyle,
  };
}

export function createSemanticDimension(
  data: DimensionData,
  formatLabel: DimensionLabelFormatter,
  style: EditorStyle = DEFAULT_EDITOR_STYLE,
): fabric.Group | null {
  const distance = distanceBetween(data.start, data.end);
  if (distance < 5) return null;
  const group = new fabric.Group(
    createDimensionChildren(
      data.start,
      data.end,
      formatDimensionDistance(distance, data, formatLabel),
      style,
    ),
    {
      lockMovementX: true,
      lockMovementY: true,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
      hasControls: false,
    },
  );
  setFabricMetadataValues(group, { objectKind: 'dimension', locked: true, dimensionData: data });
  return group;
}

export function createSemanticConnector(
  data: ConnectorData,
  style: EditorStyle = DEFAULT_EDITOR_STYLE,
): fabric.Group | null {
  if (distanceBetween(data.from, data.to) < 2) return null;
  const group = new fabric.Group(createConnectorChildren(data.from, data.to, data.route, style), {
    lockMovementX: true,
    lockMovementY: true,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
    hasControls: false,
  });
  setFabricMetadataValues(group, { objectKind: 'connector', locked: true, connectorData: data });
  return group;
}

function refreshDimension(
  group: fabric.Group,
  data: DimensionData,
  objectIndex: ReadonlyMap<string, fabric.FabricObject>,
  formatLabel: DimensionLabelFormatter,
  force = false,
): boolean {
  const start = resolveSemanticAnchorFromIndex(data.start, objectIndex);
  const end = resolveSemanticAnchorFromIndex(data.end, objectIndex);
  const changed = force
    || start.x !== data.start.x
    || start.y !== data.start.y
    || end.x !== data.end.x
    || end.y !== data.end.y;
  if (!changed) return false;

  const updated: DimensionData = {
    ...data,
    start: { ...data.start, ...start },
    end: { ...data.end, ...end },
  };
  replaceGroupChildren(
    group,
    createDimensionChildren(
      start,
      end,
      formatDimensionDistance(distanceBetween(start, end), data, formatLabel),
      readSemanticStyle(group),
    ),
  );
  setFabricMetadataValues(group, { dimensionData: updated });
  return true;
}

function refreshConnector(
  group: fabric.Group,
  data: ConnectorData,
  objectIndex: ReadonlyMap<string, fabric.FabricObject>,
  force = false,
): boolean {
  const from = resolveSemanticAnchorFromIndex(data.from, objectIndex);
  const to = resolveSemanticAnchorFromIndex(data.to, objectIndex);
  const changed = force
    || from.x !== data.from.x
    || from.y !== data.from.y
    || to.x !== data.to.x
    || to.y !== data.to.y;
  if (!changed) return false;

  const updated: ConnectorData = {
    ...data,
    from: { ...data.from, ...from },
    to: { ...data.to, ...to },
  };
  replaceGroupChildren(
    group,
    createConnectorChildren(
      from,
      to,
      data.route,
      readSemanticStyle(group),
    ),
  );
  setFabricMetadataValues(group, { connectorData: updated });
  return true;
}

interface SemanticEntry {
  group: fabric.Group;
  id?: string;
  kind: 'dimension' | 'connector';
}

type SemanticGraph = Map<SemanticEntry, Set<SemanticEntry>>;

const MAX_CYCLIC_RELAXATION_PASSES = 4;

function semanticEntryAnchors(entry: SemanticEntry): readonly SemanticAnchor[] {
  const metadata = getFabricMetadata(entry.group);
  if (entry.kind === 'dimension' && metadata.dimensionData) {
    return [metadata.dimensionData.start, metadata.dimensionData.end];
  }
  if (entry.kind === 'connector' && metadata.connectorData) {
    return [metadata.connectorData.from, metadata.connectorData.to];
  }
  return [];
}

function refreshSemanticEntry(
  entry: SemanticEntry,
  objectIndex: ReadonlyMap<string, fabric.FabricObject>,
  formatLabel: DimensionLabelFormatter,
  force = false,
): boolean {
  const metadata = getFabricMetadata(entry.group);
  if (entry.kind === 'dimension' && metadata.dimensionData) {
    return refreshDimension(
      entry.group,
      metadata.dimensionData,
      objectIndex,
      formatLabel,
      force,
    );
  }
  if (entry.kind === 'connector' && metadata.connectorData) {
    return refreshConnector(
      entry.group,
      metadata.connectorData,
      objectIndex,
      force,
    );
  }
  return false;
}

/**
 * Collapse the affected semantic graph into strongly-connected components and
 * return those components in upstream-to-downstream order. Both DFS passes are
 * iterative so a large dependency chain cannot overflow the JavaScript stack.
 */
function orderSemanticComponents(
  entries: readonly SemanticEntry[],
  downstream: SemanticGraph,
): SemanticEntry[][] {
  const included = new Set(entries);
  const downstreamWithin = new Map<SemanticEntry, SemanticEntry[]>();
  const upstreamWithin = new Map<SemanticEntry, SemanticEntry[]>();
  entries.forEach((entry) => {
    const targets = [...(downstream.get(entry) ?? [])]
      .filter((target) => included.has(target));
    downstreamWithin.set(entry, targets);
    targets.forEach((target) => {
      const sources = upstreamWithin.get(target);
      if (sources) sources.push(entry);
      else upstreamWithin.set(target, [entry]);
    });
  });

  const visited = new Set<SemanticEntry>();
  const finishOrder: SemanticEntry[] = [];
  for (const start of entries) {
    if (visited.has(start)) continue;
    visited.add(start);
    const stack: Array<{ entry: SemanticEntry; next: number }> = [{ entry: start, next: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const targets = downstreamWithin.get(frame.entry) ?? [];
      if (frame.next < targets.length) {
        const target = targets[frame.next];
        frame.next += 1;
        if (!visited.has(target)) {
          visited.add(target);
          stack.push({ entry: target, next: 0 });
        }
      } else {
        finishOrder.push(frame.entry);
        stack.pop();
      }
    }
  }

  const assigned = new Set<SemanticEntry>();
  const components: SemanticEntry[][] = [];
  for (let index = finishOrder.length - 1; index >= 0; index -= 1) {
    const start = finishOrder[index];
    if (assigned.has(start)) continue;
    const component: SemanticEntry[] = [];
    const stack = [start];
    assigned.add(start);
    while (stack.length > 0) {
      const entry = stack.pop()!;
      component.push(entry);
      for (const source of upstreamWithin.get(entry) ?? []) {
        if (assigned.has(source)) continue;
        assigned.add(source);
        stack.push(source);
      }
    }
    components.push(component);
  }

  // Kosaraju already emits source components first. Kahn ordering makes that
  // contract explicit and robust to future traversal changes.
  const componentByEntry = new Map<SemanticEntry, number>();
  components.forEach((component, componentIndex) => {
    component.forEach((entry) => componentByEntry.set(entry, componentIndex));
  });
  const componentEdges = components.map(() => new Set<number>());
  const indegrees = components.map(() => 0);
  entries.forEach((entry) => {
    const from = componentByEntry.get(entry)!;
    for (const target of downstreamWithin.get(entry) ?? []) {
      const to = componentByEntry.get(target)!;
      if (from === to || componentEdges[from].has(to)) continue;
      componentEdges[from].add(to);
      indegrees[to] += 1;
    }
  });
  const ready: number[] = [];
  indegrees.forEach((indegree, componentIndex) => {
    if (indegree === 0) ready.push(componentIndex);
  });
  const ordered: SemanticEntry[][] = [];
  for (let cursor = 0; cursor < ready.length; cursor += 1) {
    const componentIndex = ready[cursor];
    ordered.push(components[componentIndex]);
    componentEdges[componentIndex].forEach((target) => {
      indegrees[target] -= 1;
      if (indegrees[target] === 0) ready.push(target);
    });
  }
  return ordered;
}

export function updateLinkedSemanticObjects(
  canvas: fabric.Canvas,
  formatLabel: DimensionLabelFormatter = formatDefaultDimensionLabel,
  changedObjectIds?: string | readonly string[],
): boolean {
  const requestedIds = changedObjectIds === undefined
    ? null
    : typeof changedObjectIds === 'string'
      ? [changedObjectIds]
      : changedObjectIds;
  if (requestedIds?.length === 0) return false;

  const objects = collectFabricObjectTree(canvas.getObjects());
  const objectIndex = new Map<string, fabric.FabricObject>();
  const semanticEntries: SemanticEntry[] = [];

  for (const object of objects) {
    const metadata = getFabricMetadata(object);
    if (metadata.id) objectIndex.set(metadata.id, object);
    if (!(object instanceof fabric.Group)) continue;
    if (metadata.objectKind === 'dimension' && metadata.dimensionData) {
      semanticEntries.push({
        group: object,
        id: metadata.id,
        kind: 'dimension',
      });
    } else if (metadata.objectKind === 'connector' && metadata.connectorData) {
      semanticEntries.push({
        group: object,
        id: metadata.id,
        kind: 'connector',
      });
    }
  }
  if (semanticEntries.length === 0) return false;

  const entriesById = new Map<string, Set<SemanticEntry>>();
  const dependentsById = new Map<string, Set<SemanticEntry>>();
  const append = (
    index: Map<string, Set<SemanticEntry>>,
    id: string | undefined,
    entry: SemanticEntry,
  ): void => {
    if (!id) return;
    const entries = index.get(id);
    if (entries) entries.add(entry);
    else index.set(id, new Set([entry]));
  };
  for (const entry of semanticEntries) {
    append(entriesById, entry.id, entry);
    semanticEntryAnchors(entry).forEach((anchor) => (
      append(dependentsById, anchor.objectId, entry)
    ));
  }
  const downstream: SemanticGraph = new Map();
  semanticEntries.forEach((entry) => {
    downstream.set(
      entry,
      entry.id ? new Set(dependentsById.get(entry.id) ?? []) : new Set(),
    );
  });

  const forced = new Set<SemanticEntry>();
  let affected: Set<SemanticEntry>;
  if (!requestedIds) {
    affected = new Set(semanticEntries);
  } else {
    const changedIds = new Set(requestedIds);
    // A group/selection transform changes the document geometry of every
    // descendant even though Fabric only reports the wrapper as the target.
    for (const id of requestedIds) {
      const object = objectIndex.get(id);
      if (!(object instanceof fabric.Group || object instanceof fabric.ActiveSelection)) continue;
      collectFabricObjectTree([object]).forEach((descendant) => {
        const descendantId = getFabricMetadata(descendant).id;
        if (descendantId) changedIds.add(descendantId);
      });
    }

    affected = new Set();
    changedIds.forEach((id) => {
      entriesById.get(id)?.forEach((entry) => {
        forced.add(entry);
        affected.add(entry);
      });
      dependentsById.get(id)?.forEach((entry) => affected.add(entry));
    });
    // Include all semantic descendants before ordering them. Scheduling while
    // refreshing makes correctness depend on roots/changed-ID iteration order.
    const closureQueue = [...affected];
    for (let cursor = 0; cursor < closureQueue.length; cursor += 1) {
      downstream.get(closureQueue[cursor])?.forEach((dependent) => {
        if (affected.has(dependent)) return;
        affected.add(dependent);
        closureQueue.push(dependent);
      });
    }
  }

  let changed = false;
  const components = orderSemanticComponents([...affected], downstream);
  for (const component of components) {
    const cyclic = component.length > 1
      || Boolean(downstream.get(component[0])?.has(component[0]));
    const passes = cyclic ? MAX_CYCLIC_RELAXATION_PASSES : 1;
    for (let pass = 0; pass < passes; pass += 1) {
      let passChanged = false;
      for (const entry of component) {
        const entryChanged = refreshSemanticEntry(
          entry,
          objectIndex,
          formatLabel,
          pass === 0 && forced.has(entry),
        );
        passChanged = entryChanged || passChanged;
        changed = entryChanged || changed;
      }
      if (!passChanged) break;
    }
  }
  if (changed) canvas.requestRenderAll();
  return changed;
}
