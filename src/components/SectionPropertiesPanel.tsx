import { useEffect, useMemo, useRef, useState } from 'react';
import * as fabric from 'fabric';
import type { SectionProfileData } from '../domain/section';
import {
  useSectionAnalysis,
  type SectionAnalysisState,
} from '../hooks/useSectionAnalysis';
import { useI18n } from '../i18n/useI18n';
import { useEditorStore } from '../store/useEditorStore';
import { getFabricMetadata } from '../utils/fabricObjectMetadata';
import { readSectionProfileInDocumentCoordinates } from '../utils/sectionGeometry';

interface SectionPropertiesPanelProps {
  canvas: fabric.Canvas;
  object: fabric.FabricObject;
}

type DisplayUnit = 'mm' | 'cm';

interface SectionAnalysisInput {
  objectKind: string | undefined;
  profileData: SectionProfileData | undefined;
  transform: fabric.TMat2D;
}

interface PreparedSectionProfile {
  profile: SectionProfileData | null;
  error: string | null;
  revision: number;
}

interface SectionAnalysisCacheEntry {
  input: SectionAnalysisInput;
  prepared: PreparedSectionProfile;
}

const sectionAnalysisCache = new WeakMap<fabric.FabricObject, SectionAnalysisCacheEntry>();
let nextSectionAnalysisRevision = 0;

function captureSectionAnalysisInput(object: fabric.FabricObject): SectionAnalysisInput {
  const metadata = getFabricMetadata(object);
  return {
    objectKind: metadata.objectKind,
    profileData: metadata.sectionProfileData,
    // Fabric may reuse its internal matrix cache, so retain an immutable copy
    // for comparison with the next committed document revision.
    transform: [...object.calcTransformMatrix()] as fabric.TMat2D,
  };
}

function sameTransform(left: fabric.TMat2D, right: fabric.TMat2D): boolean {
  return left.every((value, index) => Object.is(value, right[index]));
}

function sameSectionAnalysisInput(
  left: SectionAnalysisInput,
  right: SectionAnalysisInput,
): boolean {
  return left.objectKind === right.objectKind
    && left.profileData === right.profileData
    && sameTransform(left.transform, right.transform);
}

/**
 * Normalisation and topology validation are deliberately cached per live
 * Fabric object. Section commands and document restores replace immutable
 * sectionProfileData/object instances, while ordinary move/scale operations
 * are detected by the complete Fabric transform matrix.
 */
function prepareSectionProfile(object: fabric.FabricObject): PreparedSectionProfile {
  const input = captureSectionAnalysisInput(object);
  const cached = sectionAnalysisCache.get(object);
  if (cached && sameSectionAnalysisInput(cached.input, input)) return cached.prepared;

  nextSectionAnalysisRevision += 1;
  let prepared: PreparedSectionProfile;
  try {
    prepared = {
      profile: readSectionProfileInDocumentCoordinates(object),
      error: null,
      revision: nextSectionAnalysisRevision,
    };
  } catch (caught: unknown) {
    prepared = {
      profile: null,
      error: caught instanceof Error ? caught.message : null,
      revision: nextSectionAnalysisRevision,
    };
  }
  sectionAnalysisCache.set(object, { input, prepared });
  return prepared;
}

function displayValue(value: number, power: 1 | 2 | 3 | 4, unit: DisplayUnit): string {
  const factor = unit === 'mm' ? 1 : 0.1;
  const converted = value * factor ** power;
  if (!Number.isFinite(converted)) return '—';
  const magnitude = Math.abs(converted);
  if (magnitude !== 0 && (magnitude >= 1e9 || magnitude < 1e-4)) return converted.toExponential(5);
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 5 }).format(converted);
}

function engineeringToScreen(
  point: { x: number; y: number },
  viewport: fabric.TMat2D,
): fabric.Point {
  return fabric.util.transformPoint(new fabric.Point(point.x, -point.y), viewport);
}

