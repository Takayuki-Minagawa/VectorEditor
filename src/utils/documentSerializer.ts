import { defaultCadLayers, validateCadLayers, type CadLayer } from '../domain/cadLayer';
import { applyCadLayers, canonicalizeSerializedLayers, canvasCadLayers } from './cadLayers';
import * as fabric from 'fabric';
import type {
  CadUnit,
  DocumentData,
  DrawingMode,
  DocumentPage,
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
import { validateSectionProfileData, type SectionProfileData } from '../domain/section';
import { assertValidSectionProfileTopology } from './sectionTopology';

export const DOCUMENT_VERSION = 4;
export const MAX_DOCUMENT_PAGES = 50;
export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;
export const MAX_CANVAS_DIMENSION = 1_000_000;
export const MAX_CAD_DIMENSION = 1_000_000_000;
export const MAX_FABRIC_OBJECTS = 100_000;

const MAX_JSON_DEPTH = 100;
const MAX_JSON_NODES = 1_000_000;
const MAX_GUIDES = 10_000;
const MAX_SECTION_RINGS = 10_000;
const MAX_SECTION_POINTS = 100_000;

type UnknownRecord = Record<string, unknown>;

export interface CanvasSnapshot {
  pages?: DocumentPage[];
  activePageId?: string;
  cadLayers?: CadLayer[];
  activeCadLayerId?: string;
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
  pages?: DocumentPage[];
  activePageId?: string;
  cadLayers?: CadLayer[];
  activeCadLayerId?: string;
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

  // Fabric's in-memory `toObject()` payload can retain optional properties as
  // `undefined` (for example `strokeDashArray`). JSON files cannot contain
  // that value, but history restores validate the in-memory payload directly.
  if (value === undefined || value === null || typeof value === 'boolean' || typeof value === 'string') return;
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

  // Enforce the generic complexity/depth budget before the section-specific
  // walk so a maliciously deep Fabric group cannot overflow the call stack.
  validateJsonValue(record, 'objects', 0, { nodes: 0 });

  const validateObjectSectionData = (object: UnknownRecord, path: string): void => {
    if (object.bezierNodeModes !== undefined) {
      const modes = assertRecord(object.bezierNodeModes, `${path}.bezierNodeModes`);
      if (Object.keys(modes).length > 100_000) throw new Error('Too many Bézier node modes');
      for (const [key, mode] of Object.entries(modes)) {
        if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) > 100_000 || !['cusp', 'smooth', 'symmetric'].includes(String(mode))) throw new Error('Invalid Bézier node mode');
      }
    }
    if (object.dxfCurveData !== undefined) {
      const curve = assertRecord(object.dxfCurveData, `${path}.dxfCurveData`);
      if (curve.kind !== 'arc' && curve.kind !== 'polyline') throw new Error('Invalid DXF curve kind');
      if (!Array.isArray(curve.baseMatrix) || curve.baseMatrix.length !== 6) throw new Error('Invalid DXF curve transform');
      curve.baseMatrix.forEach((value, index) => assertFiniteNumber(value, `dxfCurveData.baseMatrix[${index}]`, -1e9, 1e9));
      assertString(curve.pathSignature, 'dxfCurveData.pathSignature', 8_000_000);
      if (curve.kind === 'arc') {
        const center = assertRecord(curve.center, 'dxfCurveData.center');
        assertFiniteNumber(center.x, 'dxfCurveData.center.x', -1e9, 1e9);
        assertFiniteNumber(center.y, 'dxfCurveData.center.y', -1e9, 1e9);
        assertFiniteNumber(curve.radius, 'dxfCurveData.radius', 1e-10, 1e9);
        assertFiniteNumber(curve.startAngle, 'dxfCurveData.startAngle', -1e9, 1e9);
        assertFiniteNumber(curve.endAngle, 'dxfCurveData.endAngle', -1e9, 1e9);
      } else {
        if (!Array.isArray(curve.points) || !Array.isArray(curve.bulges)
          || curve.points.length < 2 || curve.points.length > 100_000 || curve.bulges.length !== curve.points.length
          || typeof curve.closed !== 'boolean') throw new Error('Invalid DXF polyline');
        curve.points.forEach((item, index) => {
          const point = assertRecord(item, `dxfCurveData.points[${index}]`);
          assertFiniteNumber(point.x, 'DXF point x', -1e9, 1e9);
          assertFiniteNumber(point.y, 'DXF point y', -1e9, 1e9);
          assertFiniteNumber((curve.bulges as unknown[])[index], 'DXF bulge', -1e9, 1e9);
        });
      }
    }
    if (object.cadLayerId !== undefined) assertString(object.cadLayerId, `${path}.cadLayerId`, 100);
    if (object.cadStyleMode !== undefined && object.cadStyleMode !== 'layer' && object.cadStyleMode !== 'object') throw new Error('Invalid CAD style mode');
    optionalBoolean(object.cadVisible, `${path}.cadVisible`);
    if (object.cadOwnAppearance !== undefined) {
      const own = assertRecord(object.cadOwnAppearance, 'cadOwnAppearance');
      for (const key of ['fill', 'stroke']) {
        const color = own[key];
        if (color === null || (key === 'fill' && color === undefined)) continue;
        if (typeof color === 'string' && color.length <= 256) continue;
        const gradient = assertRecord(color, 'own gradient');
        if (!['linear', 'radial'].includes(String(gradient.type)) || !isRecord(gradient.coords) || Object.values(gradient.coords).some((v) => typeof v !== 'number' || !Number.isFinite(v))
          || !Array.isArray(gradient.colorStops) || gradient.colorStops.length > 10000 || gradient.colorStops.some((stop) => !isRecord(stop) || typeof stop.color !== 'string' || stop.color.length > 256 || typeof stop.offset !== 'number' || stop.offset < 0 || stop.offset > 1)) throw new Error('Invalid own gradient');
        for (const coordinate of gradient.type === 'radial' ? ['x1', 'y1', 'r1', 'x2', 'y2', 'r2'] : ['x1', 'y1', 'x2', 'y2']) assertFiniteNumber(gradient.coords[coordinate], `gradient.${coordinate}`, -1e9, 1e9);
        if (gradient.gradientUnits !== 'pixels' && gradient.gradientUnits !== 'percentage') throw new Error('Invalid gradient units');
        for (const stop of gradient.colorStops as UnknownRecord[]) if (stop.opacity !== undefined) assertFiniteNumber(stop.opacity, 'gradient opacity', 0, 1);
        if (gradient.gradientTransform !== undefined && (!Array.isArray(gradient.gradientTransform) || gradient.gradientTransform.length !== 6 || gradient.gradientTransform.some((v) => typeof v !== 'number' || !Number.isFinite(v)))) throw new Error('Invalid gradient transform');
      }
      assertFiniteNumber(own.strokeWidth, 'strokeWidth', 0, 1000000);
      if (own.strokeDashArray !== null && (!Array.isArray(own.strokeDashArray) || own.strokeDashArray.length > 100 || own.strokeDashArray.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0))) throw new Error('Invalid own line type');
    }
    if (object.sectionProfileData !== undefined) {
      const sectionData = object.sectionProfileData;
      if (isRecord(sectionData) && Array.isArray(sectionData.rings)) {
        if (sectionData.rings.length > MAX_SECTION_RINGS) {
          throw new Error(`${path}.sectionProfileData contains too many rings`);
        }
        let pointCount = 0;
        sectionData.rings.forEach((candidate) => {
          if (isRecord(candidate) && Array.isArray(candidate.points)) {
            pointCount += candidate.points.length;
            if (pointCount > MAX_SECTION_POINTS) {
              throw new Error(`${path}.sectionProfileData contains too many points`);
            }
          }
        });
      }

      const validation = validateSectionProfileData(object.sectionProfileData);
      if (!validation.valid) {
        throw new Error(`${path}.sectionProfileData is invalid: ${validation.issues[0]?.message ?? 'unknown error'}`);
      }
      const profile = object.sectionProfileData as SectionProfileData;
      assertValidSectionProfileTopology(profile);
      if (profile.analysisToleranceMm > MAX_CAD_DIMENSION) {
        throw new Error(`${path}.sectionProfileData tolerance is outside the supported range`);
      }
      profile.rings.forEach((ring) => ring.points.forEach((point) => {
        if (Math.abs(point.x) > MAX_CAD_DIMENSION || Math.abs(point.y) > MAX_CAD_DIMENSION) {
          throw new Error(`${path}.sectionProfileData coordinate is outside the supported range`);
        }
      }));
    }
    if (object.objectKind === 'sectionProfile' && object.sectionProfileData === undefined) {
      throw new Error(`${path}.sectionProfileData is required for a sectionProfile object`);
    }
    if (object.sectionProfileData !== undefined && object.objectKind !== 'sectionProfile') {
      throw new Error(`${path}.objectKind must be sectionProfile when sectionProfileData is present`);
    }
    if (Array.isArray(object.objects)) {
      object.objects.forEach((child, childIndex) => {
        const childObject = assertRecord(child, `${path}.objects[${childIndex}]`);
        validateObjectSectionData(childObject, `${path}.objects[${childIndex}]`);
      });
    }
  };

  record.objects.forEach((item, index) => {
    const object = assertRecord(item, `objects.objects[${index}]`);
    assertString(object.type, `objects.objects[${index}].type`, 128);
    validateObjectSectionData(object, `objects.objects[${index}]`);
  });
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

  if (version === 2) {
    migrated = { ...migrated, cadLayers: defaultCadLayers(), activeCadLayerId: '0', version: 3 };
    version = 3;
  }
  if (version === 3 && (migrated.cadLayers === undefined || migrated.activeCadLayerId === undefined)) throw new Error('CAD layer table is required');

  if (version === 3) {
    migrated = {
      ...migrated,
      pages: [{ id: 'page_1', name: 'Page 1', canvas: migrated.canvas, objects: migrated.objects }],
      activePageId: 'page_1',
      version: 4,
    };
    version = 4;
  }
  if (version === 4 && (migrated.cadLayers === undefined || migrated.activeCadLayerId === undefined)) throw new Error('CAD layer table is required');
  if (version === 4 && (migrated.pages === undefined || migrated.activePageId === undefined)) throw new Error('Page table is required');

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

  const cadLayers = validateCadLayers(input.cadLayers ?? defaultCadLayers());
  const activeCadLayerId = input.activeCadLayerId === undefined ? '0' : assertString(input.activeCadLayerId, 'activeCadLayerId', 100);
  if (!cadLayers.some((l) => l.id === activeCadLayerId)) throw new Error('Active CAD layer is missing');
  const objects = validateSerializedCanvas(input.objects);
  let pages: DocumentPage[] | undefined;
  let activePageId: string | undefined;
  if (input.pages !== undefined) {
    if (!Array.isArray(input.pages) || input.pages.length < 1 || input.pages.length > MAX_DOCUMENT_PAGES) throw new Error('Invalid page count');
    const ids = new Set<string>();
    pages = input.pages.map((candidate, index) => {
      const page = assertRecord(candidate, `pages[${index}]`);
      const id = assertString(page.id, `pages[${index}].id`, 100);
      const name = assertString(page.name, `pages[${index}].name`, 100);
      if (ids.has(id)) throw new Error('Duplicate page id');
      ids.add(id);
      const pageCanvas = assertRecord(page.canvas, `pages[${index}].canvas`);
      return {
        id, name,
        canvas: {
          width: assertFiniteNumber(pageCanvas.width, 'page width', 1, MAX_CANVAS_DIMENSION),
          height: assertFiniteNumber(pageCanvas.height, 'page height', 1, MAX_CANVAS_DIMENSION),
          backgroundColor: assertString(pageCanvas.backgroundColor, 'page background', 256),
        },
        objects: validateSerializedCanvas(page.objects),
      };
    });
    activePageId = assertString(input.activePageId, 'activePageId', 100);
    const active = pages.find((page) => page.id === activePageId);
    if (!active) throw new Error('Active page is missing');
    if (input.drawingMode === 'cad' && pages.length > 1) throw new Error('CAD documents support one page');
    if (pages.reduce((count, page) => count + page.objects.objects.length, 0) > MAX_FABRIC_OBJECTS) throw new Error('Document contains too many objects');
    if (active.canvas.width !== width || active.canvas.height !== height || active.canvas.backgroundColor !== backgroundColor
      || JSON.stringify(active.objects) !== JSON.stringify(objects)) throw new Error('Active page does not match document canvas');
  }
  const visitLayers = (items: unknown[]) => items.forEach((item) => {
    const object = item as UnknownRecord;
    if (object.cadLayerId !== undefined && !cadLayers.some((l) => l.id === object.cadLayerId)) throw new Error('Unknown CAD layer reference');
    if (Array.isArray(object.objects)) visitLayers(object.objects);
  });
  visitLayers(objects.objects);
  pages?.forEach((page) => visitLayers(page.objects.objects));
  return {
    pages,
    activePageId,
    cadLayers,
    activeCadLayerId,
    canvas: { width, height, backgroundColor },
    objects,
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
  const data = canvas.toObject([...FABRIC_CUSTOM_PROPERTIES]) as SerializedCanvasData;
  canonicalizeSerializedLayers(data.objects);
  return data;
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
  applyCadLayers(canvas);
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
  const activePageId = input.activePageId ?? 'page_1';
  const activePage: DocumentPage = {
    id: activePageId,
    name: input.pages?.find((page) => page.id === activePageId)?.name ?? 'Page 1',
    canvas: { width: input.canvasWidth, height: input.canvasHeight, backgroundColor: input.backgroundColor },
    objects,
  };
  const pages = input.pages?.length
    ? input.pages.map((page) => page.id === activePageId ? activePage : page)
    : [activePage];
  return {
    pages,
    activePageId,
    canvas: {
      width: input.canvasWidth,
      height: input.canvasHeight,
      backgroundColor: input.backgroundColor,
    },
    objects,
    cadLayers: structuredClone(input.cadLayers ?? canvasCadLayers(input.canvas)),
    activeCadLayerId: input.activeCadLayerId ?? '0',
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
