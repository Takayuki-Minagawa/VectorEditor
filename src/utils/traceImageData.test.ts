import { describe, expect, it, vi } from 'vitest';
import {
  firstClipboardImage,
  fitTraceImageDimensions,
  isAcceptedTraceImage,
} from './traceImageData';

describe('trace image input guards', () => {
  it.each([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
  ])('accepts the supported %s MIME type', (type) => {
    expect(isAcceptedTraceImage(new Blob([], { type }))).toBe(true);
  });

  it.each([
    'image/svg+xml',
    'image/bmp',
    'application/octet-stream',
    '',
  ])('rejects the unsupported %s MIME type', (type) => {
    expect(isAcceptedTraceImage(new Blob([], { type }))).toBe(false);
  });

  it('ignores unsupported clipboard files and returns the first safe image', () => {
    const svg = new File(['<svg/>'], 'unsafe.svg', { type: 'image/svg+xml' });
    const png = new File(['png'], 'safe.png', { type: 'image/png' });
    const getSvg = vi.fn(() => svg);
    const getPng = vi.fn(() => png);
    const clipboard = {
      items: [
        { kind: 'file', type: svg.type, getAsFile: getSvg },
        { kind: 'file', type: png.type, getAsFile: getPng },
      ],
      files: [svg, png],
    } as unknown as DataTransfer;

    expect(firstClipboardImage(clipboard)).toBe(png);
    expect(getSvg).not.toHaveBeenCalled();
    expect(getPng).toHaveBeenCalledOnce();
  });
});

describe('fitTraceImageDimensions', () => {
  it('downscales before allocating ImageData while preserving aspect ratio', () => {
    expect(fitTraceImageDimensions(6_000, 3_000)).toEqual({
      width: 3_000,
      height: 1_500,
      scale: 0.5,
    });
    expect(fitTraceImageDimensions(640, 480)).toEqual({
      width: 640,
      height: 480,
      scale: 1,
    });
  });

  it.each([
    [0, 10],
    [10, -1],
    [1.5, 10],
    [Number.NaN, 10],
  ])('rejects invalid source dimensions (%s × %s)', (width, height) => {
    expect(() => fitTraceImageDimensions(width, height)).toThrow(
      'Unsupported image dimensions.',
    );
  });
});
