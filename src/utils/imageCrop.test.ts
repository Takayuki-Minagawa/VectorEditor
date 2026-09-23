import * as fabric from 'fabric';
import { afterEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../store/useEditorStore';
import { applyImageCrop, currentImageCrop, resetImageCrop } from './imageCrop';
import { createDocumentData, parseDocumentData } from './documentSerializer';

const canvases: fabric.Canvas[] = [];
afterEach(async () => {
  useEditorStore.setState({ canvas: null });
  for (const canvas of canvases.splice(0)) await canvas.dispose();
});

describe('non-destructive image crop', () => {
  it('keeps source pixel positions under rotation and flip, then restores the source', () => {
    const source = document.createElement('canvas'); source.width = 100; source.height = 80;
    const image = new fabric.Image(source, { left: 30, top: 50, angle: 35, flipX: true, scaleX: 2, scaleY: 1.5 });
    const scenePixel = (sourceX: number, sourceY: number) => {
      const crop = currentImageCrop(image);
      return fabric.util.transformPoint({ x: sourceX - crop.x - crop.width / 2, y: sourceY - crop.y - crop.height / 2 }, image.calcTransformMatrix());
    };
    const before = scenePixel(25, 30);
    applyImageCrop(image, { x: 10, y: 15, width: 60, height: 45 });
    const after = scenePixel(25, 30);
    expect(after.x).toBeCloseTo(before.x, 5); expect(after.y).toBeCloseTo(before.y, 5);
    expect(image.getOriginalSize()).toEqual({ width: 100, height: 80 });
    resetImageCrop(image);
    expect(currentImageCrop(image)).toEqual({ x: 0, y: 0, width: 100, height: 80 });
    expect(() => applyImageCrop(image, { x: 90, y: 0, width: 20, height: 40 })).toThrow();
  });

  it('keeps crop pixels in document JSON', () => {
    const canvas = new fabric.Canvas(document.createElement('canvas'));
    canvases.push(canvas);
    const source = document.createElement('canvas'); source.width = 100; source.height = 80;
    const image = new fabric.Image(source);
    canvas.add(image);
    applyImageCrop(image, { x: 10, y: 5, width: 50, height: 40 });
    const data = createDocumentData({ canvas, canvasWidth: 800, canvasHeight: 600, backgroundColor: '#fff', drawingMode: 'illustration', cadUnit: 'mm', scale: '1:1', cadWidth: 1000, cadHeight: 1000 });
    const parsed = parseDocumentData(JSON.stringify(data));
    expect(parsed.objects.objects[0]).toMatchObject({ cropX: 10, cropY: 5, width: 50, height: 40 });
  });
});
