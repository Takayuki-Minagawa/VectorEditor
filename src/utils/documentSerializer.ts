import * as fabric from 'fabric';
import type {
  CadUnit,
  DocumentData,
  DrawingMode,
  Guide,
  SerializedCanvasData,
} from '../types';
import {
  applyPersistentObjectState,
  FABRIC_CUSTOM_PROPERTIES,
  prepareObjectMetadataForSerialization,
} from './fabricObjectMetadata';
import { historyService } from './historyService';
import { ensureObjectIdsRecursive } from './objectIds';

export const DOCUMENT_VERSION = 2;
export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;
export const MAX_CANVAS_DIMENSION = 1_000_000;
export const MAX_CAD_DIMENSION = 1_000_000_000;
export const MAX_FABRIC_OBJECTS = 100_000;

const MAX_JSON_DEPTH = 100;
const MAX_JSON_NODES = 1_000_000;
const MAX_GUIDES = 10_000;

type UnknownRecord = Record<string, unknown>;

export interface CanvasSnapshot {
  canvas: {
    width: number;
    height: number;
    backgroundColor: string;
  };
  objects: SerializedCanvasData;
  drawingMode?: DrawingMode;
  cadUnit?: CadUnit;
  scale?: string;
  cadWidth?: number;
  cadHeight?: number;
  gridVisible?: boolean;
  gridSize?: number;
  snapToGrid?: boolean;
  snapToObjects?: boolean;
  showRulers?: boolean;
  guides?: Guide[];
  snapToGuides?: boolean;
  orthoMode?: boolean;
}

export interface AutoSaveData extends CanvasSnapshot {
  version: number;
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
  gridVisible?: boolean;
  gridSize?: number;
  snapToGrid?: boolean;
  snapToObjects?: boolean;
  showRulers?: boolean;
  guides?: Guide[];
  snapToGuides?: boolean;
  orthoMode?: boolean;
}

export interface RestoreActions {
  setCanvasSize: (w: number, h: number) => void;
  setBackgroundColor: (color: string) => void;
  setDrawingMode: (mode: DrawingMode) => void;
  setCadUnit: (unit: CadUnit) => void;
  setScale: (scale: string) => void;
  setCadSize: (w: number, h: number) => void;
  restoreEditorSettings?: (snapshot: CanvasSnapshot) => void;
}

export interface DocumentRestoreOptions {
  /** Last known-good state restored if Fabric rejects the incoming payload. */
  rollbackSnapshot?: CanvasSnapshot;
}

/** A newer document restore took ownership before this attempt could commit. */
export class DocumentRestoreSupersededError extends Error {
  constructor() {
    super('Document restore was superseded');
    this.name = 'DocumentRestoreSupersededError';
  }
}

export function isDocumentRestoreSupersededError(
  error: unknown,
): error is DocumentRestoreSupersededError {
  return error instanceof DocumentRestoreSupersededError;
}

interface ValidationBudget {
  nodes: number;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, path: string): UnknownRecord {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  return value;
}

function assertString(value: unknown, path: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function assertFiniteNumber(
  value: unknown,
  path: string,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${path} is outside the supported range`);
  }
  return value;
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`);
  return value;
}

function validateJsonValue(
  value: unknown,
  path: string,
  depth: number,
  budget: ValidationBudget,
): void {
  budget.nodes += 1;
  if (budget.nodes > MAX_JSON_NODES) throw new Error('Fabric JSON is too complex');
  if (depth > MAX_JSON_DEPTH) throw new Error('Fabric JSON is nested too deeply');

  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateJsonValue(item, `${path}[${index}]`, depth + 1, budget));
    return;
  }
  if (!isRecord(value)) throw new Error(`${path} contains an unsupported value`);

  for (const [key, item] of Object.entries(value)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new Error(`${path} contains an unsafe property`);
    }
    validateJsonValue(item, `${path}.${key}`, depth + 1, budget);
  }
}

function parseEmbeddedJson(value: string, path: string): unknown {
  if (value.length > MAX_DOCUMENT_BYTES) throw new Error(`${path} is too large`);
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
}

