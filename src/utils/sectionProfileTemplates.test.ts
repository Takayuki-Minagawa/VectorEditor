import { describe, expect, it } from 'vitest';
import { calculateSectionProperties } from './sectionProperties';
import {
  createStandardSectionProfile,
  StandardSectionTemplateError,
  type StandardSectionSpec,
} from './sectionProfileTemplates';

function expectRelative(actual: number, expected: number, tolerance: number): void {
  expect(Math.abs(actual - expected) / Math.max(1, Math.abs(expected))).toBeLessThanOrEqual(tolerance);
}

describe('standard section profile templates', () => {
  it('creates a rectangular hollow section with exact hollow-rectangle properties', () => {
    const height = 200;
    const width = 150;
    const thickness = 8;
    const properties = calculateSectionProperties(createStandardSectionProfile({
      kind: 'rectangular-hollow',
      heightMm: height,
      widthMm: width,
      thicknessMm: thickness,
    }));
    const innerHeight = height - 2 * thickness;
    const innerWidth = width - 2 * thickness;

    expect(properties.area).toBeCloseTo(width * height - innerWidth * innerHeight, 8);
    expect(properties.centroid.x).toBeCloseTo(0, 10);
    expect(properties.centroid.y).toBeCloseTo(0, 10);
    expect(properties.ixy).toBeCloseTo(0, 8);
    expect(properties.ix).toBeCloseTo(
      (width * height ** 3 - innerWidth * innerHeight ** 3) / 12,
      5,
    );
    expect(properties.iy).toBeCloseTo(
      (height * width ** 3 - innerHeight * innerWidth ** 3) / 12,
      5,
    );
  });

  it('creates a circular hollow section within the requested curve tolerance', () => {
    const diameter = 216.3;
    const thickness = 8.2;
    const profile = createStandardSectionProfile({
      kind: 'circular-hollow',
      diameterMm: diameter,
      thicknessMm: thickness,
    }, 0.005);
    const properties = calculateSectionProperties(profile);
    const innerDiameter = diameter - 2 * thickness;
    const exactArea = Math.PI * (diameter ** 2 - innerDiameter ** 2) / 4;
    const exactInertia = Math.PI * (diameter ** 4 - innerDiameter ** 4) / 64;

    expect(profile.approximate).toBe(true);
    expect(profile.rings).toHaveLength(2);
    expectRelative(properties.area, exactArea, 1e-5);
    expectRelative(properties.ix, exactInertia, 5e-5);
    expect(properties.iy).toBeCloseTo(properties.ix, 5);
  });

  it('uses matching angular vertices for a pipe thinner than the curve sagitta', () => {
    const profile = createStandardSectionProfile({
      kind: 'circular-hollow',
      diameterMm: 100,
      thicknessMm: 0.0001,
    }, 0.01);
    const properties = calculateSectionProperties(profile);

    expect(profile.rings[0].points).toHaveLength(profile.rings[1].points.length);
    expect(profile.rings[0].points.length % 4).toBe(0);
    expect(properties.area).toBeGreaterThan(0);
    expect(properties.centroid.x).toBeCloseTo(0, 8);
    expect(properties.centroid.y).toBeCloseTo(0, 8);
  });

  it('rejects a pipe tolerance that cannot be met within the persisted point limit', () => {
    expect(() => createStandardSectionProfile({
      kind: 'circular-hollow',
      diameterMm: 2_000,
      thicknessMm: 10,
    }, 0.000001)).toThrow(/Increase the analysis tolerance/);
  });

  it('creates an H-section with exact area and centroidal moments', () => {
    const height = 300;
    const width = 150;
    const webThickness = 6.5;
    const flangeThickness = 9;
    const properties = calculateSectionProperties(createStandardSectionProfile({
      kind: 'h-section',
      heightMm: height,
      widthMm: width,
      webThicknessMm: webThickness,
      flangeThicknessMm: flangeThickness,
    }));
    const clearWebHeight = height - 2 * flangeThickness;

    expect(properties.area).toBeCloseTo(
      2 * width * flangeThickness + clearWebHeight * webThickness,
      8,
    );
    expect(properties.centroid.x).toBeCloseTo(0, 10);
    expect(properties.centroid.y).toBeCloseTo(0, 10);
    expect(properties.ix).toBeCloseTo(
      (width * height ** 3 - (width - webThickness) * clearWebHeight ** 3) / 12,
      4,
    );
    expect(properties.iy).toBeCloseTo(
      (2 * flangeThickness * width ** 3 + clearWebHeight * webThickness ** 3) / 12,
      4,
    );
  });

  it('creates a channel with the expected asymmetric centroid', () => {
    const height = 200;
    const width = 75;
    const webThickness = 5.5;
    const flangeThickness = 9;
    const properties = calculateSectionProperties(createStandardSectionProfile({
      kind: 'channel',
      heightMm: height,
      widthMm: width,
      webThicknessMm: webThickness,
      flangeThicknessMm: flangeThickness,
    }));
    const webArea = height * webThickness;
    const flangeArea = (width - webThickness) * flangeThickness;
    const expectedArea = webArea + 2 * flangeArea;
    const webCentroidX = -width / 2 + webThickness / 2;
    const flangeCentroidX = webThickness / 2;

    expect(properties.area).toBeCloseTo(expectedArea, 8);
    expect(properties.centroid.x).toBeCloseTo(
      (webArea * webCentroidX + 2 * flangeArea * flangeCentroidX) / expectedArea,
      8,
    );
    expect(properties.centroid.y).toBeCloseTo(0, 10);
    expect(properties.ixy).toBeCloseTo(0, 8);
  });

  it('creates a lipped channel as one non-overlapping symmetric outline', () => {
    const height = 150;
    const width = 50;
    const lipLength = 20;
    const thickness = 2.3;
    const profile = createStandardSectionProfile({
      kind: 'lipped-channel',
      heightMm: height,
      widthMm: width,
      lipLengthMm: lipLength,
      thicknessMm: thickness,
    });
    const properties = calculateSectionProperties(profile);
    const expectedArea = thickness * height
      + 2 * thickness * (width - thickness)
      + 2 * thickness * (lipLength - thickness);

    expect(profile.rings).toHaveLength(1);
    expect(profile.rings[0].points).toHaveLength(12);
    expect(properties.area).toBeCloseTo(expectedArea, 8);
    expect(properties.centroid.y).toBeCloseTo(0, 10);
    expect(properties.ixy).toBeCloseTo(0, 8);
  });

  it.each<StandardSectionSpec>([
    { kind: 'rectangular-hollow', heightMm: Number.NaN, widthMm: 80, thicknessMm: 4 },
    { kind: 'rectangular-hollow', heightMm: 100, widthMm: 80, thicknessMm: 40 },
    { kind: 'circular-hollow', diameterMm: 100, thicknessMm: 50 },
    { kind: 'h-section', heightMm: 100, widthMm: 80, webThicknessMm: 80, flangeThicknessMm: 8 },
    { kind: 'channel', heightMm: 100, widthMm: 80, webThicknessMm: 6, flangeThicknessMm: 50 },
    { kind: 'lipped-channel', heightMm: 100, widthMm: 40, lipLengthMm: 50, thicknessMm: 2 },
  ])('rejects geometrically impossible $kind dimensions', (spec) => {
    expect(() => createStandardSectionProfile(spec)).toThrow(StandardSectionTemplateError);
  });
});
