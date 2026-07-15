import * as fabric from 'fabric';
import { PX_PER_MM } from '../types';
import type { DrawingMode } from '../types';
import { exportObjectsToDxf } from './dxfExporter';

export type ExportFormat = 'svg' | 'png' | 'pdf' | 'dxf';
export type ExportScope = 'canvas' | 'content' | 'selection';

export interface CadPageExportOptions {
  widthMm: number;
  heightMm: number;
  scaleRatio: number;
}

export interface DrawingExportRequest {
  canvas: fabric.Canvas;
  drawingMode: DrawingMode;
  documentWidth: number;
  documentHeight: number;
  cadWidth: number;
  cadHeight: number;
  format: ExportFormat;
  scope: ExportScope;
  margin: number;
  background: string | null;
  multiplier: number;
  fileName: string;
  cadPage?: CadPageExportOptions;
}

export type ExportWarningCode =
  | 'cadContentClipped'
  | 'dxfUnsupported'
  | 'dxfApproximated';

export interface ExportWarning {
  code: ExportWarningCode;
  details: string[];
}

export interface ExportArtifact {
  blob: Blob;
  fileName: string;
  format: ExportFormat;
  width: number;
  height: number;
  unit: 'px' | 'mm';
  warnings: ExportWarning[];
}

export type DrawingExportErrorCode =
  | 'NO_CANVAS'
  | 'NO_CONTENT'
  | 'NO_SELECTION'
  | 'INVALID_OPTIONS'
  | 'OUTPUT_TOO_LARGE'
  | 'CLIPBOARD_UNSUPPORTED'
  | 'EXPORT_FAILED';

export class DrawingExportError extends Error {
  readonly code: DrawingExportErrorCode;

  constructor(code: DrawingExportErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DrawingExportError';
    this.code = code;
  }
}

export interface SceneRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ExportGeometry {
  scene: SceneRect;
  logicalWidth: number;
  logicalHeight: number;
  artifactWidth: number;
  artifactHeight: number;
  unit: 'px' | 'mm';
  sceneScale: number;
  clipped: boolean;
}

interface SerializedCanvas {
  objects: unknown[];
  [key: string]: unknown;
}

const FABRIC_EXPORT_PROPS = [
  'id',
  'name',
  'objectKind',
  'sectionProfileData',
  'latexSource',
];
const MAX_RASTER_SIDE = 32_767;
const MAX_RASTER_AREA = 100_000_000;
const MIME_BY_FORMAT: Record<ExportFormat, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  pdf: 'application/pdf',
  dxf: 'application/dxf',
};

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new DrawingExportError('INVALID_OPTIONS', `${name} must be a positive number.`);
  }
}

function cloneSerializedCanvas(canvas: fabric.Canvas, scope: ExportScope): SerializedCanvas {
  const serialized = canvas.toObject(FABRIC_EXPORT_PROPS) as unknown as SerializedCanvas;
  const exportableObjects = canvas.getObjects().filter((object) => !object.excludeFromExport);

  if (scope === 'selection') {
    const selected = new Set(canvas.getActiveObjects());
    if (selected.size === 0) {
      throw new DrawingExportError('NO_SELECTION', 'No objects are selected.');
    }
    serialized.objects = serialized.objects.filter((_, index) => {
      const object = exportableObjects[index];
      return object ? selected.has(object) : false;
    });
    if (serialized.objects.length === 0) {
      throw new DrawingExportError('NO_SELECTION', 'No exportable objects are selected.');
    }
  }

  delete serialized.background;
  delete serialized.backgroundImage;
  delete serialized.overlay;
  delete serialized.overlayImage;
  return serialized;
}

async function createOffscreenCanvas(
  source: fabric.Canvas,
  scope: ExportScope,
): Promise<fabric.StaticCanvas> {
  const serialized = cloneSerializedCanvas(source, scope);
  const canvas = new fabric.StaticCanvas(undefined, {
    width: 1,
    height: 1,
    enableRetinaScaling: false,
    renderOnAddRemove: false,
  });
  await canvas.loadFromJSON(serialized);
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
  canvas.backgroundColor = '';
  canvas.overlayColor = '';
  return canvas;
}