function validateSerializedCanvas(value: unknown): SerializedCanvasData {
  const parsed = typeof value === 'string' ? parseEmbeddedJson(value, 'objects') : value;
  const record = assertRecord(parsed, 'objects');
  if (!Array.isArray(record.objects)) throw new Error('objects.objects must be an array');
  if (record.objects.length > MAX_FABRIC_OBJECTS) throw new Error('Document contains too many objects');

  record.objects.forEach((item, index) => {
    const object = assertRecord(item, `objects.objects[${index}]`);
    assertString(object.type, `objects.objects[${index}].type`, 128);
  });
  validateJsonValue(record, 'objects', 0, { nodes: 0 });
  return record as SerializedCanvasData;
}

function validateScale(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const scale = assertString(value, 'scale', 64);
  const match = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(scale);
  if (!match) throw new Error('scale must use the form 1:100');
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (
    !Number.isFinite(numerator)
    || !Number.isFinite(denominator)
    || numerator <= 0
    || denominator <= 0
    || numerator > MAX_CAD_DIMENSION
    || denominator > MAX_CAD_DIMENSION
  ) {
    throw new Error('scale is outside the supported range');
  }
  return `${numerator}:${denominator}`;
}

function validateGuides(value: unknown): Guide[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_GUIDES) {
    throw new Error('guides must be a supported array');
  }
  return value.map((item, index) => {
    const guide = assertRecord(item, `guides[${index}]`);
    if (guide.orientation !== 'h' && guide.orientation !== 'v') {
      throw new Error(`guides[${index}].orientation is invalid`);
    }
    return {
      orientation: guide.orientation,
      position: assertFiniteNumber(
        guide.position,
        `guides[${index}].position`,
        -MAX_CAD_DIMENSION,
        MAX_CAD_DIMENSION,
      ),
    };
  });
}

function validateDrawingMode(value: unknown): DrawingMode | undefined {
  if (value === undefined) return undefined;
  if (value !== 'illustration' && value !== 'cad') throw new Error('drawingMode is invalid');
  return value;
}

function validateCadUnit(value: unknown): CadUnit | undefined {
  if (value === undefined) return undefined;
  if (value !== 'mm' && value !== 'cm' && value !== 'm') throw new Error('cadUnit is invalid');
  return value;
}

function validateOptionalNumber(
  value: unknown,
  path: string,
  min: number,
  max: number,
): number | undefined {
  return value === undefined ? undefined : assertFiniteNumber(value, path, min, max);
}

function migrateToCurrent(input: UnknownRecord): UnknownRecord {
  const versionValue = input.version ?? 1;
  if (!Number.isInteger(versionValue) || typeof versionValue !== 'number') {
    throw new Error('version must be an integer');
  }
  if (versionValue < 1 || versionValue > DOCUMENT_VERSION) {
    throw new Error(`Unsupported document version: ${String(versionValue)}`);
  }

  let migrated: UnknownRecord = { ...input };
  let version = versionValue;
  if (version === 1) {
    // v1 embedded the Fabric payload as a second JSON string.  v2 stores it
    // as structured JSON, reducing parse ambiguity and simplifying validation.
    migrated = {
      ...migrated,
      objects: validateSerializedCanvas(migrated.objects),
      // These editor settings did not exist in v1. Opening a legacy document
      // must not inherit guides or snapping state from the document that was
      // previously open.
      gridVisible: migrated.gridVisible ?? false,
      gridSize: migrated.gridSize ?? 20,
      snapToGrid: migrated.snapToGrid ?? false,
      snapToObjects: migrated.snapToObjects ?? false,
      showRulers: migrated.showRulers ?? false,
      guides: migrated.guides ?? [],
      snapToGuides: migrated.snapToGuides ?? false,
      orthoMode: migrated.orthoMode ?? false,
      version: 2,
    };
    version = 2;
  }

  if (version !== DOCUMENT_VERSION) throw new Error('Document migration did not complete');
  return migrated;
}

