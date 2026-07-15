import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  calculateCadPageGeometry,
  calculateIllustrationGeometry,
  isClipboardExportSupported,
  normalizeExportFileName,
} from './exportService';

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalClipboard) {
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  } else {
    Reflect.deleteProperty(navigator, 'clipboard');
  }
});

describe('export geometry', () => {
  it('uses stable document coordinates for illustration output', () => {
    const geometry = calculateIllustrationGeometry(
      { left: 10, top: 20, width: 800, height: 600 },
      12,
      2,
    );

    expect(geometry.scene).toEqual({ left: -2, top: 8, width: 824, height: 624 });
    expect(geometry.artifactWidth).toBe(1648);
    expect(geometry.artifactHeight).toBe(1248);
    expect(geometry.sceneScale).toBe(1);
  });

  it('keeps CAD paper dimensions in millimetres at the requested scale', () => {
    const geometry = calculateCadPageGeometry(
      { left: 0, top: 0, width: 10_000, height: 7_000 },
      { widthMm: 297, heightMm: 210, scaleRatio: 100 },
      10,
      2,
    );

    expect(geometry.unit).toBe('mm');
    expect(geometry.artifactWidth).toBe(297);
    expect(geometry.artifactHeight).toBe(210);
    expect(geometry.scene).toEqual({
      left: -1000,
      top: -1000,
      width: 29_700,
      height: 21_000,
    });
    expect(geometry.clipped).toBe(false);
  });

  it('reports CAD content that exceeds the printable area', () => {
    const geometry = calculateCadPageGeometry(
      { left: 0, top: 0, width: 30_000, height: 20_000 },
      { widthMm: 297, heightMm: 210, scaleRatio: 100 },
      10,
      1,
    );

    expect(geometry.clipped).toBe(true);
  });
});

describe('export file names', () => {
  it('removes an existing extension and unsafe path characters', () => {
    expect(normalizeExportFileName(' plan/level:1.SVG ', 'dxf')).toBe('plan-level-1.dxf');
  });

  it('uses a safe default for an empty name', () => {
    expect(normalizeExportFileName('  ', 'png')).toBe('vector-drawing.png');
  });
});

describe('clipboard support detection', () => {
  it('uses ClipboardItem.supports for SVG and PNG MIME types', () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write: vi.fn() },
    });
    vi.stubGlobal('ClipboardItem', {
      supports: (mime: string) => mime === 'image/png',
    });

    expect(isClipboardExportSupported('png')).toBe(true);
    expect(isClipboardExportSupported('svg')).toBe(false);
    expect(isClipboardExportSupported('pdf')).toBe(false);
  });

  it('only assumes PNG support when the browser has no supports method', () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write: vi.fn() },
    });
    vi.stubGlobal('ClipboardItem', {});

    expect(isClipboardExportSupported('png')).toBe(true);
    expect(isClipboardExportSupported('svg')).toBe(false);
  });
});
