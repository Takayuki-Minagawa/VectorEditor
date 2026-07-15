import { describe, expect, it, vi } from 'vitest';
import * as fabric from 'fabric';
import { groupSelection, ungroupActive } from './canvasCommands';
import { getFabricMetadata } from './fabricObjectMetadata';
import { calculateSectionProperties } from './sectionProperties';
import { readSectionProfileInDocumentCoordinates } from './sectionGeometry';
import {
  createSectionFromSelection,
  filletSelectedSection,
  getSelectedSectionMaximumFilletRadius,
  listSelectedSectionConvexCorners,
  subtractSelectionFromSection,
} from './sectionCommands';

function select(canvas: fabric.Canvas, objects: fabric.FabricObject[]): void {
  objects.forEach((object) => canvas.add(object));
  canvas.setActiveObject(objects.length === 1
    ? objects[0]
    : new fabric.ActiveSelection(objects, { canvas }));
}

describe('section commands', () => {
  it('unions selected material in one history commit', () => {
    const canvas = new fabric.Canvas();
    const first = new fabric.Rect({ left: 0, top: 0, width: 100, height: 100 });
    const second = new fabric.Rect({ left: 50, top: 0, width: 100, height: 100 });
    select(canvas, [first, second]);
    const history = vi.fn();

    const result = createSectionFromSelection(canvas, history);
    const properties = calculateSectionProperties(readSectionProfileInDocumentCoordinates(result));

    expect(history).toHaveBeenCalledTimes(1);
    expect(canvas.getObjects()).toEqual([result]);
    expect(getFabricMetadata(result).objectKind).toBe('sectionProfile');
    expect(properties.area).toBeCloseTo(15_000, 8);
    canvas.dispose();
  });

  it('subtracts a cutter and preserves the section id', () => {
    const canvas = new fabric.Canvas();
    const subject = new fabric.Rect({ left: 0, top: 0, width: 100, height: 100 });
    select(canvas, [subject]);
    const history = vi.fn();
    const section = createSectionFromSelection(canvas, history);
    const originalId = getFabricMetadata(section).id;
    const cutter = new fabric.Circle({ left: 25, top: 25, radius: 25 });
    canvas.add(cutter);
    canvas.setActiveObject(new fabric.ActiveSelection([section, cutter], { canvas }));

    const result = subtractSelectionFromSection(canvas, history);
    const properties = calculateSectionProperties(readSectionProfileInDocumentCoordinates(result));

    expect(getFabricMetadata(result).id).toBe(originalId);
    expect(properties.area).toBeLessThan(10_000);
    expect(properties.area).toBeGreaterThan(7_900);
    expect(history).toHaveBeenCalledTimes(2);
    canvas.dispose();
  });

  it('can retain sources without duplicating their ids', () => {
    const canvas = new fabric.Canvas();
    const rect = new fabric.Rect({ left: 0, top: 0, width: 100, height: 50 });
    select(canvas, [rect]);

    const result = createSectionFromSelection(canvas, vi.fn(), { keepSources: true });

    expect(canvas.getObjects()).toContain(rect);
    expect(getFabricMetadata(result).id).not.toBe(getFabricMetadata(rect).id);
    canvas.dispose();
  });

  it('applies a convex fillet to the selected section', () => {
    const canvas = new fabric.Canvas();
    const rect = new fabric.Rect({ left: 0, top: 0, width: 100, height: 50 });
    select(canvas, [rect]);
    const history = vi.fn();
    createSectionFromSelection(canvas, history);

    const rounded = filletSelectedSection(canvas, history, 5);
    const profile = readSectionProfileInDocumentCoordinates(rounded);

    expect(profile.approximate).toBe(true);
    expect(profile.rings[0].points.length).toBeGreaterThan(8);
    expect(history).toHaveBeenCalledTimes(2);
    canvas.dispose();
  });

  it('lists corners and applies a fillet only to the requested corner', () => {
    const canvas = new fabric.Canvas();
    const rect = new fabric.Rect({ left: 0, top: 0, width: 100, height: 50 });
    select(canvas, [rect]);
    const history = vi.fn();
    const section = createSectionFromSelection(canvas, history);
    const originalPoints = readSectionProfileInDocumentCoordinates(section).rings[0].points;

    const corners = listSelectedSectionConvexCorners(canvas);
    expect(corners).toHaveLength(4);
    expect(getSelectedSectionMaximumFilletRadius(canvas)).toBeCloseTo(24.995, 10);
    expect(getSelectedSectionMaximumFilletRadius(canvas, {
      filletCorners: [corners[0]],
    })).toBeCloseTo(49.99, 10);

    const rounded = filletSelectedSection(canvas, history, 5, {
      filletCorners: [{ ringIndex: 0, vertexIndex: 0 }],
    });
    const profile = readSectionProfileInDocumentCoordinates(rounded);

    expect(profile.rings[0].points).not.toContainEqual(originalPoints[0]);
    originalPoints.slice(1).forEach((point) => {
      expect(profile.rings[0].points).toContainEqual(point);
    });
    expect(history).toHaveBeenCalledTimes(2);
    canvas.dispose();
  });

  it('does not mutate the selected section or history when a corner selection is invalid', () => {
    const canvas = new fabric.Canvas();
    const rect = new fabric.Rect({ left: 0, top: 0, width: 100, height: 50 });
    select(canvas, [rect]);
    const history = vi.fn();
    const section = createSectionFromSelection(canvas, history);

    expect(() => filletSelectedSection(canvas, history, 5, {
      filletCorners: [{ ringIndex: 0, vertexIndex: 99 }],
    })).toThrow(/not an eligible/);
    expect(canvas.getObjects()).toEqual([section]);
    expect(history).toHaveBeenCalledTimes(1);
    canvas.dispose();
  });

  it('keeps an existing hole unchanged when filleting one selected outer corner', () => {
    const canvas = new fabric.Canvas();
    const outer = new fabric.Rect({ left: 0, top: 0, width: 100, height: 100 });
    select(canvas, [outer]);
    const history = vi.fn();
    const section = createSectionFromSelection(canvas, history);
    const cutter = new fabric.Rect({ left: -10, top: -10, width: 20, height: 20 });
    canvas.add(cutter);
    canvas.setActiveObject(new fabric.ActiveSelection([section, cutter], { canvas }));
    const cut = subtractSelectionFromSection(canvas, history);
    const holeBefore = readSectionProfileInDocumentCoordinates(cut).rings
      .find((ring) => ring.role === 'hole')?.points;

    const rounded = filletSelectedSection(canvas, history, 5, {
      filletCorners: [{ ringIndex: 0, vertexIndex: 0 }],
    });
    const holeAfter = readSectionProfileInDocumentCoordinates(rounded).rings
      .find((ring) => ring.role === 'hole')?.points;

    expect(holeBefore).toBeDefined();
    expect(holeAfter).toEqual(holeBefore);
    expect(history).toHaveBeenCalledTimes(3);
    canvas.dispose();
  });

  it('rejects fillets for circular and curve-derived Boolean sections without mutation', () => {
    const canvas = new fabric.Canvas();
    const circle = new fabric.Circle({ left: 0, top: 0, radius: 25 });
    select(canvas, [circle]);
    const history = vi.fn();
    const circularSection = createSectionFromSelection(canvas, history);

    expect(() => listSelectedSectionConvexCorners(canvas)).toThrow(/exact straight-boundary/);
    expect(() => getSelectedSectionMaximumFilletRadius(canvas)).toThrow(/exact straight-boundary/);
    expect(() => filletSelectedSection(canvas, history, 5)).toThrow(/exact straight-boundary/);
    expect(canvas.getObjects()).toEqual([circularSection]);
    expect(history).toHaveBeenCalledTimes(1);

    const rectangle = new fabric.Rect({ left: 20, top: -25, width: 50, height: 50 });
    canvas.add(rectangle);
    canvas.setActiveObject(new fabric.ActiveSelection([circularSection, rectangle], { canvas }));
    const mixedSection = createSectionFromSelection(canvas, history);

    expect(readSectionProfileInDocumentCoordinates(mixedSection).approximate).toBe(true);
    expect(() => listSelectedSectionConvexCorners(canvas)).toThrow(/curve-derived Boolean/);
    expect(() => filletSelectedSection(canvas, history, 5)).toThrow(/curve-derived Boolean/);
    expect(canvas.getObjects()).toEqual([mixedSection]);
    expect(history).toHaveBeenCalledTimes(2);
    canvas.dispose();
  });

  it('preserves section metadata and properties through group and ungroup', () => {
    const canvas = new fabric.Canvas();
    const rectangle = new fabric.Rect({ left: 20, top: 30, width: 100, height: 50 });
    select(canvas, [rectangle]);
    const history = vi.fn();
    const section = createSectionFromSelection(canvas, history);
    const baseline = calculateSectionProperties(readSectionProfileInDocumentCoordinates(section));
    const peer = new fabric.Rect({ left: 180, top: 40, width: 20, height: 20 });
    canvas.add(peer);
    canvas.setActiveObject(new fabric.ActiveSelection([section, peer], { canvas }));

    expect(groupSelection(canvas, history)).toBe(true);
    const group = canvas.getActiveObject();
    expect(group).toBeInstanceOf(fabric.Group);
    const groupedSection = (group as fabric.Group).getObjects().find(
      (object) => getFabricMetadata(object).objectKind === 'sectionProfile',
    );
    expect(groupedSection).toBeDefined();
    expect(calculateSectionProperties(
      readSectionProfileInDocumentCoordinates(groupedSection!),
    ).area).toBeCloseTo(baseline.area, 8);

    expect(ungroupActive(canvas, history)).toBe(true);
    const restoredSection = canvas.getObjects().find(
      (object) => getFabricMetadata(object).objectKind === 'sectionProfile',
    );
    expect(restoredSection).toBeDefined();
    expect(getFabricMetadata(restoredSection!).sectionProfileData).toBeDefined();
    const restored = calculateSectionProperties(readSectionProfileInDocumentCoordinates(restoredSection!));
    expect(restored.area).toBeCloseTo(baseline.area, 8);
    expect(restored.ix).toBeCloseTo(baseline.ix, 6);
    expect(restored.iy).toBeCloseTo(baseline.iy, 6);
    expect(history).toHaveBeenCalledTimes(3);
    canvas.dispose();
  });
});
