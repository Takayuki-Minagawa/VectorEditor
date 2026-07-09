import * as fabric from 'fabric';
import type { ToolType } from '../types';

export function configureCanvasForTool(canvas: fabric.Canvas, tool: ToolType): void {
  const isPencil = tool === 'pencil';
  canvas.isDrawingMode = isPencil;

  if (isPencil) {
    const brush = new fabric.PencilBrush(canvas);
    brush.width = 2;
    brush.color = '#1F4E79';
    canvas.freeDrawingBrush = brush;
  }

  canvas.selection = tool === 'select';
  canvas.defaultCursor = tool === 'select' ? 'default' : 'crosshair';
  canvas.forEachObject((obj) => {
    obj.selectable = tool === 'select';
    obj.evented = tool === 'select';
  });

  if (tool !== 'select') {
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  }
}
