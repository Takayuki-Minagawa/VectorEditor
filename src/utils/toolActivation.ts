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

  // Node editing keeps objects clickable so a target can be picked, but the
  // rubber-band multi selection and standard transform handles stay off; the
  // node-edit interaction layer attaches per-node controls on selection.
  const interactive = tool === 'select' || tool === 'nodeEdit';
  canvas.selection = tool === 'select';
  canvas.defaultCursor = interactive ? 'default' : 'crosshair';
  canvas.forEachObject((obj) => {
    const metadata = getFabricMetadata(obj);
    const locked = metadata.locked ?? Boolean(
      obj.lockMovementX
      || obj.lockMovementY
      || obj.lockScalingX
      || obj.lockScalingY
      || obj.lockRotation,
    );
    obj.set({
      selectable: interactive,
      evented: interactive,
      hasControls: tool === 'select' && !locked,
    });
  });

  if (tool !== 'select') {
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  }
}
