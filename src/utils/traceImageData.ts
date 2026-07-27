import * as fabric from 'fabric';

export const TRACE_ACCEPTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

export const TRACE_DECODE_MAX_DIMENSION = 3_000;
// Independent allocation guard for every ImageData-producing path. The
// current 3000px decode cap reaches at most 9M pixels, while this separate
// ceiling also protects future callers if their dimension policy changes.
const MAX_SOURCE_PIXELS = 16_000_000;
const ACCEPTED_TYPE_SET = new Set<string>(TRACE_ACCEPTED_IMAGE_TYPES);

export function isAcceptedTraceImage(blob: Blob): boolean {
  return ACCEPTED_TYPE_SET.has(blob.type.toLowerCase());
}

export function fitTraceImageDimensions(
  width: number,
  height: number,
  maxDimension = TRACE_DECODE_MAX_DIMENSION,
): { width: number; height: number; scale: number } {
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width <= 0
    || height <= 0
  ) {
    throw new Error('Unsupported image dimensions.');
  }
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

function canvasImageData(
  source: CanvasImageSource,
  width: number,
  height: number,
): ImageData {
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width <= 0
    || height <= 0
    || width * height > MAX_SOURCE_PIXELS
  ) {
    throw new Error('Unsupported image dimensions.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', {
    alpha: true,
    willReadFrequently: true,
  });
  if (!context) throw new Error('Canvas 2D is unavailable.');
  context.drawImage(source, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

function loadHtmlImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode image.'));
    };
    image.src = url;
  });
}

export async function blobToImageData(blob: Blob): Promise<ImageData> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    try {
      const fitted = fitTraceImageDimensions(bitmap.width, bitmap.height);
      return canvasImageData(bitmap, fitted.width, fitted.height);
    } finally {
      bitmap.close();
    }
  }
  const image = await loadHtmlImage(blob);
  const fitted = fitTraceImageDimensions(
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
  );
  return canvasImageData(
    image,
    fitted.width,
    fitted.height,
  );
}

export function fabricImageToImageData(image: fabric.Image): ImageData {
  const fitted = fitTraceImageDimensions(
    Math.max(1, Math.round(image.width || 1)),
    Math.max(1, Math.round(image.height || 1)),
  );
  const rendered = image.toCanvasElement({
    multiplier: fitted.scale,
    withoutTransform: true,
    withoutShadow: true,
  });
  const context = rendered.getContext('2d', {
    alpha: true,
    willReadFrequently: true,
  });
  if (!context || rendered.width <= 0 || rendered.height <= 0) {
    throw new Error('Failed to read Fabric image.');
  }
  if (rendered.width * rendered.height > MAX_SOURCE_PIXELS) {
    throw new Error('Unsupported image dimensions.');
  }
  return context.getImageData(0, 0, rendered.width, rendered.height);
}

export function firstClipboardImage(
  clipboardData: DataTransfer | null,
): File | null {
  if (!clipboardData) return null;
  for (const item of clipboardData.items) {
    if (item.kind === 'file' && ACCEPTED_TYPE_SET.has(item.type.toLowerCase())) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return [...clipboardData.files].find(isAcceptedTraceImage) ?? null;
}