export function calculateVisibleBounds(
  objects: Iterable<fabric.FabricObject>,
): SceneRect | null {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  let hasVisibleObject = false;

  // Avoid spreading one value per object into Math.min/Math.max. Documents
  // may contain up to 100,000 objects, which exceeds the argument limit in
  // some JavaScript engines.
  for (const object of objects) {
    if (!object.visible || object.excludeFromExport) continue;
    const rect = object.getBoundingRect();
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.left + rect.width);
    bottom = Math.max(bottom, rect.top + rect.height);
    hasVisibleObject = true;
  }

  if (!hasVisibleObject) return null;
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

export function calculateIllustrationGeometry(
  source: SceneRect,
  margin: number,
  multiplier: number,
): ExportGeometry {
  if (!Number.isFinite(margin) || margin < 0) {
    throw new DrawingExportError('INVALID_OPTIONS', 'Margin must be zero or greater.');
  }
  assertPositiveFinite(multiplier, 'Multiplier');

  const scene = {
    left: source.left - margin,
    top: source.top - margin,
    width: Math.max(1, source.width + margin * 2),
    height: Math.max(1, source.height + margin * 2),
  };
  return {
    scene,
    logicalWidth: scene.width,
    logicalHeight: scene.height,
    artifactWidth: scene.width * multiplier,
    artifactHeight: scene.height * multiplier,
    unit: 'px',
    sceneScale: 1,
    clipped: false,
  };
}

export function calculateCadPageGeometry(
  source: SceneRect,
  page: CadPageExportOptions,
  marginMm: number,
  multiplier: number,
): ExportGeometry {
  assertPositiveFinite(page.widthMm, 'Paper width');
  assertPositiveFinite(page.heightMm, 'Paper height');
  assertPositiveFinite(page.scaleRatio, 'Scale ratio');
  assertPositiveFinite(multiplier, 'Multiplier');
  if (!Number.isFinite(marginMm) || marginMm < 0
    || marginMm * 2 >= Math.min(page.widthMm, page.heightMm)) {
    throw new DrawingExportError('INVALID_OPTIONS', 'Paper margin is outside the printable area.');
  }

  const marginScene = marginMm * page.scaleRatio;
  const scene = {
    left: source.left - marginScene,
    top: source.top - marginScene,
    width: page.widthMm * page.scaleRatio,
    height: page.heightMm * page.scaleRatio,
  };
  const printableWidth = (page.widthMm - marginMm * 2) * page.scaleRatio;
  const printableHeight = (page.heightMm - marginMm * 2) * page.scaleRatio;
  return {
    scene,
    logicalWidth: page.widthMm * PX_PER_MM,
    logicalHeight: page.heightMm * PX_PER_MM,
    artifactWidth: page.widthMm,
    artifactHeight: page.heightMm,
    unit: 'mm',
    sceneScale: PX_PER_MM / page.scaleRatio,
    clipped: source.width > printableWidth || source.height > printableHeight,
  };
}

