import * as fabric from 'fabric';

/**
 * Return every object in one or more Fabric object trees exactly once.
 *
 * ActiveSelection children can also be present in Canvas#getObjects(), so the
 * identity set is important when this helper is used with the live canvas.
 */
export function collectFabricObjectTree(
  roots: readonly fabric.FabricObject[],
): fabric.FabricObject[] {
  const result: fabric.FabricObject[] = [];
  const seen = new Set<fabric.FabricObject>();

  const visit = (object: fabric.FabricObject): void => {
    if (seen.has(object)) return;
    seen.add(object);
    result.push(object);
    if (object instanceof fabric.Group || object instanceof fabric.ActiveSelection) {
      object.getObjects().forEach(visit);
    }
  };

  roots.forEach(visit);
  return result;
}

/**
 * Materialise an ActiveSelection's children in its parent coordinate plane.
 * This prevents the transient ActiveSelection wrapper from entering the
 * document model when a multi-object clone is added to the canvas.
 */
export function releaseActiveSelectionObjects(
  object: fabric.FabricObject,
): fabric.FabricObject[] {
  if (!(object instanceof fabric.ActiveSelection)) return [object];
  const children = [...object.getObjects()];
  object.remove(...children);
  object.dispose();
  return children;
}
