import {
  type BinaryImage,
  type TraceOptions,
  normalizeTraceOptions,
} from './tracedDrawing';

export interface RasterImageDataLike {
  width: number;
  height: number;
  /**
   * Row-major grayscale, RGB, or RGBA bytes. RGBA is composited over white so
   * fully transparent PNG pixels never turn into false foreground.
   */
  data: Uint8Array | Uint8ClampedArray;
}

export interface GrayscaleImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface SauvolaOptions {
  windowSize?: number;
  k?: number;
  dynamicRange?: number;
}

function assertImageDimensions(
  image: { width: number; height: number; data: ArrayLike<number> },
  supportedChannels: readonly number[],
): number {
  if (
    !Number.isInteger(image.width)
    || !Number.isInteger(image.height)
    || image.width <= 0
    || image.height <= 0
  ) {
    throw new RangeError('Image dimensions must be positive integers.');
  }
  const pixelCount = image.width * image.height;
  const channels = image.data.length / pixelCount;
  if (!Number.isInteger(channels) || !supportedChannels.includes(channels)) {
    throw new RangeError(
      `Image data length must contain ${supportedChannels.join(', ')} channel(s) per pixel.`,
    );
  }
  return channels;
}

export function assertBinaryImage(image: BinaryImage): void {
  assertImageDimensions(image, [1]);
}

/** Converts grayscale/RGB/RGBA bytes to 8-bit luminance. */
export function grayscaleImage(image: RasterImageDataLike): GrayscaleImage {
  const channels = assertImageDimensions(image, [1, 3, 4]);
  const pixelCount = image.width * image.height;
  if (channels === 1) {
    return {
      width: image.width,
      height: image.height,
      data: Uint8Array.from(image.data),
    };
  }

  const result = new Uint8Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * channels;
    // Integer approximation of Rec. 601 luma, with coefficients summing 256.
    const luminance = (
      77 * image.data[offset]
      + 150 * image.data[offset + 1]
      + 29 * image.data[offset + 2]
      + 128
    ) >> 8;
    if (channels === 4) {
      const alpha = image.data[offset + 3];
      result[pixel] = Math.round(
        (luminance * alpha + 255 * (255 - alpha)) / 255,
      );
    } else {
      result[pixel] = luminance;
    }
  }
  return { width: image.width, height: image.height, data: result };
}

/** Bilinear resize that keeps the aspect ratio and never enlarges an image. */
export function resizeGrayscale(
  image: GrayscaleImage,
  maxDimension: number,
): GrayscaleImage {
  assertImageDimensions(image, [1]);
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
    throw new RangeError('Maximum image dimension must be positive.');
  }

  const largest = Math.max(image.width, image.height);
  if (largest <= maxDimension) {
    return {
      width: image.width,
      height: image.height,
      data: image.data.slice(),
    };
  }

  const scale = maxDimension / largest;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const data = new Uint8Array(width * height);
  const scaleX = image.width / width;
  const scaleY = image.height / height;

  for (let y = 0; y < height; y += 1) {
    const sourceY = (y + 0.5) * scaleY - 0.5;
    const y0 = Math.max(0, Math.floor(sourceY));
    const y1 = Math.min(image.height - 1, y0 + 1);
    const fy = Math.max(0, sourceY - y0);
    for (let x = 0; x < width; x += 1) {
      const sourceX = (x + 0.5) * scaleX - 0.5;
      const x0 = Math.max(0, Math.floor(sourceX));
      const x1 = Math.min(image.width - 1, x0 + 1);
      const fx = Math.max(0, sourceX - x0);
      const top = image.data[y0 * image.width + x0] * (1 - fx)
        + image.data[y0 * image.width + x1] * fx;
      const bottom = image.data[y1 * image.width + x0] * (1 - fx)
        + image.data[y1 * image.width + x1] * fx;
      data[y * width + x] = Math.round(top * (1 - fy) + bottom * fy);
    }
  }
  return { width, height, data };
}

/**
 * Finds the global threshold that maximizes between-class variance.
 *
 * A useful threshold is still returned for a uniform image: all-black remains
 * foreground while all-white remains background.
 */
