import * as fabric from 'fabric';
import type { SectionProfileData } from '../domain/section';
import { executeCanvasTransaction, type PushHistory } from './canvasCommands';
import { getFabricMetadata, setFabricMetadataValues } from './fabricObjectMetadata';
import { generateObjectId } from './objectIds';
import {
  differenceSectionProfiles,
  intersectSectionProfiles,
  unionSectionProfiles,
  xorSectionProfiles,
} from './sectionBoolean';
import {
  DEFAULT_SECTION_TOLERANCE_MM,
  isSupportedSectionSourceObject,
  sectionProfileFromFabricObject,
} from './sectionGeometry';
import { sectionProfileToPathData } from './sectionShapeFactory';
import { applyObjectDefaults } from './shapeFactory';
import { captureEditorStyle } from './stylePresets';

/**
 * General-purpose Boolean operations between closed shapes, following the
 * conventions shared by common vector editors (Illustrator Pathfinder, Figma
 * Boolean groups, Inkscape path menu):
 *
 * - union: merged outline of every selected shape
 * - subtract: the back-most shape minus every shape in front of it
 * - intersect: only the area shared by all selected shapes
 * - exclude: the symmetric difference (areas covered an odd number of times)
 *
 * The result replaces the sources as one even-odd compound path. Curved
 * boundaries are flattened by the shared section-geometry tolerance.
 */
export type ShapeBooleanOperation = 'union' | 'subtract' | 'intersect' | 'exclude';

export interface ShapeBooleanOptions {
  toleranceMm?: number;
  keepSources?: boolean;
}

export class ShapeBooleanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShapeBooleanError';
  }
}

/** Whether an object can participate in a Boolean operation (closed shapes only). */
export const isBooleanSourceObject = isSupportedSectionSourceObject;

function selectedDocumentObjects(canvas: fabric.Canvas): fabric.FabricObject[] {
  const active = canvas.getActiveObject();
  if (!active) return [];
  return active instanceof fabric.ActiveSelection ? [...active.getObjects()] : [active];
}

/** Applies one Boolean operation to the current selection and replaces it. */
export function applyBooleanOperationToSelection(
  canvas: fabric.Canvas,
  pushHistory: PushHistory,
  operation: ShapeBooleanOperation,
  options: ShapeBooleanOptions = {},
): fabric.Path {
  const selected = selectedDocumentObjects(canvas);
  if (selected.length < 2) {
    throw new ShapeBooleanError('Select two or more closed shapes for a Boolean operation.');
  }
  const unsupported = selected.find((object) => !isBooleanSourceObject(object));
  if (unsupported) {
    throw new ShapeBooleanError(
      'Boolean operations require closed shapes. Lines, open polylines and open paths are not supported.',
    );
  }

  // Evaluate in stacking order so "subtract" cuts the front shapes out of the
  // back-most shape, as users expect from other editors.
  const ordered = canvas.getObjects().filter((object) => selected.includes(object));
  const toleranceMm = options.toleranceMm ?? DEFAULT_SECTION_TOLERANCE_MM;
  const profiles = ordered.map((object) => sectionProfileFromFabricObject(object, toleranceMm));

  let result: SectionProfileData;
  switch (operation) {
    case 'union':
      result = unionSectionProfiles(profiles);
      break;
    case 'subtract':
      result = differenceSectionProfiles(profiles[0], profiles.slice(1));
      break;
    case 'intersect':
      result = intersectSectionProfiles(profiles);
      break;
    case 'exclude':
      result = xorSectionProfiles(profiles);
      break;
  }

  // Subtract keeps the subject (back-most) style; the other operations follow
  // the front-most shape, matching common editors.
  const styleSource = operation === 'subtract' ? ordered[0] : ordered[ordered.length - 1];
  const style = captureEditorStyle(styleSource);
  const path = new fabric.Path(sectionProfileToPathData(result), {
    fill: style.fill,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    strokeDashArray: style.strokeDashArray ? [...style.strokeDashArray] : undefined,
    opacity: style.opacity,
    fillRule: 'evenodd',
    objectCaching: false,
  });
  applyObjectDefaults(path, generateObjectId('path'), 'path');
  setFabricMetadataValues(path, { name: getFabricMetadata(styleSource).name });
  path.setCoords();

  const affectedIds = ordered
    .map((object) => getFabricMetadata(object).id)
    .filter((id): id is string => Boolean(id));

  return executeCanvasTransaction(
    { canvas, pushHistory },
    () => {
      canvas.discardActiveObject();
      const stackIndex = canvas.getObjects().indexOf(ordered[0]);
      if (options.keepSources !== true) {
        ordered.forEach((object) => canvas.remove(object));
      }
      canvas.insertAt(Math.min(stackIndex, canvas.getObjects().length), path);
      canvas.setActiveObject(path);
      return path;
    },
    { semanticUpdate: affectedIds },
  );
}
