import * as fabric from 'fabric';
import { reassignObjectIdsRecursive } from '../../utils/objectIds';
import { releaseActiveSelectionObjects } from '../../utils/fabricObjectTree';
import {
  DEFAULT_TRACED_PRIMITIVE_STROKE_WIDTH,
  MIN_TRACED_STROKE_WIDTH,
  type TracedDrawing,
  type TracedShape,
} from './tracedDrawing';

export interface ToFabricObjectsOptions {
  canvas: fabric.Canvas;
  group?: boolean;
  color?: string;
}

function ringPath(points: readonly { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  return [
    `M ${points[0].x} ${points[0].y}`,
    ...points.slice(1).map((point) => `L ${point.x} ${point.y}`),
    'Z',
  ].join(' ');
}

function renderStrokeWidth(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value as number) > 0
    ? Math.max(MIN_TRACED_STROKE_WIDTH, value as number)
    : fallback;
}

function shapeToFabricObject(
  shape: TracedShape,
  color: string,
): fabric.FabricObject {
  const lineStyle = {
    fill: '',
    stroke: color,
    strokeLineCap: 'round' as const,
    strokeLineJoin: 'round' as const,
    strokeUniform: false,
  };

  switch (shape.kind) {
    case 'polygon': {
      if (shape.holes && shape.holes.length > 0) {
        return new fabric.Path([
          ringPath(shape.points),
          ...shape.holes.map(ringPath),
        ].join(' '), {
          fill: color,
          fillRule: 'evenodd',
          stroke: '',
          strokeWidth: 0,
          strokeUniform: true,
        });
      }
      return new fabric.Polygon(shape.points, {
        fill: color,
        stroke: color,
        strokeWidth: 0,
        strokeUniform: true,
      });
    }
    case 'polyline':
      return new fabric.Polyline(shape.points, {
        ...lineStyle,
        strokeWidth: renderStrokeWidth(
          shape.strokeWidth,
          MIN_TRACED_STROKE_WIDTH,
        ),
      });
    case 'line':
      return new fabric.Line([shape.x1, shape.y1, shape.x2, shape.y2], {
        ...lineStyle,
        strokeWidth: renderStrokeWidth(
          shape.strokeWidth,
          MIN_TRACED_STROKE_WIDTH,
        ),
      });
    case 'rect': {
      const strokeWidth = renderStrokeWidth(
        shape.strokeWidth,
        DEFAULT_TRACED_PRIMITIVE_STROKE_WIDTH,
      );
      // Fabric's left/top rect origin is the stroke-inclusive outer corner,
      // while traced x/y and SVG rect x/y describe the stroke centreline.
      const halfStrokeWidth = strokeWidth / 2;
      const radians = shape.angle * Math.PI / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      return new fabric.Rect({
        left: shape.x - halfStrokeWidth * (cos - sin),
        top: shape.y - halfStrokeWidth * (sin + cos),
        originX: 'left',
        originY: 'top',
        width: shape.width,
        height: shape.height,
        angle: shape.angle,
        ...lineStyle,
        strokeWidth,
      });
    }
    case 'circle':
      return new fabric.Circle({
        left: shape.cx,
        top: shape.cy,
        originX: 'center',
        originY: 'center',
        radius: shape.r,
        ...lineStyle,
        strokeWidth: renderStrokeWidth(
          shape.strokeWidth,
          DEFAULT_TRACED_PRIMITIVE_STROKE_WIDTH,
        ),
      });
    case 'ellipse':
      return new fabric.Ellipse({
        left: shape.cx,
        top: shape.cy,
        originX: 'center',
        originY: 'center',
        rx: shape.rx,
        ry: shape.ry,
        angle: shape.angle,
        ...lineStyle,
        strokeWidth: renderStrokeWidth(
          shape.strokeWidth,
          DEFAULT_TRACED_PRIMITIVE_STROKE_WIDTH,
        ),
      });
  }
}

/**
 * Convert a worker-safe traced drawing into editable Fabric objects and place
 * it at the visible viewport centre. The source pixel dimensions are the
 * scaling reference, so a sparse trace is sized consistently with its image.
 */
export function toFabricObjects(
  drawing: TracedDrawing,
  options: ToFabricObjectsOptions,
): fabric.FabricObject[] {
  if (drawing.shapes.length === 0) return [];

  const color = options.color ?? '#111827';
  const objects = drawing.shapes.map((shape) => shapeToFabricObject(shape, color));
  const zoom = Math.max(options.canvas.getZoom(), Number.EPSILON);
  const viewportWidth = (options.canvas.width || drawing.sourceWidth) / zoom;
  const viewportHeight = (options.canvas.height || drawing.sourceHeight) / zoom;
  const scale = Math.min(
    1,
    viewportWidth * 0.8 / drawing.sourceWidth,
    viewportHeight * 0.8 / drawing.sourceHeight,
  );

  if (options.group) {
    const group = new fabric.Group(objects);
    group.scale(scale);
    group.setPositionByOrigin(options.canvas.getVpCenter(), 'center', 'center');
    group.setCoords();
    reassignObjectIdsRecursive(group);
    return [group];
  }

  const selection = new fabric.ActiveSelection(objects);
  selection.scale(scale);
  selection.setPositionByOrigin(options.canvas.getVpCenter(), 'center', 'center');
  selection.setCoords();
  const released = releaseActiveSelectionObjects(selection);
  released.forEach((object) => {
    object.setCoords();
    reassignObjectIdsRecursive(object);
  });
  return released;
}
