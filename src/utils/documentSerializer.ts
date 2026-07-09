import * as fabric from 'fabric';
import type { CadUnit, DocumentData, DrawingMode } from '../types';
import { ensureObjectIdsRecursive } from './objectIds';

const FABRIC_CUSTOM_PROPS = ['id', 'name', 'selectable', 'evented'];
const DOCUMENT_VERSION = 1;

export interface CanvasSnapshot {
  canvas: {
    width: number;
    height: number;
    backgroundColor: string;
  };
  objects: string;
  drawingMode?: DrawingMode;
  cadUnit?: CadUnit;
  scale?: string;
  cadWidth?: number;
  cadHeight?: number;
}

export interface AutoSaveData extends CanvasSnapshot {
  savedAt?: string;
}

export interface CanvasStateInput {
  canvas: fabric.Canvas;
  canvasWidth: number;
  canvasHeight: number;
  backgroundColor: string;
  drawingMode: DrawingMode;
  cadUnit: CadUnit;
  scale: string;
  cadWidth: number;
  cadHeight: number;
}

export interface RestoreActions {
  setCanvasSize: (w: number, h: number) => void;
  setBackgroundColor: (color: string) => void;
  setDrawingMode: (mode: DrawingMode) => void;
  setCadUnit: (unit: CadUnit) => void;
  setScale: (scale: string) => void;
  setCadSize: (w: number, h: number) => void;
}

export function serializeCanvasObjects(canvas: fabric.Canvas): string {
  return JSON.stringify(canvas.toObject(FABRIC_CUSTOM_PROPS));
}

export async function restoreCanvasObjects(canvas: fabric.Canvas, objects: string): Promise<void> {
  await canvas.loadFromJSON(JSON.parse(objects));
  canvas.getObjects().forEach((obj) => ensureObjectIdsRecursive(obj));
  canvas.requestRenderAll();
}

export function serializeCanvasSnapshot(input: CanvasStateInput): CanvasSnapshot {
  return {
    canvas: {
      width: input.canvasWidth,
      height: input.canvasHeight,
      backgroundColor: input.backgroundColor,
    },
    objects: serializeCanvasObjects(input.canvas),
    drawingMode: input.drawingMode,
    cadUnit: input.cadUnit,
    scale: input.scale,
    cadWidth: input.cadWidth,
    cadHeight: input.cadHeight,
  };
}

export function createDocumentData(input: CanvasStateInput): DocumentData {
  return {
    documentId: `doc_${Date.now()}`,
    ...serializeCanvasSnapshot(input),
    version: DOCUMENT_VERSION,
  };
}

export function parseDocumentData(raw: string): DocumentData {
  const parsed = JSON.parse(raw) as DocumentData;
  if (!parsed || !parsed.canvas || typeof parsed.objects !== 'string') {
    throw new Error('Invalid document data');
  }
  return parsed;
}

export function parseAutoSaveData(raw: string): AutoSaveData {
  const parsed = JSON.parse(raw) as AutoSaveData;
  if (!parsed || !parsed.canvas || typeof parsed.objects !== 'string') {
    throw new Error('Invalid autosave data');
  }
  return parsed;
}

export async function restoreDocumentData(
  canvas: fabric.Canvas,
  data: CanvasSnapshot,
  actions: RestoreActions,
): Promise<void> {
  actions.setCanvasSize(data.canvas.width, data.canvas.height);
  actions.setBackgroundColor(data.canvas.backgroundColor);
  if (data.drawingMode) actions.setDrawingMode(data.drawingMode);
  if (data.cadUnit) actions.setCadUnit(data.cadUnit);
  if (data.scale) actions.setScale(data.scale);
  if (typeof data.cadWidth === 'number' && typeof data.cadHeight === 'number') {
    actions.setCadSize(data.cadWidth, data.cadHeight);
  }

  await restoreCanvasObjects(canvas, data.objects);
}
