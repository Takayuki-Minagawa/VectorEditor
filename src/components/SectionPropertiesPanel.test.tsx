import { act, render } from '@testing-library/react';
import * as fabric from 'fabric';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SectionProfileData, SectionProperties } from '../domain/section';
import { useI18n } from '../i18n/useI18n';
import { useEditorStore } from '../store/useEditorStore';
import SectionPropertiesPanel from './SectionPropertiesPanel';

const analysisMocks = vi.hoisted(() => ({
  readProfile: vi.fn(),
  calculateProperties: vi.fn(),
}));

vi.mock('../utils/sectionGeometry', () => ({
  readSectionProfileInDocumentCoordinates: analysisMocks.readProfile,
}));

vi.mock('../utils/sectionProperties', () => ({
  calculateSectionProperties: analysisMocks.calculateProperties,
}));

const PROFILE: SectionProfileData = {
  version: 1,
  rings: [{
    role: 'outer',
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ],
  }],
  analysisToleranceMm: 0.01,
  approximate: false,
};

const PROPERTIES: SectionProperties = {
  area: 5_000,
  centroid: { x: 50, y: 25 },
  ix: 1_041_666.666667,
  iy: 4_166_666.666667,
  ixy: 0,
  principalMax: 4_166_666.666667,
  principalMin: 1_041_666.666667,
  principalAngleDeg: 0,
  cTop: 25,
  cBottom: 25,
  cLeft: 50,
  cRight: 50,
  zxTop: 41_666.666667,
  zxBottom: 41_666.666667,
  zyLeft: 83_333.333333,
  zyRight: 83_333.333333,
};

type CanvasEvent =
  | 'object:modified'
  | 'object:moving'
  | 'object:rotating'
  | 'object:scaling'
  | 'after:render';
type CanvasListener = (event?: { target?: fabric.FabricObject }) => void;

function createCanvasHarness(viewport: fabric.TMat2D = [1, 0, 0, 1, 0, 0]) {
  const listeners = new Map<CanvasEvent, Set<CanvasListener>>();
  const context = {
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
  };
  const canvas = {
    viewportTransform: viewport,
    requestRenderAll: vi.fn(),
    getContext: vi.fn(() => context),
    on: vi.fn((eventName: CanvasEvent, listener: CanvasListener) => {
      const eventListeners = listeners.get(eventName) ?? new Set<CanvasListener>();
      eventListeners.add(listener);
      listeners.set(eventName, eventListeners);
      return () => eventListeners.delete(listener);
    }),
  } as unknown as fabric.Canvas;
  return {
    canvas,
    context,
    fire(eventName: CanvasEvent, event?: { target?: fabric.FabricObject }) {
      [...(listeners.get(eventName) ?? [])].forEach((listener) => listener(event));
    },
  };
}

describe('SectionPropertiesPanel analysis scheduling', () => {
  beforeEach(() => {
    analysisMocks.readProfile.mockReset().mockReturnValue(PROFILE);
    analysisMocks.calculateProperties.mockReset().mockReturnValue(PROPERTIES);
    useEditorStore.setState({ historyIndex: 0 });
  });

  it('does not recalculate during transforms and refreshes once after object:modified', () => {
    const harness = createCanvasHarness();
    const section = new fabric.Path('M 0 0 L 100 0 L 100 50 L 0 50 Z');
    const other = new fabric.Rect({ width: 10, height: 10 });
    render(<SectionPropertiesPanel canvas={harness.canvas} object={section} />);

    expect(analysisMocks.readProfile).toHaveBeenCalledTimes(1);
    expect(analysisMocks.calculateProperties).toHaveBeenCalledTimes(1);

    act(() => {
      harness.fire('object:moving', { target: section });
      harness.fire('object:scaling', { target: section });
      harness.fire('object:rotating', { target: section });
      harness.fire('object:modified', { target: other });
    });

    expect(analysisMocks.readProfile).toHaveBeenCalledTimes(1);
    expect(analysisMocks.calculateProperties).toHaveBeenCalledTimes(1);

    act(() => {
      harness.fire('object:modified', { target: section });
      useEditorStore.setState({ historyIndex: 1 });
    });

    expect(analysisMocks.readProfile).toHaveBeenCalledTimes(2);
    expect(analysisMocks.calculateProperties).toHaveBeenCalledTimes(2);
  });

  it('suppresses a stale overlay while dragging and restores it after committed analysis', () => {
    const harness = createCanvasHarness();
    const section = new fabric.Path('M 0 0 L 100 0 L 100 50 L 0 50 Z');
    render(<SectionPropertiesPanel canvas={harness.canvas} object={section} />);

    act(() => harness.fire('after:render'));
    expect(harness.context.arc).toHaveBeenCalledTimes(1);

    act(() => {
      harness.fire('object:moving', { target: section });
      harness.fire('after:render');
    });
    expect(harness.context.arc).toHaveBeenCalledTimes(1);

    act(() => {
      harness.fire('object:modified', { target: section });
      useEditorStore.setState({ historyIndex: 1 });
    });
    act(() => harness.fire('after:render'));

    expect(harness.context.arc).toHaveBeenCalledTimes(2);
    expect(analysisMocks.calculateProperties).toHaveBeenCalledTimes(2);
  });

  it('uses the current viewport for every overlay render without recalculating properties', () => {
    const harness = createCanvasHarness();
    const section = new fabric.Path('M 0 0 L 100 0 L 100 50 L 0 50 Z');
    render(<SectionPropertiesPanel canvas={harness.canvas} object={section} />);

    harness.canvas.viewportTransform = [2, 0, 0, 2, 10, 20];
    act(() => harness.fire('after:render'));

    expect(harness.context.moveTo).toHaveBeenNthCalledWith(1, 10, -30);
    expect(harness.context.moveTo).toHaveBeenNthCalledWith(2, 110, 20);
    expect(harness.context.arc).toHaveBeenCalledWith(110, -30, 4, 0, Math.PI * 2);
    expect(analysisMocks.readProfile).toHaveBeenCalledTimes(1);
    expect(analysisMocks.calculateProperties).toHaveBeenCalledTimes(1);
  });

  it('reanalyses on commit and Undo/Redo history changes without depending on locale', () => {
    const harness = createCanvasHarness();
    const section = new fabric.Path('M 0 0 L 100 0 L 100 50 L 0 50 Z');
    const view = render(<SectionPropertiesPanel canvas={harness.canvas} object={section} />);

    act(() => useEditorStore.setState({ historyIndex: 1 }));
    expect(analysisMocks.calculateProperties).toHaveBeenCalledTimes(2);

    act(() => useEditorStore.setState({ historyIndex: 0 }));
    expect(analysisMocks.calculateProperties).toHaveBeenCalledTimes(3);

    const previousLanguage = useI18n.getState().lang;
    act(() => useI18n.getState().setLang(previousLanguage === 'ja' ? 'en' : 'ja'));
    view.rerender(<SectionPropertiesPanel canvas={harness.canvas} object={section} />);

    expect(analysisMocks.calculateProperties).toHaveBeenCalledTimes(3);
    act(() => useI18n.getState().setLang(previousLanguage));
  });
});
