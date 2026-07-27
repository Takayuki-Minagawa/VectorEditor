import { describe, expect, it } from 'vitest';
import {
  binarizeOtsu,
  binarizeSauvola,
  filterSmallComponents,
  grayscaleImage,
  medianFilterBinary,
  otsuThreshold,
  preprocessImage,
  resizeGrayscale,
  type GrayscaleImage,
} from './preprocess';
import type { BinaryImage } from './tracedDrawing';

function binary(
  rows: readonly (readonly number[])[],
): BinaryImage {
  return {
    width: rows[0].length,
    height: rows.length,
    data: Uint8Array.from(rows.flat()),
  };
}

describe('trace preprocessing', () => {
  it('composites transparent pixels over white during grayscale conversion', () => {
    const grayscale = grayscaleImage({
      width: 2,
      height: 1,
      data: Uint8ClampedArray.from([
        0, 0, 0, 255,
        0, 0, 0, 0,
      ]),
    });
    expect([...grayscale.data]).toEqual([0, 255]);
  });

  it('resizes without changing aspect ratio or enlarging small images', () => {
    const source: GrayscaleImage = {
      width: 4,
      height: 2,
      data: Uint8Array.from([0, 64, 128, 255, 0, 64, 128, 255]),
    };
    expect(resizeGrayscale(source, 2)).toEqual(expect.objectContaining({
      width: 2,
      height: 1,
    }));
    const copy = resizeGrayscale(source, 20);
    expect(copy.data).not.toBe(source.data);
    expect([...copy.data]).toEqual([...source.data]);
  });

  it('uses Otsu to separate a dark foreground from a light background', () => {
    const grayscale: GrayscaleImage = {
      width: 4,
      height: 1,
      data: Uint8Array.from([0, 0, 255, 255]),
    };
    expect(otsuThreshold(grayscale.data)).toBe(0);
    expect([...binarizeOtsu(grayscale).data]).toEqual([1, 1, 0, 0]);
    expect([...binarizeOtsu({
      width: 2,
      height: 1,
      data: Uint8Array.from([255, 255]),
    }).data]).toEqual([0, 0]);
  });

  it('finds a dark mark using a local Sauvola threshold', () => {
    const data = new Uint8Array(7 * 7).fill(220);
    for (let y = 2; y <= 4; y += 1) {
      for (let x = 2; x <= 4; x += 1) data[y * 7 + x] = 20;
    }
    const result = binarizeSauvola(
      { width: 7, height: 7, data },
      { windowSize: 5, k: 0.2 },
    );
    expect(result.data[3 * 7 + 3]).toBe(1);
    expect(result.data[0]).toBe(0);
  });

  it('removes impulse noise with median and component-area filters', () => {
    const impulse = binary([
      [0, 0, 0, 0, 0],
      [0, 1, 1, 1, 0],
      [0, 1, 0, 1, 0],
      [0, 1, 1, 1, 0],
      [0, 0, 0, 0, 1],
    ]);
    const median = medianFilterBinary(impulse, 1);
    expect(median.data[2 * 5 + 2]).toBe(1);
    expect(median.data[4 * 5 + 4]).toBe(0);

    const filtered = filterSmallComponents(binary([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]), 2);
    // Area filtering intentionally uses 8-connectivity.
    expect([...filtered.data]).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect([...filterSmallComponents(binary([
      [1, 0, 0],
      [0, 0, 0],
      [0, 0, 1],
    ]), 2).data]).toEqual(new Array(9).fill(0));
  });

  it('runs the complete pure preprocessing pipeline on RGBA bytes', () => {
    const result = preprocessImage({
      width: 2,
      height: 1,
      data: Uint8Array.from([
        0, 0, 0, 255,
        0, 0, 0, 0,
      ]),
    }, {
      maxDimension: 2,
      minComponentArea: 1,
      medianRadius: 0,
    });
    expect([...result.data]).toEqual([1, 0]);
  });
});