export function otsuThreshold(data: Uint8Array): number {
  if (data.length === 0) return 127;
  const histogram = new Uint32Array(256);
  let totalIntensity = 0;
  for (const value of data) {
    histogram[value] += 1;
    totalIntensity += value;
  }

  let first = 0;
  while (first < 255 && histogram[first] === 0) first += 1;
  let last = 255;
  while (last > 0 && histogram[last] === 0) last -= 1;
  if (first === last) return first === 255 ? 254 : first;

  let backgroundWeight = 0;
  let backgroundIntensity = 0;
  let bestThreshold = first;
  let bestVariance = -1;

  for (let threshold = first; threshold < last; threshold += 1) {
    backgroundWeight += histogram[threshold];
    backgroundIntensity += threshold * histogram[threshold];
    if (backgroundWeight === 0) continue;
    const foregroundWeight = data.length - backgroundWeight;
    if (foregroundWeight === 0) break;
    const backgroundMean = backgroundIntensity / backgroundWeight;
    const foregroundMean = (
      totalIntensity - backgroundIntensity
    ) / foregroundWeight;
    const difference = backgroundMean - foregroundMean;
    const variance = backgroundWeight * foregroundWeight * difference * difference;
    if (variance > bestVariance) {
      bestVariance = variance;
      bestThreshold = threshold;
    }
  }
  return bestThreshold;
}

export function binarizeFixed(
  image: GrayscaleImage,
  threshold: number,
): BinaryImage {
  assertImageDimensions(image, [1]);
  if (!Number.isFinite(threshold)) {
    throw new RangeError('Binarization threshold must be finite.');
  }
  const boundedThreshold = Math.min(255, Math.max(0, threshold));
  const data = new Uint8Array(image.data.length);
  for (let index = 0; index < image.data.length; index += 1) {
    data[index] = image.data[index] <= boundedThreshold ? 1 : 0;
  }
  return { width: image.width, height: image.height, data };
}

export function binarizeOtsu(
  image: GrayscaleImage,
  threshold = otsuThreshold(image.data),
): BinaryImage {
  return binarizeFixed(image, threshold);
}

type IntegralImage = Uint32Array | Float64Array;

function rectangleSum(
  integral: IntegralImage,
  stride: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  return integral[y1 * stride + x1]
    - integral[y0 * stride + x1]
    - integral[y1 * stride + x0]
    + integral[y0 * stride + x0];
}

/** Local adaptive thresholding using summed-area tables. */
export function binarizeSauvola(
  image: GrayscaleImage,
  options: SauvolaOptions = {},
): BinaryImage {
  assertImageDimensions(image, [1]);
  const requestedWindow = Math.max(3, Math.round(options.windowSize ?? 25));
  const windowSize = requestedWindow % 2 === 0
    ? requestedWindow + 1
    : requestedWindow;
  const radius = Math.floor(windowSize / 2);
  const k = Number.isFinite(options.k) ? options.k as number : 0.2;
  const dynamicRange = Number.isFinite(options.dynamicRange)
    && (options.dynamicRange as number) > 0
    ? options.dynamicRange as number
    : 128;
  const stride = image.width + 1;
  const integralLength = stride * (image.height + 1);
  const maximumLuminanceSum = image.data.length * 255;
  const maximumSquaredLuminanceSum = image.data.length * 255 * 255;
  if (
    !Number.isSafeInteger(integralLength)
    || !Number.isSafeInteger(maximumSquaredLuminanceSum)
  ) {
    throw new RangeError('Image dimensions exceed the safe integral-image range.');
  }
  // The trace UI is capped at 3000×3000, where the maximum luminance sum is
  // 2.295e9. Keep a Float64 fallback so this pure helper preserves correctness
  // for larger callers instead of silently overflowing Uint32.
  const integral: IntegralImage = maximumLuminanceSum <= 0xffff_ffff
    ? new Uint32Array(integralLength)
    : new Float64Array(integralLength);
  const squaredIntegral = new Float64Array(integral.length);

  for (let y = 1; y <= image.height; y += 1) {
    let rowSum = 0;
    let rowSquaredSum = 0;
    for (let x = 1; x <= image.width; x += 1) {
      const value = image.data[(y - 1) * image.width + x - 1];
      rowSum += value;
      rowSquaredSum += value * value;
      integral[y * stride + x] = integral[(y - 1) * stride + x] + rowSum;
      squaredIntegral[y * stride + x] = squaredIntegral[
        (y - 1) * stride + x
      ] + rowSquaredSum;
    }
  }

  const data = new Uint8Array(image.data.length);
  for (let y = 0; y < image.height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(image.height, y + radius + 1);
    for (let x = 0; x < image.width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(image.width, x + radius + 1);
      const count = (x1 - x0) * (y1 - y0);
      const sum = rectangleSum(integral, stride, x0, y0, x1, y1);
      const squaredSum = rectangleSum(
        squaredIntegral,
        stride,
        x0,
        y0,
        x1,
        y1,
      );
      const mean = sum / count;
      const variance = Math.max(0, squaredSum / count - mean * mean);
      const deviation = Math.sqrt(variance);
      const threshold = mean * (1 + k * (deviation / dynamicRange - 1));
      const index = y * image.width + x;
      data[index] = image.data[index] <= threshold ? 1 : 0;
    }
  }
  return { width: image.width, height: image.height, data };
}