function createGeometry(
  request: DrawingExportRequest,
  bounds: SceneRect | null,
): ExportGeometry {
  let source: SceneRect;
  if (request.scope === 'canvas') {
    source = request.drawingMode === 'cad'
      ? { left: 0, top: 0, width: request.cadWidth, height: request.cadHeight }
      : { left: 0, top: 0, width: request.documentWidth, height: request.documentHeight };
  } else {
    if (!bounds) {
      throw new DrawingExportError(
        request.scope === 'selection' ? 'NO_SELECTION' : 'NO_CONTENT',
        'The requested export area is empty.',
      );
    }
    source = bounds;
  }

  if (request.drawingMode === 'cad' && request.format !== 'dxf') {
    if (!request.cadPage) {
      throw new DrawingExportError('INVALID_OPTIONS', 'CAD paper settings are required.');
    }
    return calculateCadPageGeometry(source, request.cadPage, request.margin, request.multiplier);
  }
  return calculateIllustrationGeometry(source, request.margin, request.multiplier);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function createSvg(
  canvas: fabric.StaticCanvas,
  geometry: ExportGeometry,
  background: string | null,
  drawingMode: DrawingMode,
): string {
  const isCad = drawingMode === 'cad';
  const width = isCad
    ? `${geometry.artifactWidth}mm`
    : `${geometry.artifactWidth}px`;
  const height = isCad
    ? `${geometry.artifactHeight}mm`
    : `${geometry.artifactHeight}px`;
  let svg = canvas.toSVG({
    width,
    height,
    viewBox: {
      x: geometry.scene.left,
      y: geometry.scene.top,
      width: geometry.scene.width,
      height: geometry.scene.height,
    },
  });

  if (background) {
    const rect = `<rect x="${geometry.scene.left}" y="${geometry.scene.top}" width="${geometry.scene.width}" height="${geometry.scene.height}" fill="${escapeXml(background)}" />\n`;
    const marker = '</defs>\n';
    svg = svg.includes(marker)
      ? svg.replace(marker, `${marker}${rect}`)
      : svg.replace(/(<svg[^>]*>)/, `$1\n${rect}`);
  }

  // Illustration multipliers are already reflected in artifactWidth/Height;
  // the viewBox remains in stable document coordinates.
  return svg;
}

function validateRasterSize(width: number, height: number): void {
  const pixelWidth = Math.ceil(width);
  const pixelHeight = Math.ceil(height);
  if (pixelWidth > MAX_RASTER_SIDE || pixelHeight > MAX_RASTER_SIDE
    || pixelWidth * pixelHeight > MAX_RASTER_AREA) {
    throw new DrawingExportError(
      'OUTPUT_TOO_LARGE',
      `Raster output is too large (${pixelWidth} x ${pixelHeight}).`,
    );
  }
}

async function createPngBlob(
  canvas: fabric.StaticCanvas,
  geometry: ExportGeometry,
  background: string | null,
  multiplier: number,
): Promise<Blob> {
  const outputWidth = geometry.logicalWidth * multiplier;
  const outputHeight = geometry.logicalHeight * multiplier;
  validateRasterSize(outputWidth, outputHeight);

  canvas.setDimensions({
    width: Math.max(1, Math.ceil(geometry.logicalWidth)),
    height: Math.max(1, Math.ceil(geometry.logicalHeight)),
  });
  canvas.setViewportTransform([
    geometry.sceneScale,
    0,
    0,
    geometry.sceneScale,
    -geometry.scene.left * geometry.sceneScale,
    -geometry.scene.top * geometry.sceneScale,
  ]);
  canvas.backgroundColor = background ?? '';
  canvas.requestRenderAll();

  const element = canvas.toCanvasElement(multiplier);
  const blob = await new Promise<Blob | null>((resolve) => element.toBlob(resolve, 'image/png'));
  if (!blob) {
    throw new DrawingExportError('EXPORT_FAILED', 'The browser could not encode the PNG.');
  }
  return blob;
}

function parseSvgElement(svg: string): SVGElement {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg') {
    throw new DrawingExportError('EXPORT_FAILED', 'The generated SVG is invalid.');
  }
  return document.documentElement as unknown as SVGElement;
}

async function createPdfBlob(
  svg: string,
  geometry: ExportGeometry,
  drawingMode: DrawingMode,
): Promise<Blob> {
  const [{ jsPDF }] = await Promise.all([
    import('jspdf'),
    import('svg2pdf.js'),
  ]);
  const width = geometry.artifactWidth;
  const height = geometry.artifactHeight;
  const svgElement = parseSvgElement(svg);
  const orientation = width >= height ? 'landscape' : 'portrait';
  const pdf = drawingMode === 'cad'
    ? new jsPDF({ orientation, unit: 'mm', format: [width, height] })
    : new jsPDF({ orientation, unit: 'px', format: [width, height], hotfixes: ['px_scaling'] });

  await pdf.svg(svgElement, { x: 0, y: 0, width, height });
  return new Blob([pdf.output('arraybuffer')], { type: MIME_BY_FORMAT.pdf });
}

export function normalizeExportFileName(fileName: string, format: ExportFormat): string {
  const withoutKnownExtension = fileName.trim().replace(/\.(svg|png|pdf|dxf)$/i, '');
  const sanitized = Array.from(withoutKnownExtension)
    .map((character) => character.charCodeAt(0) < 32 ? '-' : character)
    .join('')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim();
  return `${sanitized || 'vector-drawing'}.${format}`;
}

