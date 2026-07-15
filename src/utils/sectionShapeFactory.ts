import * as fabric from 'fabric';
import {
  normalizeSectionProfileData,
  type SectionPoint,
  type SectionProfileData,
} from '../domain/section';
import { setFabricMetadataValues } from './fabricObjectMetadata';

export type CreateSectionPathOptions = Partial<fabric.PathProps> & {
  id?: string;
  name?: string;
};

export type SectionProfilePath = fabric.Path & {
  objectKind: 'sectionProfile';
  sectionProfileData: SectionProfileData;
  id?: string;
  name?: string;
};

function svgNumber(value: number): string {
  if (Object.is(value, -0)) return '0';
  return Number(value.toPrecision(15)).toString();
}

function profilePathData(profile: SectionProfileData): string {
  return profile.rings.map((ring) => {
    const [first, ...rest] = ring.points;
    const commands = [`M ${svgNumber(first.x)} ${svgNumber(-first.y)}`];
    rest.forEach((point) => {
      commands.push(`L ${svgNumber(point.x)} ${svgNumber(-point.y)}`);
    });
    commands.push('Z');
    return commands.join(' ');
  }).join(' ');
}

function toLocalEngineeringPoint(point: SectionPoint, pathOffset: fabric.Point): SectionPoint {
  const canvasPoint = new fabric.Point(point.x, -point.y);
  return {
    x: canvasPoint.x - pathOffset.x,
    y: -(canvasPoint.y - pathOffset.y),
  };
}

/**
 * Creates a compound even-odd Fabric path at the profile's current document
 * position. Persisted section metadata is translated to object-local
 * x-right/y-up coordinates so later Fabric moves, rotations and scales can be
 * baked by readSectionProfileInDocumentCoordinates.
 */
export function createSectionPath(
  profileValue: SectionProfileData,
  options: CreateSectionPathOptions = {},
): SectionProfilePath {
  const profile = normalizeSectionProfileData(profileValue);
  const { id, name, ...pathOptions } = options;
  const path = new fabric.Path(profilePathData(profile), {
    objectCaching: false,
    ...pathOptions,
    // A non-zero winding fill would hide holes after export in renderers that
    // honour the Fabric property rather than the raw subpath direction.
    fillRule: 'evenodd',
  });
  const pathOffset = path.pathOffset;
  const localProfile = normalizeSectionProfileData({
    ...profile,
    rings: profile.rings.map((ring) => ({
      role: ring.role,
      points: ring.points.map((point) => toLocalEngineeringPoint(point, pathOffset)),
    })),
  });
  setFabricMetadataValues(path, {
    objectKind: 'sectionProfile',
    sectionProfileData: localProfile,
    id,
    name,
  });
  return path as SectionProfilePath;
}
