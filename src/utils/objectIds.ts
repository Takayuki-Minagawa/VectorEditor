import * as fabric from 'fabric';
import {
  getFabricMetadata,
  setFabricMetadataValues,
  type SemanticAnchor,
} from './fabricObjectMetadata';

let objectCounter = 0;

function sanitizeType(type: string | undefined): string {
  if (!type) return 'object';
  const normalized = type.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return normalized || 'object';
}

export function generateObjectId(type: string): string {
  objectCounter += 1;
  return `${sanitizeType(type)}_${objectCounter}_${Date.now()}`;
}

export function assignNewObjectId(obj: fabric.FabricObject, typeOverride?: string): string {
  const id = generateObjectId(typeOverride || obj.type);
  obj.set({ id } as Partial<fabric.FabricObject>);
  return id;
}

export function ensureObjectId(obj: fabric.FabricObject, typeOverride?: string): string {
  const withId = obj as fabric.FabricObject & { id?: string };
  if (withId.id) return withId.id;
  return assignNewObjectId(obj, typeOverride);
}

export function ensureObjectIdsRecursive(obj: fabric.FabricObject): void {
  ensureObjectId(obj);

  if (obj instanceof fabric.Group || obj instanceof fabric.ActiveSelection) {
    obj.getObjects().forEach((child) => ensureObjectIdsRecursive(child));
  }
}

export function reassignObjectIdsRecursive(obj: fabric.FabricObject): void {
  reassignObjectIdsAndReferences([obj]);
}

export interface ReassignObjectIdsOptions {
  /**
   * Remove links to objects outside the cloned graph while retaining x/y as
   * a stable fallback. Symbols must be self-contained; ordinary duplicate and
   * copy operations intentionally preserve their links to source objects.
   */
  dropExternalReferences?: boolean;
}

function visitObjectTree(
  object: fabric.FabricObject,
  visitor: (value: fabric.FabricObject) => void,
): void {
  visitor(object);
  if (object instanceof fabric.Group || object instanceof fabric.ActiveSelection) {
    object.getObjects().forEach((child) => visitObjectTree(child, visitor));
  }
}

/**
 * Reassign IDs for one cloned object graph and then repair semantic references
 * between its members. The two-pass approach is required when a dimension or
 * connector and its referenced shapes are duplicated together.
 */
export function reassignObjectIdsAndReferences(
  objects: readonly fabric.FabricObject[],
  options: ReassignObjectIdsOptions = {},
): Map<string, string> {
  const idMap = new Map<string, string>();

  objects.forEach((object) => visitObjectTree(object, (current) => {
    const oldId = getFabricMetadata(current).id;
    const newId = assignNewObjectId(current);
    if (oldId) idMap.set(oldId, newId);
  }));

  const remapAnchor = (anchor: SemanticAnchor): SemanticAnchor => {
    if (!anchor.objectId) return anchor;
    const remapped = idMap.get(anchor.objectId);
    if (remapped) return { ...anchor, objectId: remapped };
    if (!options.dropExternalReferences) return anchor;
    return { x: anchor.x, y: anchor.y };
  };

  objects.forEach((object) => visitObjectTree(object, (current) => {
    const metadata = getFabricMetadata(current);
    if (metadata.dimensionData) {
      setFabricMetadataValues(current, {
        dimensionData: {
          ...metadata.dimensionData,
          start: remapAnchor(metadata.dimensionData.start),
          end: remapAnchor(metadata.dimensionData.end),
        },
      });
    }
    if (metadata.connectorData) {
      setFabricMetadataValues(current, {
        connectorData: {
          ...metadata.connectorData,
          from: remapAnchor(metadata.connectorData.from),
          to: remapAnchor(metadata.connectorData.to),
        },
      });
    }
  }));

  return idMap;
}

/** Keep semantic fallback coordinates aligned when a cloned graph is moved. */
export function translateSemanticAnchors(
  objects: readonly fabric.FabricObject[],
  dx: number,
  dy: number,
): void {
  const translate = (anchor: SemanticAnchor): SemanticAnchor => ({
    ...anchor,
    x: anchor.x + dx,
    y: anchor.y + dy,
  });

  objects.forEach((object) => visitObjectTree(object, (current) => {
    const metadata = getFabricMetadata(current);
    if (metadata.dimensionData) {
      setFabricMetadataValues(current, {
        dimensionData: {
          ...metadata.dimensionData,
          start: translate(metadata.dimensionData.start),
          end: translate(metadata.dimensionData.end),
        },
      });
    }
    if (metadata.connectorData) {
      setFabricMetadataValues(current, {
        connectorData: {
          ...metadata.connectorData,
          from: translate(metadata.connectorData.from),
          to: translate(metadata.connectorData.to),
        },
      });
    }
  }));
}