export async function createExportArtifact(
  request: DrawingExportRequest,
): Promise<ExportArtifact> {
  if (!request.canvas) {
    throw new DrawingExportError('NO_CANVAS', 'Canvas is not available.');
  }
  assertPositiveFinite(request.documentWidth, 'Document width');
  assertPositiveFinite(request.documentHeight, 'Document height');
  assertPositiveFinite(request.cadWidth, 'CAD width');
  assertPositiveFinite(request.cadHeight, 'CAD height');
  if (request.format === 'dxf' && request.drawingMode !== 'cad') {
    throw new DrawingExportError('INVALID_OPTIONS', 'DXF export is only available in CAD mode.');
  }

  const offscreen = await createOffscreenCanvas(request.canvas, request.scope);
  try {
    const bounds = calculateVisibleBounds(offscreen.getObjects());
    if (!bounds && request.scope !== 'canvas') {
      throw new DrawingExportError(
        request.scope === 'selection' ? 'NO_SELECTION' : 'NO_CONTENT',
        'The requested export area is empty.',
      );
    }

    if (request.format === 'dxf') {
      const dxf = exportObjectsToDxf(
        offscreen.getObjects(),
        request.cadWidth,
        request.cadHeight,
      );
      const warnings: ExportWarning[] = [];
      if (dxf.unsupportedTypes.length > 0) {
        warnings.push({ code: 'dxfUnsupported', details: dxf.unsupportedTypes });
      }
      if (dxf.approximatedTypes.length > 0) {
        warnings.push({ code: 'dxfApproximated', details: dxf.approximatedTypes });
      }
      return {
        blob: new Blob([dxf.text], { type: MIME_BY_FORMAT.dxf }),
        fileName: normalizeExportFileName(request.fileName, request.format),
        format: request.format,
        width: request.cadWidth,
        height: request.cadHeight,
        unit: 'mm',
        warnings,
      };
    }

    const geometry = createGeometry(request, bounds);
    const warnings: ExportWarning[] = geometry.clipped
      ? [{ code: 'cadContentClipped', details: [] }]
      : [];
    const svg = createSvg(
      offscreen,
      geometry,
      request.background,
      request.drawingMode,
    );

    let blob: Blob;
    if (request.format === 'svg') {
      blob = new Blob([svg], { type: MIME_BY_FORMAT.svg });
    } else if (request.format === 'png') {
      blob = await createPngBlob(offscreen, geometry, request.background, request.multiplier);
    } else {
      blob = await createPdfBlob(svg, geometry, request.drawingMode);
    }

    return {
      blob,
      fileName: normalizeExportFileName(request.fileName, request.format),
      format: request.format,
      width: geometry.artifactWidth,
      height: geometry.artifactHeight,
      unit: geometry.unit,
      warnings,
    };
  } catch (error) {
    if (error instanceof DrawingExportError) throw error;
    throw new DrawingExportError('EXPORT_FAILED', 'Export failed.', { cause: error });
  } finally {
    await offscreen.dispose();
  }
}

export function downloadExportArtifact(artifact: ExportArtifact): void {
  const url = URL.createObjectURL(artifact.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.fileName;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  queueMicrotask(() => URL.revokeObjectURL(url));
}

export function isClipboardExportSupported(format: ExportFormat): boolean {
  if (format !== 'svg' && format !== 'png') return false;
  if (typeof navigator === 'undefined' || !navigator.clipboard?.write
    || typeof globalThis.ClipboardItem === 'undefined') {
    return false;
  }
  const mime = MIME_BY_FORMAT[format];
  const supports = globalThis.ClipboardItem.supports;
  if (typeof supports === 'function') return supports.call(globalThis.ClipboardItem, mime);
  return format === 'png';
}

export async function copyExportToClipboard(
  request: DrawingExportRequest,
): Promise<ExportArtifact> {
  if (!isClipboardExportSupported(request.format)) {
    throw new DrawingExportError(
      'CLIPBOARD_UNSUPPORTED',
      'This browser cannot copy the selected format to the clipboard.',
    );
  }

  const artifactPromise = createExportArtifact(request);
  const mime = MIME_BY_FORMAT[request.format];
  const item = new ClipboardItem({
    [mime]: artifactPromise.then((artifact) => artifact.blob),
  });
  const writePromise = navigator.clipboard.write([item]);
  const [artifact] = await Promise.all([artifactPromise, writePromise]);
  return artifact;
}
