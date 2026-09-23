import * as fabric from 'fabric';

export interface ImageCrop { x: number; y: number; width: number; height: number }

export function imageSourceSize(image: fabric.Image): { width: number; height: number } {
  const size = image.getOriginalSize();
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width < 1 || size.height < 1) {
    throw new Error('Invalid image size');
  }
  return size;
}

export function currentImageCrop(image: fabric.Image): ImageCrop {
  return { x: image.cropX || 0, y: image.cropY || 0, width: image.width, height: image.height };
}

export function applyImageCrop(image: fabric.Image, crop: ImageCrop): void {
  const source = imageSourceSize(image);
  const { x, y, width, height } = crop;
  if (![x, y, width, height].every(Number.isFinite)
    || x < 0 || y < 0 || width < 1 || height < 1
    || x + width > source.width + 1e-6 || y + height > source.height + 1e-6) {
    throw new Error('Crop is outside the source image');
  }
  const old = currentImageCrop(image);
  const center = image.getCenterPoint();
  const matrix = image.calcTransformMatrix();
  const dx = x - old.x + (width - old.width) / 2;
  const dy = y - old.y + (height - old.height) / 2;
  image.set({ cropX: x, cropY: y, width, height, dirty: true });
  image.setPositionByOrigin(new fabric.Point(
    center.x + matrix[0] * dx + matrix[2] * dy,
    center.y + matrix[1] * dx + matrix[3] * dy,
  ), 'center', 'center');
  image.setCoords();
  image.canvas?.requestRenderAll();
}

export function resetImageCrop(image: fabric.Image): void {
  const size = imageSourceSize(image);
  applyImageCrop(image, { x: 0, y: 0, ...size });
}
