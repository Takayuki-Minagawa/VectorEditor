import * as fabric from 'fabric';
import type { ToolType } from '../types';
import { generateObjectId } from './objectIds';

export function applyObjectDefaults(obj: fabric.FabricObject, id: string): void {
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
}

export function createShapeOnDrag(
  tool: ToolType,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  getDimensionLabel: (distance: number) => string,
): fabric.FabricObject | null {
  const left = Math.min(startX, endX);
  const top = Math.min(startY, endY);
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);
  if (width < 2 && height < 2) return null;

  const common = {
    left,
    top,
    fill: '#D9EAF7',
    stroke: '#1F4E79',
    strokeWidth: 2,
    opacity: 1,
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
        stroke: '#1F4E79',
        strokeWidth: 2,
        fill: '',
      });
      break;
    case 'arrow': {
      const angle = Math.atan2(endY - startY, endX - startX);
      const headLen = 14;
      const line = new fabric.Line([startX, startY, endX, endY], {
        stroke: '#1F4E79',
        strokeWidth: 2,
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
        fill: '#1F4E79',
        stroke: '#1F4E79',
        strokeWidth: 1,
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
        fill: '#555555',
        stroke: '#333333',
        strokeWidth: 1,
        opacity: 1,
      });
      break;
    case 'dimension': {
      const dx = endX - startX;
      const dy = endY - startY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 5) return null;

      const mainLine = new fabric.Line([startX, startY, endX, endY], {
        stroke: '#333333',
        strokeWidth: 1,
        fill: '',
      });

      const ang = Math.atan2(dy, dx);
      const perpAng = ang + Math.PI / 2;
      const tickLen = 6;
      const tick1 = new fabric.Line([
        startX + tickLen * Math.cos(perpAng),
        startY + tickLen * Math.sin(perpAng),
        startX - tickLen * Math.cos(perpAng),
        startY - tickLen * Math.sin(perpAng),
      ], { stroke: '#333333', strokeWidth: 1, fill: '' });

      const tick2 = new fabric.Line([
        endX + tickLen * Math.cos(perpAng),
        endY + tickLen * Math.sin(perpAng),
        endX - tickLen * Math.cos(perpAng),
        endY - tickLen * Math.sin(perpAng),
      ], { stroke: '#333333', strokeWidth: 1, fill: '' });

      const midX = (startX + endX) / 2;
      const midY = (startY + endY) / 2;
      const label = new fabric.Text(getDimensionLabel(dist), {
        left: midX,
        top: midY - 14,
        fontSize: 12,
        fontFamily: 'sans-serif',
        fill: '#333333',
        originX: 'center',
        originY: 'bottom',
      });

      obj = new fabric.Group([mainLine, tick1, tick2, label]);
      break;
    }
    default:
      return null;
  }

  applyObjectDefaults(obj, id);
  return obj;
}
