import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  calculateCadPageGeometry,
  calculateIllustrationGeometry,
  calculateVisibleBounds,
  createExportArtifact,
  isClipboardExportSupported,
  normalizeExportFileName,
} from './exportService';
import type * as fabric from 'fabric';
import * as fabricRuntime from 'fabric';
import type { SectionProfileData } from '../domain/section';
import { createSectionPath } from '../utils/sectionShapeFactory';

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
  it('calculates bounds for 100,000 visible objects without argument spreading', () => {
    function* createRectangles(): IterableIterator<fabric.FabricObject> {
      for (let index = 0; index < 100_000; index += 1) {
        yield {
          visible: true,
          excludeFromExport: false,
          getBoundingRect: () => ({
            left: index,
            top: -index,
            width: 2,
            height: 3,
          }),
        } as unknown as fabric.FabricObject;
      }
    }

    expect(calculateVisibleBounds(createRectangles())).toEqual({
      left: 0,
      top: -99_999,
      width: 100_001,
      height: 100_002,
    });
  });

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

describe('section profile export integration', () => {
  it('preserves compound holes in SVG and section metadata in DXF', async () => {
    const profile: SectionProfileData = {
      version: 1,
      analysisToleranceMm: 0.01,
      approximate: true,
      rings: [
        {
          role: 'outer',
          points: [
            { x: 10, y: -10 }, { x: 110, y: -10 },
            { x: 110, y: -70 }, { x: 10, y: -70 },
          ],
        },
        {
          role: 'hole',
          points: [
            { x: 40, y: -30 }, { x: 40, y: -50 },
            { x: 80, y: -50 }, { x: 80, y: -30 },
          ],
        },
      ],
    };
    const canvas = new fabricRuntime.Canvas();
    canvas.add(createSectionPath(profile, { fill: '#999999', strokeWidth: 0 }));

    try {
      const base = {
        canvas,
        documentWidth: 200,
        documentHeight: 100,
        cadWidth: 200,
        cadHeight: 100,
        scope: 'content' as const,
        margin: 0,
        background: null,
        multiplier: 1,
        fileName: 'section',
      };
      const svg = await createExportArtifact({
        ...base,
        drawingMode: 'illustration',
        format: 'svg',
      });
      const svgText = await svg.blob.text();
      expect(svgText).toMatch(/fill-rule:\s*evenodd|fill-rule="evenodd"/);

      const dxf = await createExportArtifact({
        ...base,
        drawingMode: 'cad',
        format: 'dxf',
      });
      const dxfText = await dxf.blob.text();
      expect(dxfText.match(/0\r\nPOLYLINE\r\n/g)).toHaveLength(2);
      expect(dxf.warnings).toEqual([expect.objectContaining({
        code: 'dxfApproximated',
        details: expect.arrayContaining([
          'SectionProfileApproximation',
          'SectionProfileHoles',
        ]),
      })]);
    } finally {
      canvas.dispose();
    }
  });
});
