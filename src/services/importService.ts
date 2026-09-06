import * as fabric from 'fabric';
import { createAsyncCanvasMutationGuard, executeCanvasTransaction, type PushHistory } from '../utils/canvasCommands';
import { reassignObjectIdsRecursive } from '../utils/objectIds';
import { initializeObjectLayer } from '../utils/cadLayers';

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_AREA = 40_000_000;
const RASTER_MIME = /^image\/(png|jpeg|gif|webp)$/i;

/** Reject active/external content before Fabric can load an SVG resource. */
export function validateImportSvg(source: string): string {
  if (new TextEncoder().encode(source).byteLength > MAX_IMPORT_BYTES || /<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('SVG is too large or contains a DTD');
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg') throw new Error('Invalid SVG');
  const elements = Array.from(document.querySelectorAll('*'));
  if (elements.length > 10000) throw new Error('SVG is too complex');
  const ids = new Map<string, Element>();
  for (const element of elements) {
    if (!element.id) continue;
    if (ids.has(element.id)) throw new Error('Duplicate SVG ID');
    ids.set(element.id, element);
  }
  let expandedElements = 0;
  const visit = (element: Element, ancestors: Set<Element>, depth: number) => {
    if (++expandedElements > 20000 || depth > 50 || ancestors.has(element)) throw new Error('SVG reference expansion is too complex or cyclic');
    const path = new Set(ancestors).add(element);
    Array.from(element.children).forEach((child) => visit(child, path, depth + 1));
    const href = element.getAttribute('href') ?? element.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (href?.startsWith('#')) { const target = ids.get(href.slice(1)); if (target) visit(target, path, depth + 1); }
  };
  visit(document.documentElement, new Set(), 0);
  let pathCommands = 0;
  for (const element of elements) {
    if (/^(script|foreignObject|iframe|object|embed|animate|animateTransform|animateMotion|set|audio|video)$/i.test(element.localName)) throw new Error('Unsupported active SVG content');
    const css = element.localName === 'style' ? element.textContent ?? '' : '';
    for (const value of [css, ...Array.from(element.attributes).map((attribute) => attribute.value)]) {
      if (/@import|expression\s*\(|\\/i.test(value)) throw new Error('External SVG CSS is unsupported');
      for (const match of value.matchAll(/url\s*\((.*?)\)/gi)) {
        if (!/^['"]?#[\w:.-]+['"]?$/.test(match[1].trim())) throw new Error('External SVG resource');
      }
    }
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.localName === 'base') throw new Error('SVG base URLs are unsupported');
      if (/^on/i.test(attribute.localName)) throw new Error('SVG event handlers are unsupported');
      if (attribute.localName === 'href') {
        if (!/^#[\w:.-]+$/.test(attribute.value) && !/^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(attribute.value)) throw new Error('External SVG reference');
      }
    }
    pathCommands += (element.getAttribute('d')?.match(/[a-z]/gi) ?? []).length;
    if (pathCommands > 100000) throw new Error('SVG has too many path segments');
  }
  return new XMLSerializer().serializeToString(document);
}

export function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Read failed')); reader.readAsDataURL(file);
  });
}

export async function importDrawingFile(canvas: fabric.Canvas, file: File, pushHistory: PushHistory): Promise<boolean> {
  if (!file.size || file.size > MAX_IMPORT_BYTES) throw new Error('Import file exceeds size limits');
  const canCommit = createAsyncCanvasMutationGuard(canvas);
  let object: fabric.FabricObject;
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
    const loaded = await fabric.loadSVGFromString(validateImportSvg(await file.text()));
    const objects = loaded.objects.filter((o): o is fabric.FabricObject => !!o);
    if (!objects.length) throw new Error('SVG has no supported objects');
    object = objects.length === 1 ? objects[0] : new fabric.Group(objects);
  } else {
    if (!RASTER_MIME.test(file.type) && !/\.(png|jpe?g|gif|webp)$/i.test(file.name)) throw new Error('Unsupported image');
    const image = await fabric.Image.fromURL(await readFileAsDataUrl(file));
    if (image.width * image.height > MAX_IMAGE_AREA || image.width > 32767 || image.height > 32767) { image.dispose(); throw new Error('Image dimensions exceed limits'); }
    object = image;
  }
  if (!canCommit()) { object.dispose(); return false; }
  const bounds = object.getBoundingRect();
  if (![bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isFinite) || bounds.width > 1e9 || bounds.height > 1e9) { object.dispose(); throw new Error('Invalid image geometry'); }
  reassignObjectIdsRecursive(object);
  initializeObjectLayer(canvas, object, false);
  const zoom = Math.max(canvas.getZoom(), 0.0001);
  const factor = Math.min(1, canvas.width * .8 / zoom / Math.max(1, bounds.width), canvas.height * .8 / zoom / Math.max(1, bounds.height));
  object.set({ scaleX: object.scaleX * factor, scaleY: object.scaleY * factor });
  const center = fabric.util.transformPoint(new fabric.Point(canvas.width / 2, canvas.height / 2), fabric.util.invertTransform(canvas.viewportTransform));
  object.setPositionByOrigin(center, 'center', 'center'); object.setCoords();
  executeCanvasTransaction({ canvas, pushHistory }, () => { canvas.discardActiveObject(); canvas.add(object); canvas.setActiveObject(object); });
  return true;
}

export function clipboardImage(data: DataTransfer): File | null {
  const files = Array.from(data.files ?? []);
  const svg = files.find((file) => file.type === 'image/svg+xml');
  if (svg) return svg;
  const text = data.getData('image/svg+xml') || data.getData('text/plain');
  if (/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text)) return new File([text], 'clipboard.svg', { type: 'image/svg+xml' });
  return files.find((file) => RASTER_MIME.test(file.type)) ?? null;
}