function drawSectionOverlay(
  canvas: fabric.Canvas,
  analysis: SectionAnalysisState,
): void {
  const viewport = canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0];
  const { properties, minX, minY, maxX, maxY } = analysis;
  const context = canvas.getContext();
  const centroid = engineeringToScreen(properties.centroid, viewport);
  const xStart = engineeringToScreen({ x: minX, y: properties.centroid.y }, viewport);
  const xEnd = engineeringToScreen({ x: maxX, y: properties.centroid.y }, viewport);
  const yStart = engineeringToScreen({ x: properties.centroid.x, y: minY }, viewport);
  const yEnd = engineeringToScreen({ x: properties.centroid.x, y: maxY }, viewport);

  context.save();
  context.strokeStyle = '#d81b60';
  context.fillStyle = '#d81b60';
  context.lineWidth = 1;
  context.setLineDash([5, 4]);
  context.beginPath();
  context.moveTo(xStart.x, xStart.y);
  context.lineTo(xEnd.x, xEnd.y);
  context.moveTo(yStart.x, yStart.y);
  context.lineTo(yEnd.x, yEnd.y);
  context.stroke();

  const lowerLeft = engineeringToScreen({ x: minX, y: minY }, viewport);
  const lowerRight = engineeringToScreen({ x: maxX, y: minY }, viewport);
  const upperRight = engineeringToScreen({ x: maxX, y: maxY }, viewport);
  const upperLeft = engineeringToScreen({ x: minX, y: maxY }, viewport);
  context.strokeStyle = '#00897b';
  context.setLineDash([1, 4]);
  context.beginPath();
  context.moveTo(lowerLeft.x, lowerLeft.y);
  context.lineTo(lowerRight.x, lowerRight.y);
  context.lineTo(upperRight.x, upperRight.y);
  context.lineTo(upperLeft.x, upperLeft.y);
  context.lineTo(lowerLeft.x, lowerLeft.y);
  context.stroke();

  const principalAngle = properties.principalAngleDeg * Math.PI / 180;
  const halfLength = Math.hypot(maxX - minX, maxY - minY) * 0.6;
  const direction = { x: Math.cos(principalAngle), y: Math.sin(principalAngle) };
  const principalStart = engineeringToScreen({
    x: properties.centroid.x - direction.x * halfLength,
    y: properties.centroid.y - direction.y * halfLength,
  }, viewport);
  const principalEnd = engineeringToScreen({
    x: properties.centroid.x + direction.x * halfLength,
    y: properties.centroid.y + direction.y * halfLength,
  }, viewport);
  const perpendicular = { x: -direction.y, y: direction.x };
  const secondaryStart = engineeringToScreen({
    x: properties.centroid.x - perpendicular.x * halfLength,
    y: properties.centroid.y - perpendicular.y * halfLength,
  }, viewport);
  const secondaryEnd = engineeringToScreen({
    x: properties.centroid.x + perpendicular.x * halfLength,
    y: properties.centroid.y + perpendicular.y * halfLength,
  }, viewport);
  context.strokeStyle = '#7b1fa2';
  context.setLineDash([2, 3]);
  context.beginPath();
  context.moveTo(principalStart.x, principalStart.y);
  context.lineTo(principalEnd.x, principalEnd.y);
  context.moveTo(secondaryStart.x, secondaryStart.y);
  context.lineTo(secondaryEnd.x, secondaryEnd.y);
  context.stroke();
  context.setLineDash([]);
  context.beginPath();
  context.arc(centroid.x, centroid.y, 4, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

export default function SectionPropertiesPanel({ canvas, object }: SectionPropertiesPanelProps) {
  const t = useI18n((state) => state.t);
  const documentRevision = useEditorStore((state) => state.revision);
  const [unit, setUnit] = useState<DisplayUnit>('mm');
  const [showOverlay, setShowOverlay] = useState(true);
  const objectTransformingRef = useRef(false);

  useEffect(() => {
    objectTransformingRef.current = false;
    const markTransforming = (event?: { target?: fabric.FabricObject }) => {
      if (event?.target === object) objectTransformingRef.current = true;
    };
    const refreshAfterCommit = (event?: { target?: fabric.FabricObject }) => {
      if (event?.target !== object) return;
      // pushHistory advances the document revision synchronously in the Canvas listener.
      // Keep the stale overlay suppressed until React commits that analysis.
      objectTransformingRef.current = true;
    };
    const disposers = [
      canvas.on('object:modified', refreshAfterCommit),
      canvas.on('object:scaling', markTransforming),
      canvas.on('object:rotating', markTransforming),
      canvas.on('object:moving', markTransforming),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, [canvas, object]);

  const preparedProfile = useMemo(() => {
    // Property fields, numeric movement, align/flip, Undo/Redo and document
    // restores do not all emit object:modified. The global revision is only a
    // lightweight observation point; prepareSectionProfile returns the same
    // profile/revision when this particular section's inputs are unchanged.
    void documentRevision;
    return prepareSectionProfile(object);
  }, [documentRevision, object]);
  const analysisStatus = useSectionAnalysis(
    preparedProfile.profile,
    preparedProfile.revision,
  );
  const analysis = preparedProfile.error ? null : analysisStatus.analysis;
  const analysisError = preparedProfile.error ?? analysisStatus.error;

  useEffect(() => {
    if (!showOverlay || !analysis) {
      objectTransformingRef.current = false;
      canvas.requestRenderAll();
      return undefined;
    }
    objectTransformingRef.current = false;
    const handler = () => {
      if (!objectTransformingRef.current) drawSectionOverlay(canvas, analysis);
    };
    const dispose = canvas.on('after:render', handler);
    canvas.requestRenderAll();
    return () => {
      dispose();
      canvas.requestRenderAll();
    };
  }, [analysis, canvas, showOverlay]);

  if (!analysis) {
    return (
      <div className="prop-section section-properties-panel">
        <div className="prop-section-title">{t('sectionProperties')}</div>
        <p
          className="section-error"
          role={analysisStatus.pending && !analysisError ? 'status' : 'alert'}
        >
          {analysisStatus.pending && !analysisError ? '…' : analysisError ?? t('sectionNoResult')}
        </p>
      </div>
    );
  }

  const { profile, properties, minX, minY } = analysis;
  const sectionWidth = analysis.maxX - minX;
  const sectionHeight = analysis.maxY - minY;
  const maximumDimension = Math.max(sectionWidth, sectionHeight);
  const potentiallyThin = Math.min(sectionWidth, sectionHeight)
    <= Math.max(profile.analysisToleranceMm * 10, maximumDimension * 1e-6);
  const linearUnit = unit;
  const areaUnit = `${unit}²`;
  const inertiaUnit = `${unit}⁴`;
  const modulusUnit = `${unit}³`;
  const row = (label: string, value: number, power: 1 | 2 | 3 | 4, suffix: string) => (
    <div className="section-result-row" key={label}>
      <span>{label}</span>
      <output>{displayValue(value, power, unit)} {suffix}</output>
    </div>
  );

  return (
    <div className="prop-section section-properties-panel">
      <div className="prop-section-title">{t('sectionProperties')}</div>
      <p className="section-disclaimer">{t('sectionGeometricOnly')}</p>
      <label className="section-select-row">
        <span>{t('sectionOutputUnit')}</span>
        <select value={unit} onChange={(event) => setUnit(event.target.value as DisplayUnit)}>
          <option value="mm">mm</option>
          <option value="cm">cm</option>
        </select>
      </label>
      <label className="section-checkbox-row">
        <input
          type="checkbox"
          checked={showOverlay}
          onChange={(event) => setShowOverlay(event.target.checked)}
        />
        <span>{t('sectionOverlay')}</span>
      </label>

      <div className="section-result-group">
        <h4>{t('sectionArea')}</h4>
        {row('A', properties.area, 2, areaUnit)}
      </div>
      <div className="section-result-group">
        <h4>{t('sectionCentroid')}</h4>
        {row('Cx', properties.centroid.x - minX, 1, linearUnit)}
        {row('Cy', properties.centroid.y - minY, 1, linearUnit)}
        <p className="section-result-note">{t('sectionCentroidOrigin')}</p>
      </div>
      <div className="section-result-group">
        <h4>{t('sectionMoments')}</h4>
        {row('Ix', properties.ix, 4, inertiaUnit)}
        {row('Iy', properties.iy, 4, inertiaUnit)}
        {row('Ixy', properties.ixy, 4, inertiaUnit)}
      </div>
      <div className="section-result-group">
        <h4>{t('sectionPrincipal')}</h4>
        {row('Imax', properties.principalMax, 4, inertiaUnit)}
        {row('Imin', properties.principalMin, 4, inertiaUnit)}
        <div className="section-result-row"><span>θ</span><output>{displayValue(properties.principalAngleDeg, 1, 'mm')}°</output></div>
      </div>
      <div className="section-result-group">
        <h4>{t('sectionEdgeDistances')}</h4>
        {row('cTop', properties.cTop, 1, linearUnit)}
        {row('cBottom', properties.cBottom, 1, linearUnit)}
        {row('cLeft', properties.cLeft, 1, linearUnit)}
        {row('cRight', properties.cRight, 1, linearUnit)}
      </div>
      <div className="section-result-group">
        <h4>{t('sectionModuli')}</h4>
        {row('ZxTop', properties.zxTop, 3, modulusUnit)}
        {row('ZxBottom', properties.zxBottom, 3, modulusUnit)}
        {row('ZyLeft', properties.zyLeft, 3, modulusUnit)}
        {row('ZyRight', properties.zyRight, 3, modulusUnit)}
      </div>
      {profile.approximate && (
        <p className="section-warning">{t('sectionApproximate')} ({profile.analysisToleranceMm} mm)</p>
      )}
      {profile.rings.filter((ring) => ring.role === 'outer').length > 1 && (
        <p className="section-warning">{t('sectionDisconnected')}</p>
      )}
      {potentiallyThin && <p className="section-warning">{t('sectionThinWarning')}</p>}
    </div>
  );
}
