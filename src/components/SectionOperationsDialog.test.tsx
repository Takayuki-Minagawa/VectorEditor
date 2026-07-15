import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as fabric from 'fabric';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SectionProfileData } from '../domain/section';
import { useI18n } from '../i18n/useI18n';
import { useEditorStore } from '../store/useEditorStore';
import SectionOperationsDialog from './SectionOperationsDialog';

const sectionMocks = vi.hoisted(() => ({
  create: vi.fn(),
  union: vi.fn(),
  subtract: vi.fn(),
  fillet: vi.fn(),
  listCorners: vi.fn(),
  maximumRadius: vi.fn(),
  readProfile: vi.fn(),
  previewFillet: vi.fn(),
}));

vi.mock('../utils/sectionCommands', () => ({
  createSectionFromSelection: sectionMocks.create,
  unionSelectionAsSection: sectionMocks.union,
  subtractSelectionFromSection: sectionMocks.subtract,
  filletSelectedSection: sectionMocks.fillet,
  listSelectedSectionConvexCorners: sectionMocks.listCorners,
  getSelectedSectionMaximumFilletRadius: sectionMocks.maximumRadius,
}));

vi.mock('../utils/sectionGeometry', () => ({
  DEFAULT_SECTION_TOLERANCE_MM: 0.01,
  sectionProfileFromFabricObject: sectionMocks.readProfile,
}));

vi.mock('../utils/sectionFillet', () => ({
  filletSectionProfileConvexCorners: sectionMocks.previewFillet,
}));

const PROFILE: SectionProfileData = {
  version: 1,
  rings: [{
    role: 'outer',
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ],
  }],
  analysisToleranceMm: 0.01,
  approximate: false,
};

const PREVIEW_PROFILE: SectionProfileData = {
  ...PROFILE,
  approximate: true,
};

const CORNERS = PROFILE.rings[0].points.map((point, vertexIndex) => ({
  ringIndex: 0,
  vertexIndex,
  point,
  interiorAngleRad: Math.PI / 2,
  maxRadiusMm: vertexIndex % 2 === 0 ? 40 : 50,
}));

type CanvasEvent =
  | 'selection:created'
  | 'selection:updated'
  | 'selection:cleared'
  | 'object:modified'
  | 'after:render';
type CanvasListener = () => void;

function createCanvasHarness() {
  const listeners = new Map<CanvasEvent, Set<CanvasListener>>();
  const activeObject = new fabric.Path('M 0 0 L 100 0 L 100 80 L 0 80 Z');
  const context = {
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
  };
  const canvas = {
    viewportTransform: [1, 0, 0, 1, 0, 0] as fabric.TMat2D,
    getActiveObject: vi.fn(() => activeObject),
    getContext: vi.fn(() => context),
    requestRenderAll: vi.fn(),
    add: vi.fn(),
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
    fire(eventName: CanvasEvent) {
      [...(listeners.get(eventName) ?? [])].forEach((listener) => listener());
    },
    listenerCount(eventName: CanvasEvent) {
      return listeners.get(eventName)?.size ?? 0;
    },
  };
}

const originalPushHistory = useEditorStore.getState().pushHistory;
const originalShowToast = useEditorStore.getState().showToast;

