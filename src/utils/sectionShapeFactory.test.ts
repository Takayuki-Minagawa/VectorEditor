import { describe, expect, it } from 'vitest';
import type { SectionProfileData } from '../domain/section';
import { readSectionProfileInDocumentCoordinates } from './sectionGeometry';
import { createSectionPath } from './sectionShapeFactory';

const PROFILE: SectionProfileData = {
  version: 1,
  rings: [
    {
      role: 'outer',
      points: [
        { x: 100, y: -200 },
        { x: 180, y: -200 },
        { x: 180, y: -140 },
        { x: 100, y: -140 },
      ],
    },
    {
      role: 'hole',
      points: [
        { x: 120, y: -180 },
        { x: 120, y: -160 },
        { x: 150, y: -160 },
        { x: 150, y: -180 },
      ],
    },
  ],
  analysisToleranceMm: 0.005,
  approximate: false,
};

describe('createSectionPath', () => {
  it('creates an even-odd compound path with local persistent metadata', () => {
    const path = createSectionPath(PROFILE, {
      fill: '#999999',
      stroke: '#222222',
      strokeWidth: 0,
      id: 'section-1',
      name: 'Hollow section',
    });

    expect(path).toBeInstanceOf(Object);
    expect(path.type).toBe('path');
    expect(path.fillRule).toBe('evenodd');
    expect(path.path.filter((command) => command[0] === 'M')).toHaveLength(2);
    expect(path.objectKind).toBe('sectionProfile');
    expect(path.id).toBe('section-1');
    expect(path.name).toBe('Hollow section');
    expect(path.sectionProfileData.rings[0].points).not.toEqual(PROFILE.rings[0].points);
  });

  it('preserves document placement through the local-metadata round trip', () => {
    const path = createSectionPath(PROFILE, { strokeWidth: 0 });

    const roundTrip = readSectionProfileInDocumentCoordinates(path);

    expect(roundTrip).toEqual(PROFILE);
    expect(path.getBoundingRect()).toEqual({ left: 100, top: 140, width: 80, height: 60 });
  });

  it('does not retain caller-owned point arrays', () => {
    const path = createSectionPath(PROFILE);
    PROFILE.rings[0].points[0].x = -999;

    const roundTrip = readSectionProfileInDocumentCoordinates(path);

    expect(roundTrip.rings[0].points[0].x).toBe(100);
    PROFILE.rings[0].points[0].x = 100;
  });
});