/** Majority filter for isolated salt-and-pepper pixels. */
export function medianFilterBinary(
  image: BinaryImage,
  radius = 1,
): BinaryImage {
  assertBinaryImage(image);
  if (!Number.isFinite(radius) || radius < 0) {
    throw new RangeError('Median radius must be a non-negative number.');
  }
  const integerRadius = Math.floor(radius);
  if (integerRadius === 0) {
    return { width: image.width, height: image.height, data: image.data.slice() };
  }

  const data = new Uint8Array(image.data.length);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      let foreground = 0;
      let count = 0;
      const y0 = Math.max(0, y - integerRadius);
      const y1 = Math.min(image.height - 1, y + integerRadius);
      const x0 = Math.max(0, x - integerRadius);
      const x1 = Math.min(image.width - 1, x + integerRadius);
      for (let neighbourY = y0; neighbourY <= y1; neighbourY += 1) {
        for (let neighbourX = x0; neighbourX <= x1; neighbourX += 1) {
          if (image.data[neighbourY * image.width + neighbourX] !== 0) {
            foreground += 1;
          }
          count += 1;
        }
      }
      data[y * image.width + x] = foreground * 2 > count ? 1 : 0;
    }
  }
  return { width: image.width, height: image.height, data };
}

/** Removes 8-connected foreground components smaller than minArea. */
export function filterSmallComponents(
  image: BinaryImage,
  minArea: number,
): BinaryImage {
  assertBinaryImage(image);
  if (!Number.isFinite(minArea) || minArea < 0) {
    throw new RangeError('Minimum component area must be non-negative.');
  }
  const minimum = Math.ceil(minArea);
  if (minimum <= 1) {
    return { width: image.width, height: image.height, data: image.data.slice() };
  }

  const output = new Uint8Array(image.data.length);
  const visited = new Uint8Array(image.data.length);
  const queue: number[] = [];

  for (let start = 0; start < image.data.length; start += 1) {
    if (image.data[start] === 0 || visited[start] !== 0) continue;
    queue.length = 0;
    queue.push(start);
    visited[start] = 1;
    let cursor = 0;
    while (cursor < queue.length) {
      const index = queue[cursor];
      cursor += 1;
      const x = index % image.width;
      const y = Math.floor(index / image.width);
      for (let dy = -1; dy <= 1; dy += 1) {
        const neighbourY = y + dy;
        if (neighbourY < 0 || neighbourY >= image.height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const neighbourX = x + dx;
          if (neighbourX < 0 || neighbourX >= image.width) continue;
          const neighbourIndex = neighbourY * image.width + neighbourX;
          if (
            image.data[neighbourIndex] !== 0
            && visited[neighbourIndex] === 0
          ) {
            visited[neighbourIndex] = 1;
            queue.push(neighbourIndex);
          }
        }
      }
    }
    if (queue.length >= minimum) {
      for (const index of queue) output[index] = 1;
    }
  }
  return { width: image.width, height: image.height, data: output };
}

export function preprocessImage(
  image: RasterImageDataLike,
  options: Partial<TraceOptions> = {},
): BinaryImage {
  const normalized = normalizeTraceOptions(options);
  const grayscale = resizeGrayscale(
    grayscaleImage(image),
    normalized.maxDimension,
  );
  const thresholded = normalized.threshold !== null
    ? binarizeFixed(grayscale, normalized.threshold)
    : normalized.thresholdMethod === 'sauvola'
      ? binarizeSauvola(grayscale, {
        windowSize: normalized.sauvolaWindow,
        k: normalized.sauvolaK,
      })
      : binarizeOtsu(grayscale);
  const denoised = medianFilterBinary(thresholded, normalized.medianRadius);
  return filterSmallComponents(denoised, normalized.minComponentArea);
}
