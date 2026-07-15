import { useEffect, useId, useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import { createStandardSectionOnCanvas } from '../utils/sectionCommands';
import {
  DEFAULT_STANDARD_SECTION_SPECS,
  STANDARD_SECTION_KINDS,
  StandardSectionTemplateError,
  type StandardSectionKind,
  type StandardSectionSpec,
} from '../utils/sectionProfileTemplates';
import { PropertyField } from './PropertyField';

interface StandardSectionGeneratorProps {
  toleranceMm: number;
  setToleranceMm: (value: number) => void;
}

type DimensionKey =
  | 'heightMm'
  | 'widthMm'
  | 'diameterMm'
  | 'thicknessMm'
  | 'webThicknessMm'
  | 'flangeThicknessMm'
  | 'lipLengthMm';

const sectionNameKeys = {
  'rectangular-hollow': 'standardSectionRectangularHollow',
  'circular-hollow': 'standardSectionCircularHollow',
  'h-section': 'standardSectionH',
  channel: 'standardSectionChannel',
  'lipped-channel': 'standardSectionLippedChannel',
} as const;

const dimensionKeysByKind: Record<StandardSectionKind, readonly DimensionKey[]> = {
  'rectangular-hollow': ['heightMm', 'widthMm', 'thicknessMm'],
  'circular-hollow': ['diameterMm', 'thicknessMm'],
  'h-section': ['heightMm', 'widthMm', 'webThicknessMm', 'flangeThicknessMm'],
  channel: ['heightMm', 'widthMm', 'webThicknessMm', 'flangeThicknessMm'],
  'lipped-channel': ['heightMm', 'widthMm', 'lipLengthMm', 'thicknessMm'],
};

const MINIMUM_INPUT_MM = 0.000001;
const MAXIMUM_DIMENSION_MM = 1_000_000_000;
const MAXIMUM_TOLERANCE_MM = 10;

function draftsForSpec(spec: StandardSectionSpec): Partial<Record<DimensionKey, string>> {
  const drafts: Partial<Record<DimensionKey, string>> = {};
  dimensionKeysByKind[spec.kind].forEach((key) => {
    const value = (spec as unknown as Record<DimensionKey, number>)[key];
    drafts[key] = String(value);
  });
  return drafts;
}

function validPositiveDraft(value: string | undefined, maximum: number): boolean {
  const parsed = Number(value);
  return value !== undefined
    && value.trim() !== ''
    && Number.isFinite(parsed)
    && parsed >= MINIMUM_INPUT_MM
    && parsed <= maximum;
}

export default function StandardSectionGenerator({
  toleranceMm,
  setToleranceMm,
}: StandardSectionGeneratorProps) {
  const canvas = useEditorStore((state) => state.canvas);
  const drawingMode = useEditorStore((state) => state.drawingMode);
  const pushHistory = useEditorStore((state) => state.pushHistory);
  const showToast = useEditorStore((state) => state.showToast);
  const t = useI18n((state) => state.t);
  const selectId = useId();
  const fieldIdPrefix = useId();
  const initialSpec: StandardSectionSpec = {
    ...DEFAULT_STANDARD_SECTION_SPECS['rectangular-hollow'],
  };
  const [spec, setSpec] = useState<StandardSectionSpec>(initialSpec);
  const [drafts, setDrafts] = useState(() => draftsForSpec(initialSpec));
  const [toleranceDraft, setToleranceDraft] = useState(String(toleranceMm));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setToleranceDraft(String(toleranceMm));
  }, [toleranceMm]);

  const setKind = (kind: StandardSectionKind) => {
    const next = { ...DEFAULT_STANDARD_SECTION_SPECS[kind] } as StandardSectionSpec;
    setSpec(next);
    setDrafts(draftsForSpec(next));
    setError(null);
  };
  const setDimensionDraft = (key: DimensionKey, value: string) => {
    setDrafts((current) => ({ ...current, [key]: value }));
    if (validPositiveDraft(value, MAXIMUM_DIMENSION_MM)) {
      setSpec((current) => ({ ...current, [key]: Number(value) } as StandardSectionSpec));
    }
    setError(null);
  };
  const setAnalysisToleranceDraft = (value: string) => {
    setToleranceDraft(value);
    if (validPositiveDraft(value, MAXIMUM_TOLERANCE_MM)) setToleranceMm(Number(value));
    setError(null);
  };
  const invalidDimensionDraft = dimensionKeysByKind[spec.kind]
    .some((key) => !validPositiveDraft(drafts[key], MAXIMUM_DIMENSION_MM));
  const invalidToleranceDraft = !validPositiveDraft(toleranceDraft, MAXIMUM_TOLERANCE_MM);
  const hasInvalidDraft = invalidDimensionDraft || invalidToleranceDraft;
  const generate = () => {
    if (!canvas || drawingMode !== 'cad') {
      setError(t('sectionCadOnly'));
      return;
    }
    try {
      createStandardSectionOnCanvas(canvas, pushHistory, spec, {
        toleranceMm,
        name: t(sectionNameKeys[spec.kind]),
      });
      setError(null);
      showToast(t('standardSectionCreated'), 'success');
    } catch (caught: unknown) {
      if (caught instanceof StandardSectionTemplateError) {
        const errorKeys = {
          'invalid-dimension': 'standardSectionInvalidDimension',
          'rectangular-thickness': 'standardSectionInvalidRectangularThickness',
          'pipe-thickness': 'standardSectionInvalidPipeThickness',
          'web-thickness': 'standardSectionInvalidWebThickness',
          'flange-thickness': 'standardSectionInvalidFlangeThickness',
          'lipped-thickness': 'standardSectionInvalidLippedThickness',
          'lip-geometry': 'standardSectionInvalidLipGeometry',
          'curve-vertex-limit': 'standardSectionCurveLimit',
        } as const;
        setError(t(errorKeys[caught.code]));
      } else {
        setError(t('standardSectionInvalid'));
      }
      showToast(t('standardSectionInvalid'), 'error');
    }
  };

  const field = (label: string, key: DimensionKey, value: number) => (
    <PropertyField label={label} labelFor={`${fieldIdPrefix}-${key}`}>
      <input
        id={`${fieldIdPrefix}-${key}`}
        type="number"
        value={drafts[key] ?? String(value)}
        onChange={(event) => setDimensionDraft(key, event.target.value)}
        min={MINIMUM_INPUT_MM}
        max={MAXIMUM_DIMENSION_MM}
        step={0.1}
        aria-invalid={!validPositiveDraft(drafts[key], MAXIMUM_DIMENSION_MM)}
      />
    </PropertyField>
  );

  return (
    <div className="standard-section-generator">
      <p className="section-dialog-help">{t('standardSectionHelp')}</p>
      <PropertyField label={t('standardSectionShape')} labelFor={selectId}>
        <select
          id={selectId}
          value={spec.kind}
          onChange={(event) => setKind(event.target.value as StandardSectionKind)}
        >
          {STANDARD_SECTION_KINDS.map((kind) => (
            <option key={kind} value={kind}>{t(sectionNameKeys[kind])}</option>
          ))}
        </select>
      </PropertyField>

      <div className="standard-section-dimensions">
        {spec.kind === 'rectangular-hollow' && (
          <>
            {field(t('standardSectionHeight'), 'heightMm', spec.heightMm)}
            {field(t('standardSectionWidth'), 'widthMm', spec.widthMm)}
            {field(t('standardSectionThickness'), 'thicknessMm', spec.thicknessMm)}
          </>
        )}
        {spec.kind === 'circular-hollow' && (
          <>
            {field(t('standardSectionDiameter'), 'diameterMm', spec.diameterMm)}
            {field(t('standardSectionThickness'), 'thicknessMm', spec.thicknessMm)}
          </>
        )}
        {(spec.kind === 'h-section' || spec.kind === 'channel') && (
          <>
            {field(t('standardSectionHeight'), 'heightMm', spec.heightMm)}
            {field(t('standardSectionWidth'), 'widthMm', spec.widthMm)}
            {field(t('standardSectionWebThickness'), 'webThicknessMm', spec.webThicknessMm)}
            {field(t('standardSectionFlangeThickness'), 'flangeThicknessMm', spec.flangeThicknessMm)}
          </>
        )}
        {spec.kind === 'lipped-channel' && (
          <>
            {field(t('standardSectionHeight'), 'heightMm', spec.heightMm)}
            {field(t('standardSectionWidth'), 'widthMm', spec.widthMm)}
            {field(t('standardSectionLipLength'), 'lipLengthMm', spec.lipLengthMm)}
            {field(t('standardSectionThickness'), 'thicknessMm', spec.thicknessMm)}
          </>
        )}
      </div>

      <PropertyField label={t('sectionTolerance')} labelFor={`${fieldIdPrefix}-tolerance`}>
        <input
          id={`${fieldIdPrefix}-tolerance`}
          type="number"
          value={toleranceDraft}
          onChange={(event) => setAnalysisToleranceDraft(event.target.value)}
          min={MINIMUM_INPUT_MM}
          max={MAXIMUM_TOLERANCE_MM}
          step={0.001}
          aria-invalid={invalidToleranceDraft}
        />
      </PropertyField>
      {hasInvalidDraft && (
        <p className="section-warning" role="alert">{t('standardSectionInvalidDimension')}</p>
      )}
      <p className="section-dialog-help">{t('standardSectionSharpCornerNote')}</p>
      <button
        type="button"
        className="toolbar-btn standard-section-generate"
        onClick={generate}
        disabled={!canvas || drawingMode !== 'cad' || hasInvalidDraft}
      >
        {t('standardSectionGenerate')}
      </button>
      {error && <p className="section-error" role="alert">{error}</p>}
    </div>
  );
}
