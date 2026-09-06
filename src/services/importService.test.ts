import { describe, expect, it, vi } from 'vitest';
import * as fabric from 'fabric';
import { clipboardImage, importDrawingFile, validateImportSvg } from './importService';
import { historyService } from '../utils/historyService';
import { copyActive, currentClipboardMarker, waitForClipboardCopy } from '../utils/canvasCommands';

describe('external SVG and clipboard validation', () => {
  it('invalidates an unfinished internal copy instead of exposing older clipboard data', async () => {
    const canvas = new fabric.Canvas(document.createElement('canvas')); const rect = new fabric.Rect({ width: 10, height: 10 });
    canvas.add(rect); canvas.setActiveObject(rect); const clipboard = vi.fn();
    try {
      copyActive(canvas, clipboard, () => undefined); historyService.invalidate(); await waitForClipboardCopy();
      expect(currentClipboardMarker()).toBeNull(); expect(clipboard).toHaveBeenCalledExactlyOnceWith(null);
    } finally { await canvas.dispose(); }
  });
  it('discards a pending paste when an Undo or document restore changes ownership', async () => {
    const canvas = new fabric.Canvas(document.createElement('canvas'));
    let resolve!: (text: string) => void;
    const file = new File(['svg'], 'pending.svg', { type: 'image/svg+xml' });
    Object.defineProperty(file, 'text', { value: () => new Promise<string>((done) => { resolve = done; }) });
    const history = vi.fn();
    try {
      const result = importDrawingFile(canvas, file, history);
      historyService.invalidate();
      resolve('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
      expect(await result).toBe(false); expect(canvas.getObjects()).toHaveLength(0); expect(history).not.toHaveBeenCalled();
    } finally { await canvas.dispose(); }
  });
  it('accepts editable local geometry and local gradient references', () => {
    expect(validateImportSvg('<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="a"><stop offset="0" stop-color="red"/></linearGradient></defs><rect width="10" height="20" fill="url(#a)"/></svg>')).toContain('rect');
  });
  it.each([
    '<svg><script>alert(1)</script></svg>', '<svg onload="alert(1)"/>',
    '<svg><image href="https://example.org/private.png"/></svg>',
    '<svg><image href="data:image/svg+xml;base64,AAAA"/></svg>',
    '<svg><style>@import "https://example.org/style.css";</style></svg>',
    '<svg><rect style="fill:url(https://example.org/paint)"/></svg>',
    '<!DOCTYPE svg [<!ENTITY x "test">]><svg>&x;</svg>',
    '<svg><foreignObject/></svg>', '<html/>', '<svg><g></svg>',
    '<svg><use id="a" href="#a"/></svg>',
    '<svg><defs><g id="a"><use href="#b"/></g><g id="b"><use href="#a"/></g></defs><use href="#a"/></svg>',
  ])('rejects active, malformed or externally referenced SVG', (source) => expect(() => validateImportSvg(source)).toThrow());
  it('rejects excessive element counts', () => expect(() => validateImportSvg(`<svg>${'<rect/>'.repeat(10000)}</svg>`)).toThrow(/complex/));
  it('prefers SVG text over a raster fallback and ignores ordinary text', () => {
    const png = new File(['png'], 'clipboard.png', { type: 'image/png' });
    const data = { files: [png], getData: (type: string) => type === 'text/plain' ? '<svg><rect/></svg>' : '' } as unknown as DataTransfer;
    expect(clipboardImage(data)?.type).toBe('image/svg+xml');
    expect(clipboardImage({ files: [], getData: () => 'regular text' } as unknown as DataTransfer)).toBeNull();
  });
});
