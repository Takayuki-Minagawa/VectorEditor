import * as fabric from 'fabric';
import type { ToolType } from '../types';
import { getFabricMetadata } from './fabricObjectMetadata';
import { loadCurrentEditorStyle } from './stylePresets';

export function configureCanvasForTool(canvas: fabric.Canvas, tool: ToolType): void {
  const isPencil = tool === 'pencil';
  canvas.isDrawingMode = isPencil;

  if (isPencil) {
    const style = loadCurrentEditorStyle('line');
    const brush = new fabric.PencilBrush(canvas);
    brush.width = style.strokeWidth;
    brush.color = style.stroke;
    canvas.freeDrawingBrush = brush;
  }

  canvas.selection = tool === 'select';
  canvas.defaultCursor = tool === 'select' ? 'default' : 'crosshair';
  canvas.forEachObject((obj) => {
    const selecting = tool === 'select';
    const metadata = getFabricMetadata(obj);
    const locked = metadata.locked ?? Boolean(
      obj.lockMovementX
      || obj.lockMovementY
      || obj.lockScalingX
      || obj.lockScalingY
      || obj.lockRotation,
    );
    obj.set({
      selectable: selecting,
      evented: selecting,
      hasControls: selecting && !locked,
    });
  });

  if (tool !== 'select') {
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  }
}