function validateSnapshot(input: UnknownRecord): CanvasSnapshot {
  const canvas = assertRecord(input.canvas, 'canvas');
  const width = assertFiniteNumber(canvas.width, 'canvas.width', 1, MAX_CANVAS_DIMENSION);
  const height = assertFiniteNumber(canvas.height, 'canvas.height', 1, MAX_CANVAS_DIMENSION);
  const backgroundColor = assertString(canvas.backgroundColor, 'canvas.backgroundColor', 256);
  const cadWidth = validateOptionalNumber(input.cadWidth, 'cadWidth', 1, MAX_CAD_DIMENSION);
  const cadHeight = validateOptionalNumber(input.cadHeight, 'cadHeight', 1, MAX_CAD_DIMENSION);
  if ((cadWidth === undefined) !== (cadHeight === undefined)) {
    throw new Error('cadWidth and cadHeight must be provided together');
  }

  return {
    canvas: { width, height, backgroundColor },
    objects: validateSerializedCanvas(input.objects),
    drawingMode: validateDrawingMode(input.drawingMode),
    cadUnit: validateCadUnit(input.cadUnit),
    scale: validateScale(input.scale),
    cadWidth,
    cadHeight,
    gridVisible: optionalBoolean(input.gridVisible, 'gridVisible'),
    gridSize: validateOptionalNumber(input.gridSize, 'gridSize', 1, MAX_CANVAS_DIMENSION),
    snapToGrid: optionalBoolean(input.snapToGrid, 'snapToGrid'),
    snapToObjects: optionalBoolean(input.snapToObjects, 'snapToObjects'),
    showRulers: optionalBoolean(input.showRulers, 'showRulers'),
    guides: validateGuides(input.guides),
    snapToGuides: optionalBoolean(input.snapToGuides, 'snapToGuides'),
    orthoMode: optionalBoolean(input.orthoMode, 'orthoMode'),
  };
}

function parseRoot(raw: string, label: string): UnknownRecord {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_DOCUMENT_BYTES) {
    throw new Error(`${label} is empty or too large`);
  }
  try {
    return assertRecord(JSON.parse(raw) as unknown, label);
  } catch (error) {
    if (error instanceof Error && error.message !== `${label} must be an object`) throw error;
    throw new Error(`${label} is not valid JSON`);
  }
}

export function serializeCanvasObjects(canvas: fabric.Canvas): SerializedCanvasData {
  canvas.getObjects().forEach((object) => prepareObjectMetadataForSerialization(object));
  return canvas.toObject([...FABRIC_CUSTOM_PROPERTIES]) as SerializedCanvasData;
}

export async function restoreCanvasObjects(
  canvas: fabric.Canvas,
  objects: SerializedCanvasData | string,
  signal?: AbortSignal,
): Promise<void> {
  const validated = validateSerializedCanvas(objects);
  const renderOnAddRemove = canvas.renderOnAddRemove;
  try {
    await canvas.loadFromJSON(validated, undefined, signal ? { signal } : undefined);
  } finally {
    // Fabric disables this flag while enlivening. Its rejection path does not
    // reliably restore it, which would leave every later edit unrendered.
    canvas.renderOnAddRemove = renderOnAddRemove;
  }
  canvas.getObjects().forEach((object) => {
    ensureObjectIdsRecursive(object);
    applyPersistentObjectState(object);
  });
  canvas.requestRenderAll();
}

/**
 * Compose a snapshot around an already detached Fabric payload. History may
 * reuse that payload when only editor settings changed; callers must only pass
 * serialized objects that are no longer mutated by the live canvas.
 */
export function createCanvasSnapshot(
  input: CanvasStateInput,
  objects: SerializedCanvasData,
): CanvasSnapshot {
  return {
    canvas: {
      width: input.canvasWidth,
      height: input.canvasHeight,
      backgroundColor: input.backgroundColor,
    },
    objects,
    drawingMode: input.drawingMode,
    cadUnit: input.cadUnit,
    scale: input.scale,
    cadWidth: input.cadWidth,
    cadHeight: input.cadHeight,
    gridVisible: input.gridVisible,
    gridSize: input.gridSize,
    snapToGrid: input.snapToGrid,
    snapToObjects: input.snapToObjects,
    showRulers: input.showRulers,
    guides: input.guides?.map((guide) => ({ ...guide })),
    snapToGuides: input.snapToGuides,
    orthoMode: input.orthoMode,
  };
}

