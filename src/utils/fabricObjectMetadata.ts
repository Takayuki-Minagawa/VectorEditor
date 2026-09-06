import * as fabric from 'fabric';
import type { CadUnit } from '../types';
import type { SectionProfileData } from '../domain/section';

/**
 * Semantic anchors are stored in document coordinates.  `objectId` and
 * `anchor` make the point associative, while x/y are a stable fallback when
 * the referenced object no longer exists.
 */
export type ObjectAnchorKind =
  | 'start'
  | 'end'
  | 'midpoint'
  | 'center'
  | 'topLeft'
  | 'topRight'
  | 'bottomRight'
  | 'bottomLeft'
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'vertex';

export interface SemanticAnchor {
  x: number;
  y: number;
  objectId?: string;
  anchor?: ObjectAnchorKind;
  vertexIndex?: number;
}

export interface DimensionData {
  start: SemanticAnchor;
  end: SemanticAnchor;
  precision?: number;
  unit?: CadUnit;
}

export type ConnectorRoute = 'straight' | 'elbow';

export interface ConnectorData {
  from: SemanticAnchor;
  to: SemanticAnchor;
  route: ConnectorRoute;
}

export interface CadOwnAppearance {
  stroke: string | null | ReturnType<fabric.Gradient<'linear' | 'radial'>['toObject']>;
  fill?: string | null | ReturnType<fabric.Gradient<'linear' | 'radial'>['toObject']>;
  strokeWidth: number;
  strokeDashArray: number[] | null;
}

/** Properties whose meaning belongs to the document, not to the current UI. */
export interface FabricSemanticMetadata {
  cadLayerId?: string;
  cadStyleMode?: 'object' | 'layer';
  cadOwnAppearance?: CadOwnAppearance;
  cadVisible?: boolean;
  id?: string;
  name?: string;
  objectKind?: string;
  locked?: boolean;
  dimensionData?: DimensionData;
  connectorData?: ConnectorData;
  sectionProfileData?: SectionProfileData;
  latexSource?: string;
  latexFontSize?: number;
}

export type FabricObjectWithMetadata = fabric.FabricObject & FabricSemanticMetadata;

/**
 * Keep this list typed so adding a serialised property requires adding its
 * document type above.  Interaction-only fields such as selectable/evented
 * intentionally do not appear here.
 */
export const FABRIC_CUSTOM_PROPERTIES = [
  'cadLayerId',
  'cadStyleMode',
  'cadOwnAppearance',
  'cadVisible',
  'id',
  'name',
  'objectKind',
  'locked',
  'dimensionData',
  'connectorData',
  'sectionProfileData',
  'latexSource',
  'latexFontSize',
] as const satisfies readonly (keyof FabricSemanticMetadata)[];

// Fabric clone() serializes without an explicit properties list. Register all
// persistent document metadata once so duplicate, copy/paste, and Alt-drag
// preserve the semantic payload as well as JSON save/load does.
fabric.FabricObject.customProperties = [
  ...new Set([
    ...fabric.FabricObject.customProperties,
    ...FABRIC_CUSTOM_PROPERTIES,
  ]),
];

export function getFabricMetadata(object: fabric.FabricObject): FabricSemanticMetadata {
  const metadata = object as FabricObjectWithMetadata;
  return {
    cadLayerId: metadata.cadLayerId,
    cadStyleMode: metadata.cadStyleMode,
    cadOwnAppearance: metadata.cadOwnAppearance,
    cadVisible: metadata.cadVisible,
    id: metadata.id,
    name: metadata.name,
    objectKind: metadata.objectKind,
    locked: metadata.locked,
    dimensionData: metadata.dimensionData,
    connectorData: metadata.connectorData,
    sectionProfileData: metadata.sectionProfileData,
    latexSource: metadata.latexSource,
    latexFontSize: metadata.latexFontSize,
  };
}

export function setFabricMetadata<K extends keyof FabricSemanticMetadata>(
  object: fabric.FabricObject,
  key: K,
  value: FabricSemanticMetadata[K],
): void {
  Object.assign(object as FabricObjectWithMetadata, { [key]: value });
}

export function setFabricMetadataValues(
  object: fabric.FabricObject,
  values: Partial<FabricSemanticMetadata>,
): void {
  Object.assign(object as FabricObjectWithMetadata, values);
}

function visitObjects(
  object: fabric.FabricObject,
  visitor: (value: fabric.FabricObject) => void,
): void {
  visitor(object);
  if (object instanceof fabric.Group || object instanceof fabric.ActiveSelection) {
    object.getObjects().forEach((child) => visitObjects(child, visitor));
  }
}

/**
 * Bridge legacy lock flags to the persistent `locked` property immediately
 * before serialisation.  This keeps documents produced by old UI call sites
 * correct while those call sites migrate to the metadata helper.
 */
export function prepareObjectMetadataForSerialization(object: fabric.FabricObject): void {
  visitObjects(object, (current) => {
    const metadata = current as FabricObjectWithMetadata;
    if (metadata.cadLayerId !== undefined && metadata.locked !== undefined) return;
    metadata.locked = Boolean(
      current.lockMovementX
      || current.lockMovementY
      || current.lockScalingX
      || current.lockScalingY
      || current.lockRotation,
    );
  });
}

/** Rebuild transient Fabric interaction flags from persistent metadata. */
export function applyPersistentObjectState(object: fabric.FabricObject): void {
  visitObjects(object, (current) => {
    const { locked = false } = current as FabricObjectWithMetadata;
    current.set({
      selectable: true,
      evented: true,
      lockMovementX: locked,
      lockMovementY: locked,
      lockScalingX: locked,
      lockScalingY: locked,
      lockRotation: locked,
      hasControls: !locked,
    });
  });
}

export function setPersistentObjectLocked(
  object: fabric.FabricObject,
  locked: boolean,
  recursive = true,
): void {
  const apply = (current: fabric.FabricObject): void => {
    setFabricMetadata(current, 'locked', locked);
    current.set({
      lockMovementX: locked,
      lockMovementY: locked,
      lockScalingX: locked,
      lockScalingY: locked,
      lockRotation: locked,
      hasControls: !locked,
    });
  };
  if (recursive) visitObjects(object, apply);
  else apply(object);
}
