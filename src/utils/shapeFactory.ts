import * as fabric from 'fabric';
import type { CadUnit, ToolType } from '../types';
import { TOOL_DEFINITIONS } from '../domain/tools';
import { generateObjectId } from './objectIds';
import type { ConnectorRoute, SemanticAnchor } from './fabricObjectMetadata';
import { setFabricMetadataValues } from './fabricObjectMetadata';
import { createSemanticConnector, createSemanticDimension } from './semanticObjects';
import { loadCurrentEditorStyle } from './stylePresets';

export function applyObjectDefaults(
  obj: fabric.FabricObject,
  id: string,
  objectKind?: string,
): void {
  obj.set({
    id,
    strokeUniform: true,
    cornerColor: '#2196F3',
    cornerStyle: 'circle',
    cornerSize: 8,
    transparentCorners: false,
    borderColor: '#2196F3',
    borderScaleFactor: 1.5,
    padding: 4,
  } as Partial<fabric.FabricObject>);
  setFabricMetadataValues(obj, { id, objectKind });
}

export interface ShapeSemanticOptions {
  start?: SemanticAnchor;
  end?: SemanticAnchor;
  connectorRoute?: ConnectorRoute;
  dimensionPrecision?: number;
  dimensionUnit?: CadUnit;
}

export function createShapeOnDrag(
  tool: ToolType,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  getDimensionLabel: (distance: number) => string,
  semanticOptions: ShapeSemanticOptions = {},
): fabric.FabricObject | null {
  const style = loadCurrentEditorStyle(
    ['line', 'arrow', 'dimension', 'connector'].includes(tool) ? 'line' : 'shape',
  );
  const left = Math.min(startX, endX);
  const top = Math.min(startY, endY);
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);
  if (width < 2 && height < 2) return null;

  const common = {
    left,
    top,
    fill: style.fill,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    strokeDashArray: style.strokeDashArray ? [...style.strokeDashArray] : undefined,
    opacity: style.opacity,
  };

  let obj: fabric.FabricObject;
  const id = generateObjectId(tool);

  switch (tool) {
    case 'rect':
      obj = new fabric.Rect({ ...common, width, height });
      break;
    case 'roundedRect':
      obj = new fabric.Rect({ ...common, width, height, rx: 10, ry: 10 });
      break;
    case 'circle': {
      const radius = Math.max(width, height) / 2;
      obj = new fabric.Circle({
        ...common,
        radius,
        left: startX < endX ? startX : startX - radius * 2,
        top: startY < endY ? startY : startY - radius * 2,
      });
      break;
    }
    case 'ellipse':
      obj = new fabric.Ellipse({
        ...common,
        rx: width / 2,
        ry: height / 2,
      });
      break;
    case 'triangle':
      obj = new fabric.Triangle({ ...common, width, height });
      break;
    case 'diamond':
      obj = new fabric.Polygon(
        [
          { x: width / 2, y: 0 },
          { x: width, y: height / 2 },
          { x: width / 2, y: height },
          { x: 0, y: height / 2 },
        ],
        { ...common, left, top },
      );
      break;
    case 'line':
      obj = new fabric.Line([startX, startY, endX, endY], {
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        strokeDashArray: style.strokeDashArray ? [...style.strokeDashArray] : undefined,
        opacity: style.opacity,
        fill: '',
      });
      break;
    case 'arrow': {
      const angle = Math.atan2(endY - startY, endX - startX);
      const headLen = 14;
      const line = new fabric.Line([startX, startY, endX, endY], {
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        strokeDashArray: style.strokeDashArray ? [...style.strokeDashArray] : undefined,
        opacity: style.opacity,
        fill: '',
      });
      const headPoints = [
        { x: endX, y: endY },
        {
          x: endX - headLen * Math.cos(angle - Math.PI / 6),
          y: endY - headLen * Math.sin(angle - Math.PI / 6),
        },
        {
          x: endX - headLen * Math.cos(angle + Math.PI / 6),
          y: endY - headLen * Math.sin(angle + Math.PI / 6),
        },
      ];
      const head = new fabric.Polygon(headPoints, {
        fill: style.stroke,
        stroke: style.stroke,
        strokeWidth: Math.max(1, style.strokeWidth / 2),
        opacity: style.opacity,
      });
      obj = new fabric.Group([line, head]);
      break;
    }
    case 'wall':
      obj = new fabric.Rect({
        left,
        top,
        width: Math.max(width, 4),
        height: Math.max(height, 4),
        fill: style.fill,
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        strokeDashArray: style.strokeDashArray ? [...style.strokeDashArray] : undefined,
        opacity: style.opacity,
      });
      break;
    case 'dimension': {
      const dimension = createSemanticDimension({
        start: semanticOptions.start ?? { x: startX, y: startY },
        end: semanticOptions.end ?? { x: endX, y: endY },
        precision: semanticOptions.dimensionPrecision,
        unit: semanticOptions.dimensionUnit,
      }, getDimensionLabel, style);
      if (!dimension) return null;
      obj = dimension;
      break;
    }
    case 'connector': {
      const connector = createSemanticConnector({
        from: semanticOptions.start ?? { x: startX, y: startY },
        to: semanticOptions.end ?? { x: endX, y: endY },
        route: semanticOptions.connectorRoute ?? 'straight',
      }, style);
      if (!connector) return null;
      obj = connector;
      break;
    }
    default:
      return null;
  }

  applyObjectDefaults(obj, id, TOOL_DEFINITIONS[tool].objectKind);
  return obj;
}