export function serializeCanvasSnapshot(input: CanvasStateInput): CanvasSnapshot {
  return createCanvasSnapshot(input, serializeCanvasObjects(input.canvas));
}

export function createDocumentData(input: CanvasStateInput): DocumentData {
  return {
    documentId: `doc_${Date.now()}`,
    ...serializeCanvasSnapshot(input),
    version: DOCUMENT_VERSION,
  };
}

export function parseDocumentData(raw: string): DocumentData {
  const migrated = migrateToCurrent(parseRoot(raw, 'document'));
  const snapshot = validateSnapshot(migrated);
  const documentId = assertString(migrated.documentId, 'documentId', 256);
  return {
    documentId,
    ...snapshot,
    version: DOCUMENT_VERSION,
  };
}

export function parseAutoSaveData(raw: string): AutoSaveData {
  const migrated = migrateToCurrent(parseRoot(raw, 'autosave'));
  const snapshot = validateSnapshot(migrated);
  const savedAtValue = migrated.savedAt;
  let savedAt: string | undefined;
  if (savedAtValue !== undefined) {
    savedAt = assertString(savedAtValue, 'savedAt', 64);
    if (!Number.isFinite(Date.parse(savedAt))) throw new Error('savedAt is invalid');
  }
  return {
    ...snapshot,
    version: DOCUMENT_VERSION,
    savedAt,
  };
}

function applyRestoreActions(data: CanvasSnapshot, actions: RestoreActions): void {
  actions.setCanvasSize(data.canvas.width, data.canvas.height);
  actions.setBackgroundColor(data.canvas.backgroundColor);
  if (data.drawingMode) actions.setDrawingMode(data.drawingMode);
  if (data.cadUnit) actions.setCadUnit(data.cadUnit);
  if (data.scale) actions.setScale(data.scale);
  if (typeof data.cadWidth === 'number' && typeof data.cadHeight === 'number') {
    actions.setCadSize(data.cadWidth, data.cadHeight);
  }
  actions.restoreEditorSettings?.(data);
}

/** Restore an opened/autosaved document and establish it as a new history root. */
export async function restoreDocumentData(
  canvas: fabric.Canvas,
  data: CanvasSnapshot,
  actions: RestoreActions,
  options: DocumentRestoreOptions = {},
): Promise<void> {
  const validated = validateSnapshot(data as unknown as UnknownRecord);
  const rollback = options.rollbackSnapshot
    ? validateSnapshot(options.rollbackSnapshot as unknown as UnknownRecord)
    : undefined;
  const runRestore = (snapshot: CanvasSnapshot) => {
    const promise = historyService.runDocumentRestore(async (signal) => {
      applyRestoreActions(snapshot, actions);
      await restoreCanvasObjects(canvas, snapshot.objects, signal);
    });
    return { generation: historyService.currentGeneration, promise };
  };

  let result;
  const attempt = runRestore(validated);
  try {
    result = await attempt.promise;
  } catch (error) {
    if (historyService.currentGeneration !== attempt.generation) {
      throw new DocumentRestoreSupersededError();
    }
    if (rollback) {
      const rollbackAttempt = runRestore(rollback);
      try {
        const rollbackResult = await rollbackAttempt.promise;
        // A newer explicit document restore owns the canvas when this rollback
        // is skipped; do not invalidate or overwrite that newer result.
        if (rollbackResult.status === 'skipped') throw new DocumentRestoreSupersededError();
      } catch (rollbackError) {
        if (
          isDocumentRestoreSupersededError(rollbackError)
          || historyService.currentGeneration !== rollbackAttempt.generation
        ) {
          throw new DocumentRestoreSupersededError();
        }
        if (rollbackError === error) throw error;
        throw new AggregateError([error, rollbackError], 'Document restore and rollback both failed');
      }
    }
    throw error;
  }
  if (
    result.status === 'skipped'
    || historyService.currentGeneration !== attempt.generation
  ) {
    throw new DocumentRestoreSupersededError();
  }
  historyService.notifyDocumentRestored(validated);
}