describe('SectionOperationsDialog fillet UI', () => {
  const pushHistory = vi.fn();
  const showToast = vi.fn();

  beforeEach(() => {
    sectionMocks.create.mockReset();
    sectionMocks.union.mockReset();
    sectionMocks.subtract.mockReset();
    sectionMocks.fillet.mockReset();
    sectionMocks.listCorners.mockReset().mockReturnValue(CORNERS);
    sectionMocks.maximumRadius.mockReset().mockReturnValue(40);
    sectionMocks.readProfile.mockReset().mockReturnValue(PROFILE);
    sectionMocks.previewFillet.mockReset().mockReturnValue(PREVIEW_PROFILE);
    pushHistory.mockReset();
    showToast.mockReset();
    useI18n.getState().setLang('ja');
  });

  afterEach(() => {
    useEditorStore.setState({
      canvas: null,
      drawingMode: 'illustration',
      pushHistory: originalPushHistory,
      showToast: originalShowToast,
    });
  });

  function renderDialog(harness: ReturnType<typeof createCanvasHarness>) {
    useEditorStore.setState({
      canvas: harness.canvas,
      drawingMode: 'cad',
      pushHistory,
      showToast,
    });
    return render(<SectionOperationsDialog onClose={vi.fn()} />);
  }

  it('selects all four corners initially and sends three references after one is cleared', async () => {
    const user = userEvent.setup();
    const harness = createCanvasHarness();
    renderDialog(harness);

    const cornerCheckboxes = CORNERS.map((_, index) => screen.getByRole('checkbox', {
      name: new RegExp(`角 ${index + 1}`),
    }));
    cornerCheckboxes.forEach((checkbox) => expect(checkbox).toBeChecked());

    await user.click(cornerCheckboxes[1]);
    await user.click(screen.getByRole('button', { name: '凸角にRを適用' }));

    expect(sectionMocks.fillet).toHaveBeenCalledTimes(1);
    expect(sectionMocks.fillet).toHaveBeenCalledWith(
      harness.canvas,
      pushHistory,
      5,
      expect.objectContaining({
        keepSources: false,
        toleranceMm: 0.01,
        filletCorners: [
          { ringIndex: 0, vertexIndex: 0 },
          { ringIndex: 0, vertexIndex: 2 },
          { ringIndex: 0, vertexIndex: 3 },
        ],
      }),
    );
  });

  it('registers and cleans up an after:render preview without adding Canvas objects', () => {
    const harness = createCanvasHarness();
    const view = renderDialog(harness);

    expect(harness.listenerCount('after:render')).toBe(1);
    act(() => harness.fire('after:render'));

    expect(harness.context.closePath).toHaveBeenCalledTimes(1);
    expect(harness.context.arc).toHaveBeenCalledTimes(4);
    expect((harness.canvas.add as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();

    view.unmount();

    expect(harness.listenerCount('after:render')).toBe(0);
    expect(harness.canvas.requestRenderAll).toHaveBeenCalledTimes(2);
    expect((harness.canvas.add as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('shows the invalid-radius warning and a committed-operation error', async () => {
    const user = userEvent.setup();
    const harness = createCanvasHarness();
    const invalidRadiusMessage = 'The requested radius exceeds the maximum 40 mm.';
    sectionMocks.previewFillet.mockImplementation(
      (_profile: SectionProfileData, radiusMm: number) => {
        if (radiusMm > 40) throw new Error(invalidRadiusMessage);
        return PREVIEW_PROFILE;
      },
    );
    sectionMocks.fillet.mockImplementation(() => {
      throw new Error(invalidRadiusMessage);
    });
    renderDialog(harness);

    const radiusInput = screen.getByRole('spinbutton', { name: 'R寸法 (mm)' });
    await user.clear(radiusInput);
    await user.type(radiusInput, '50');
    await user.tab();

    expect(screen.getByText(invalidRadiusMessage)).toHaveClass('section-warning');
    expect(screen.getByText(/選択角の最大R: 40 mm/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '凸角にRを適用' }));

    expect(screen.getByRole('alert')).toHaveTextContent(invalidRadiusMessage);
    expect(showToast).toHaveBeenCalledWith('断面処理を実行できませんでした。', 'error');
  });

  it('explains that curve-derived profiles are outside the line-line fillet scope', () => {
    const harness = createCanvasHarness();
    const unsupported = new Error('unsupported approximate profile');
    unsupported.name = 'SectionFilletError';
    sectionMocks.listCorners.mockImplementation(() => {
      throw unsupported;
    });

    renderDialog(harness);

    expect(screen.getByText(
      '凸角Rは、円・既存Rなどの曲線を含まない直線輪郭にだけ適用できます。',
    )).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '凸角にRを適用' })).toBeDisabled();
  });
});
