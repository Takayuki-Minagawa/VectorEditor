import * as fabric from 'fabric';

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
  assignNewObjectId(obj);

  if (obj instanceof fabric.Group || obj instanceof fabric.ActiveSelection) {
    obj.getObjects().forEach((child) => reassignObjectIdsRecursive(child));
  }
}
