import { useEffect, useMemo, useState } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import {
  createSectionFromSelection,
  filletSelectedSection,
  getSelectedSectionMaximumFilletRadius,
  listSelectedSectionConvexCorners,
  subtractSelectionFromSection,
  unionSelectionAsSection,
} from '../utils/sectionCommands';
import {
  DEFAULT_SECTION_TOLERANCE_MM,
  sectionProfileFromFabricObject,
} from '../utils/sectionGeometry';
import {
  filletSectionProfileConvexCorners,
  type SectionConvexCorner,
  type SectionCornerReference,
} from '../utils/sectionFillet';
import type { SectionProfileData } from '../domain/section';
import Dialog from './Dialog';
import { NumberField } from './PropertyField';

interface SectionOperationsDialogProps {
  onClose: () => void;
}

function cornerKey(corner: SectionCornerReference): string {
  return `${corner.ringIndex}:${corner.vertexIndex}`;
}

function displayMillimetres(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value);
}

function engineeringToScreen(
  point: { x: number; y: number },
  viewport: fabric.TMat2D,
): fabric.Point {
  return fabric.util.transformPoint(new fabric.Point(point.x, -point.y), viewport);
}

function drawFilletPreview(
  canvas: fabric.Canvas,
  profile: SectionProfileData,
  selectedCorners: readonly SectionConvexCorner[],
): void {
  const context = canvas.getContext();
  const viewport = canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0];
  context.save();
  context.strokeStyle = '#ff6f00';
  context.fillStyle = '#ff6f00';
  context.lineWidth = 2;
  context.setLineDash([7, 4]);
  profile.rings.forEach((ring) => {
    if (ring.points.length === 0) return;
    const first = engineeringToScreen(ring.points[0], viewport);
    context.beginPath();
    context.moveTo(first.x, first.y);
    ring.points.slice(1).forEach((point) => {
      const screenPoint = engineeringToScreen(point, viewport);
      context.lineTo(screenPoint.x, screenPoint.y);
    });
    context.closePath();
    context.stroke();
  });
  context.setLineDash([]);
  selectedCorners.forEach((corner) => {
    const point = engineeringToScreen(corner.point, viewport);
    context.beginPath();
    context.arc(point.x, point.y, 4, 0, Math.PI * 2);
    context.fill();
  });
  context.restore();
}

