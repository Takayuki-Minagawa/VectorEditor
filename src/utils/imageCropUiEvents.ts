import type * as fabric from 'fabric';

export const OPEN_IMAGE_CROP_EVENT = 'vectoreditor:open-image-crop';

export function openImageCrop(image: fabric.Image): void {
  window.dispatchEvent(new CustomEvent(OPEN_IMAGE_CROP_EVENT, { detail: image }));
}
