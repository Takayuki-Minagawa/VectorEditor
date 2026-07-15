import * as fabric from 'fabric';
import { mmToUnit } from '../types';
import type {
  ConnectorData,
  ConnectorRoute,
  DimensionData,
} from './fabricObjectMetadata';
import {
  getFabricMetadata,
  setFabricMetadataValues,
} from './fabricObjectMetadata';
import { resolveSemanticAnchor } from './cadSnapping';
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
  objects: readonly fabric.FabricObject[],
  formatLabel: DimensionLabelFormatter,
): boolean {
  const start = resolveSemanticAnchor(data.start, objects);
  const end = resolveSemanticAnchor(data.end, objects);
  const changed = start.x !== data.start.x
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
  objects: readonly fabric.FabricObject[],
): boolean {
  const from = resolveSemanticAnchor(data.from, objects);
  const to = resolveSemanticAnchor(data.to, objects);
  const changed = from.x !== data.from.x
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

export function updateLinkedSemanticObjects(
  canvas: fabric.Canvas,
  formatLabel: DimensionLabelFormatter = formatDefaultDimensionLabel,
  changedObjectId?: string,
): boolean {
  const objects = collectFabricObjectTree(canvas.getObjects());
  const changedIds = changedObjectId ? new Set([changedObjectId]) : null;
  if (changedIds) {
    const changedObject = objects.find(
      (object) => getFabricMetadata(object).id === changedObjectId,
    );
    if (changedObject instanceof fabric.Group || changedObject instanceof fabric.ActiveSelection) {
      collectFabricObjectTree([changedObject]).forEach((object) => {
        const id = getFabricMetadata(object).id;
        if (id) changedIds.add(id);
      });
    }
  }
  const referencesChangedObject = (objectId?: string): boolean => (
    !changedIds || Boolean(objectId && changedIds.has(objectId))
  );
  let changed = false;
  for (const object of objects) {
    if (!(object instanceof fabric.Group)) continue;
    const metadata = getFabricMetadata(object);
    if (metadata.objectKind === 'dimension' && metadata.dimensionData) {
      const { start, end } = metadata.dimensionData;
      if (
        changedIds
        && !referencesChangedObject(start.objectId)
        && !referencesChangedObject(end.objectId)
      ) continue;
      changed = refreshDimension(object, metadata.dimensionData, objects, formatLabel) || changed;
    }
    if (metadata.objectKind === 'connector' && metadata.connectorData) {
      const { from, to } = metadata.connectorData;
      if (
        changedIds
        && !referencesChangedObject(from.objectId)
        && !referencesChangedObject(to.objectId)
      ) continue;
      changed = refreshConnector(object, metadata.connectorData, objects) || changed;
    }
  }
  if (changed) canvas.requestRenderAll();
  return changed;
}