export default function SectionOperationsDialog({ onClose }: SectionOperationsDialogProps) {
  const canvas = useEditorStore((state) => state.canvas);
  const pushHistory = useEditorStore((state) => state.pushHistory);
  const drawingMode = useEditorStore((state) => state.drawingMode);
  const showToast = useEditorStore((state) => state.showToast);
  const t = useI18n((state) => state.t);
  const [keepSources, setKeepSources] = useState(false);
  const [toleranceMm, setToleranceMm] = useState(DEFAULT_SECTION_TOLERANCE_MM);
  const [radiusMm, setRadiusMm] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [cornerSelection, setCornerSelection] = useState<{
    token: string;
    keys: string[];
  }>({ token: '', keys: [] });

  useEffect(() => {
    if (!canvas) return undefined;
    const refresh = () => setSelectionRevision((revision) => revision + 1);
    const disposers = [
      canvas.on('selection:created', refresh),
      canvas.on('selection:updated', refresh),
      canvas.on('selection:cleared', refresh),
      canvas.on('object:modified', refresh),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, [canvas]);

  const cornerState = useMemo((): {
    corners: SectionConvexCorner[];
    readError: 'selection' | 'unsupported-fillet' | null;
  } => {
    void selectionRevision;
    if (!canvas || drawingMode !== 'cad') return { corners: [], readError: null };
    try {
      return {
        corners: listSelectedSectionConvexCorners(canvas, { toleranceMm }),
        readError: null,
      };
    } catch (caught: unknown) {
      return {
        corners: [],
        readError: caught instanceof Error && caught.name === 'SectionFilletError'
          ? 'unsupported-fillet'
          : 'selection',
      };
    }
  }, [canvas, drawingMode, selectionRevision, toleranceMm]);

  const cornerSelectionToken = [
    selectionRevision,
    toleranceMm,
    ...cornerState.corners.flatMap((corner) => [
      cornerKey(corner),
      corner.point.x,
      corner.point.y,
    ]),
  ].join('|');
  const selectedCornerKeys = useMemo(
    () => cornerSelection.token === cornerSelectionToken
      ? cornerSelection.keys
      : cornerState.corners.map(cornerKey),
    [cornerSelection, cornerSelectionToken, cornerState.corners],
  );
  const updateSelectedCornerKeys = (keys: string[]) => {
    setCornerSelection({ token: cornerSelectionToken, keys });
  };

  const selectedKeySet = useMemo(() => new Set(selectedCornerKeys), [selectedCornerKeys]);
  const selectedCorners = useMemo(
    () => cornerState.corners.filter((corner) => selectedKeySet.has(cornerKey(corner))),
    [cornerState.corners, selectedKeySet],
  );
  const selectedCornerReferences = useMemo<SectionCornerReference[]>(
    () => selectedCorners.map(({ ringIndex, vertexIndex }) => ({ ringIndex, vertexIndex })),
    [selectedCorners],
  );

  const previewState = useMemo((): {
    profile: SectionProfileData | null;
    maximumRadiusMm: number | null;
    previewError: string | null;
  } => {
    void selectionRevision;
    if (!canvas || drawingMode !== 'cad' || selectedCornerReferences.length === 0) {
      return { profile: null, maximumRadiusMm: null, previewError: null };
    }
    try {
      const active = canvas.getActiveObject();
      if (!active || active instanceof fabric.ActiveSelection) {
        return { profile: null, maximumRadiusMm: null, previewError: null };
      }
      const maximumRadiusMm = getSelectedSectionMaximumFilletRadius(canvas, {
        toleranceMm,
        filletCorners: selectedCornerReferences,
      });
      const profile = filletSectionProfileConvexCorners(
        sectionProfileFromFabricObject(active, toleranceMm),
        radiusMm,
        selectedCornerReferences,
      );
      return { profile, maximumRadiusMm, previewError: null };
    } catch (caught: unknown) {
      let maximumRadiusMm: number | null = null;
      try {
        maximumRadiusMm = getSelectedSectionMaximumFilletRadius(canvas, {
          toleranceMm,
          filletCorners: selectedCornerReferences,
        });
      } catch {
        // The selection hint below remains sufficient when no eligible profile exists.
      }
      return {
        profile: null,
        maximumRadiusMm,
        previewError: caught instanceof Error ? caught.message : null,
      };
    }
  }, [canvas, drawingMode, radiusMm, selectedCornerReferences, selectionRevision, toleranceMm]);

  useEffect(() => {
    if (!canvas || !previewState.profile) {
      canvas?.requestRenderAll();
      return undefined;
    }
    const draw = () => drawFilletPreview(canvas, previewState.profile!, selectedCorners);
    const dispose = canvas.on('after:render', draw);
    canvas.requestRenderAll();
    return () => {
      dispose();
      canvas.requestRenderAll();
    };
  }, [canvas, previewState.profile, selectedCorners]);

  const run = (operation: () => void) => {
    if (!canvas || drawingMode !== 'cad') {
      setError(t('sectionCadOnly'));
      return;
    }
    try {
      operation();
      setError(null);
      setSelectionRevision((revision) => revision + 1);
      showToast(t('sectionOperationDone'), 'success');
    } catch (caught: unknown) {
      const detail = caught instanceof Error ? caught.message : t('sectionOperationFailed');
      setError(detail);
      showToast(t('sectionOperationFailed'), 'error');
    }
  };

  const options = { keepSources, toleranceMm };

  return (
    <Dialog title={t('sectionDialogTitle')} onClose={onClose} maxWidth={560}>
      <div className="section-dialog-body">
        <p className="section-dialog-help">{t('sectionSelectionRequired')}</p>
        <div className="section-operation-grid">
          <button
            className="toolbar-btn"
            onClick={() => run(() => { createSectionFromSelection(canvas!, pushHistory, options); })}
          >
            {t('sectionCreate')}
          </button>
          <button
            className="toolbar-btn"
            onClick={() => run(() => { unionSelectionAsSection(canvas!, pushHistory, options); })}
          >
            {t('sectionUnion')}
          </button>
          <button
            className="toolbar-btn"
            onClick={() => run(() => { subtractSelectionFromSection(canvas!, pushHistory, options); })}
          >
            {t('sectionSubtract')}
          </button>
          <button
            className="toolbar-btn"
            disabled={selectedCornerReferences.length === 0}
            onClick={() => run(() => {
              filletSelectedSection(canvas!, pushHistory, radiusMm, {
                ...options,
                filletCorners: selectedCornerReferences,
              });
            })}
          >
            {t('sectionFillet')}
          </button>
        </div>

        <NumberField
          label={t('sectionTolerance')}
          value={toleranceMm}
          onChange={setToleranceMm}
          min={0.000001}
          max={10}
          step={0.001}
        />
        <NumberField
          label={t('sectionRadius')}
          value={radiusMm}
          onChange={setRadiusMm}
          min={0.000001}
          step={1}
        />
        <section className="section-corner-picker" aria-labelledby="section-corner-picker-title">
          <div className="section-corner-picker-header">
            <strong id="section-corner-picker-title">
              {t('sectionFilletCorners')} ({selectedCorners.length}/{cornerState.corners.length})
            </strong>
            <span className="section-corner-actions">
              <button
                type="button"
                onClick={() => updateSelectedCornerKeys(cornerState.corners.map(cornerKey))}
                disabled={cornerState.corners.length === 0}
              >
                {t('sectionSelectAllCorners')}
              </button>
              <button
                type="button"
                onClick={() => updateSelectedCornerKeys([])}
                disabled={selectedCornerKeys.length === 0}
              >
                {t('sectionClearCorners')}
              </button>
            </span>
          </div>
          {cornerState.corners.length > 0 ? (
            <div className="section-corner-list">
              {cornerState.corners.map((corner) => {
                const key = cornerKey(corner);
                return (
                  <label key={key} className="section-corner-row">
                    <input
                      type="checkbox"
                      checked={selectedKeySet.has(key)}
                      onChange={(event) => updateSelectedCornerKeys(
                        event.target.checked
                          ? [...selectedCornerKeys, key]
                          : selectedCornerKeys.filter((currentKey) => currentKey !== key),
                      )}
                    />
                    <span>
                      {t('sectionCorner')} {corner.vertexIndex + 1}
                      {' · '}
                      ({displayMillimetres(corner.point.x)}, {displayMillimetres(corner.point.y)}) mm
                    </span>
                    <small>R≤{displayMillimetres(corner.maxRadiusMm)}</small>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="section-dialog-help">
              {cornerState.readError === 'unsupported-fillet'
                ? t('sectionFilletExactOnly')
                : cornerState.readError === 'selection'
                  ? t('sectionCornerSelectionHint')
                  : t('sectionNoConvexCorners')}
            </p>
          )}
          {previewState.maximumRadiusMm !== null && (
            <p className="section-preview-status">
              {t('sectionSelectedMaximumRadius')}: {displayMillimetres(previewState.maximumRadiusMm)} mm
            </p>
          )}
          {previewState.profile && (
            <p className="section-preview-status">{t('sectionFilletPreview')}</p>
          )}
          {previewState.previewError && selectedCornerReferences.length > 0 && (
            <p className="section-warning">{previewState.previewError}</p>
          )}
        </section>
        <label className="section-checkbox-row">
          <input
            type="checkbox"
            checked={keepSources}
            onChange={(event) => setKeepSources(event.target.checked)}
          />
          <span>{t('sectionKeepSources')}</span>
        </label>
        {error && <p className="section-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}
