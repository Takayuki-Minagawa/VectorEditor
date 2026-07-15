import * as fabric from 'fabric';
import type { SectionProfileData } from '../domain/section';
import { captureEditorStyle } from './stylePresets';
import { executeCanvasTransaction, type PushHistory } from './canvasCommands';
import { differenceSectionProfiles, unionSectionProfiles } from './sectionBoolean';
import {
  filletSectionProfileConvexCorners,
  getMaximumSectionFilletRadius,
  listSectionProfileConvexCorners,
  type SectionConvexCorner,
  type SectionCornerReference,
} from './sectionFillet';
import {
  DEFAULT_SECTION_TOLERANCE_MM,
  sectionProfileFromFabricObject,
} from './sectionGeometry';
import { createSectionPath, type SectionProfilePath } from './sectionShapeFactory';
import { assignNewObjectId } from './objectIds';
import { getFabricMetadata } from './fabricObjectMetadata';

export interface SectionOperationOptions {
  toleranceMm?: number;
  keepSources?: boolean;
  filletCorners?: readonly SectionCornerReference[];
}

export class SectionCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SectionCommandError';
  }
}

function selectedDocumentObjects(canvas: fabric.Canvas): fabric.FabricObject[] {
  const active = canvas.getActiveObject();
  if (!active) return [];
  return active instanceof fabric.ActiveSelection ? [...active.getObjects()] : [active];
}

function profileForObject(object: fabric.FabricObject, toleranceMm: number): SectionProfileData {
  return sectionProfileFromFabricObject(object, toleranceMm);
}

function createStyledSectionPath(
  profile: SectionProfileData,
  source: fabric.FabricObject,
  preserveId: boolean,
): SectionProfilePath {
  const style = captureEditorStyle(source);
  const metadata = getFabricMetadata(source);
  const path = createSectionPath(profile, {
    fill: style.fill === 'transparent' || style.fill === '' ? '#d9eaf7' : style.fill,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    opacity: style.opacity,
    id: preserveId ? metadata.id : undefined,
    name: metadata.name,
  });
  if (!getFabricMetadata(path).id) assignNewObjectId(path, 'sectionProfile');
  path.setCoords();
  return path;
}

function commitSectionReplacement(
  canvas: fabric.Canvas,
  selected: readonly fabric.FabricObject[],
  result: SectionProfileData,
  source: fabric.FabricObject,
  pushHistory: PushHistory,
  keepSources: boolean,
): SectionProfilePath {
  const sourceIsSection = getFabricMetadata(source).objectKind === 'sectionProfile';
  const path = createStyledSectionPath(result, source, sourceIsSection && !keepSources);
  return executeCanvasTransaction(
    { canvas, pushHistory },
    () => {
      canvas.discardActiveObject();
      if (!keepSources) selected.forEach((object) => canvas.remove(object));
      canvas.add(path);
      canvas.setActiveObject(path);
      return path;
    },
    { semanticUpdate: 'all' },
  );
}

function tolerance(options: SectionOperationOptions): number {
  return options.toleranceMm ?? DEFAULT_SECTION_TOLERANCE_MM;
}

/** Converts all selected supported closed shapes into one unioned section. */
export function createSectionFromSelection(
  canvas: fabric.Canvas,
  pushHistory: PushHistory,
  options: SectionOperationOptions = {},
): SectionProfilePath {
  const selected = selectedDocumentObjects(canvas);
  if (selected.length === 0) throw new SectionCommandError('Select at least one supported closed shape.');
  const toleranceMm = tolerance(options);
  const profiles = selected.map((object) => profileForObject(object, toleranceMm));
  const result = unionSectionProfiles(profiles);
  const source = selected.find((object) => getFabricMetadata(object).objectKind === 'sectionProfile')
    ?? selected[0];
  return commitSectionReplacement(
    canvas,
    selected,
    result,
    source,
    pushHistory,
    options.keepSources === true,
  );
}

/** Alias used by UI wording when adding more material to an existing section. */
export const unionSelectionAsSection = createSectionFromSelection;

/** Uses one selected section profile (or the first selected shape) as subject and the rest as cutters. */
export function subtractSelectionFromSection(
  canvas: fabric.Canvas,
  pushHistory: PushHistory,
  options: SectionOperationOptions = {},
): SectionProfilePath {
  const selected = selectedDocumentObjects(canvas);
  if (selected.length < 2) {
    throw new SectionCommandError('Select a section subject and at least one closed cutter shape.');
  }
  const sectionObjects = selected.filter(
    (object) => getFabricMetadata(object).objectKind === 'sectionProfile',
  );
  if (sectionObjects.length > 1) {
    throw new SectionCommandError('Select only one existing section profile as the subtraction subject.');
  }
  const subject = sectionObjects[0] ?? selected[0];
  const cutters = selected.filter((object) => object !== subject);
  const toleranceMm = tolerance(options);
  const result = differenceSectionProfiles(
    profileForObject(subject, toleranceMm),
    cutters.map((object) => profileForObject(object, toleranceMm)),
  );
  return commitSectionReplacement(
    canvas,
    selected,
    result,
    subject,
    pushHistory,
    options.keepSources === true,
  );
}

/** Lists the convex outer corners of the single selected section in document coordinates. */
export function listSelectedSectionConvexCorners(
  canvas: fabric.Canvas,
  options: Pick<SectionOperationOptions, 'toleranceMm'> = {},
): SectionConvexCorner[] {
  const selected = selectedDocumentObjects(canvas);
  if (selected.length !== 1) throw new SectionCommandError('Select exactly one section profile.');
  return listSectionProfileConvexCorners(profileForObject(selected[0], tolerance(options)));
}

/** Returns the shared-edge-aware radius limit for the requested corners of one selected section. */
export function getSelectedSectionMaximumFilletRadius(
  canvas: fabric.Canvas,
  options: Pick<SectionOperationOptions, 'toleranceMm' | 'filletCorners'> = {},
): number {
  const selected = selectedDocumentObjects(canvas);
  if (selected.length !== 1) throw new SectionCommandError('Select exactly one section profile.');
  return getMaximumSectionFilletRadius(
    profileForObject(selected[0], tolerance(options)),
    options.filletCorners,
  );
}

/** Applies one radius to selected convex outer corners, or every corner when unspecified. */
export function filletSelectedSection(
  canvas: fabric.Canvas,
  pushHistory: PushHistory,
  radiusMm: number,
  options: SectionOperationOptions = {},
): SectionProfilePath {
  const selected = selectedDocumentObjects(canvas);
  if (selected.length !== 1) throw new SectionCommandError('Select exactly one section profile.');
  const source = selected[0];
  const profile = profileForObject(source, tolerance(options));
  const result = filletSectionProfileConvexCorners(profile, radiusMm, options.filletCorners);
  return commitSectionReplacement(
    canvas,
    selected,
    result,
    source,
    pushHistory,
    options.keepSources === true,
  );
}
