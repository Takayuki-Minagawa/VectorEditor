import { parseDxf, MAX_DXF_BYTES } from '../domain/dxf';

self.onmessage = (event: MessageEvent<{ buffer: ArrayBuffer; encoding: string }>) => {
  try {
    if (!(event.data.buffer instanceof ArrayBuffer) || event.data.buffer.byteLength > MAX_DXF_BYTES || !['utf-8', 'shift_jis'].includes(event.data.encoding)) throw new Error('Invalid DXF request');
    const source = new TextDecoder(event.data.encoding, { fatal: true }).decode(event.data.buffer);
    self.postMessage({ drawing: parseDxf(source) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'DXF parse failed' });
  }
};
