import {
  type SectionPoint,
  type SectionProfileData,
  type SectionRing,
} from '../domain/section';
import { normalizeAndAssertValidSectionProfileTopology } from './sectionTopology';

export type StandardSectionKind =
  | 'rectangular-hollow'
  | 'circular-hollow'
  | 'h-section'
  | 'channel'
  | 'lipped-channel';

export type StandardSectionSpec =
  | {
    kind: 'rectangular-hollow';
    heightMm: number;
    widthMm: number;
    thicknessMm: number;
  }
  | {
    kind: 'circular-hollow';
    diameterMm: number;
    thicknessMm: number;
  }
  | {
    kind: 'h-section';
    heightMm: number;
    widthMm: number;
    webThicknessMm: number;
    flangeThicknessMm: number;
  }
  | {
    kind: 'channel';
    heightMm: number;
    widthMm: number;
    webThicknessMm: number;
    flangeThicknessMm: number;
  }
  | {
    kind: 'lipped-channel';
    heightMm: number;
    widthMm: number;
    lipLengthMm: number;
    thicknessMm: number;
  };

export type StandardSectionSpecByKind = {
  [Kind in StandardSectionKind]: Extract<StandardSectionSpec, { kind: Kind }>;
};

export const STANDARD_SECTION_KINDS: readonly StandardSectionKind[] = [
  'rectangular-hollow',
  'circular-hollow',
  'h-section',
  'channel',
  'lipped-channel',
];

export const DEFAULT_STANDARD_SECTION_SPECS: Readonly<StandardSectionSpecByKind> = {
  'rectangular-hollow': {
    kind: 'rectangular-hollow',
    heightMm: 200,
    widthMm: 200,
    thicknessMm: 9,
  },
  'circular-hollow': {
    kind: 'circular-hollow',
    diameterMm: 216.3,
    thicknessMm: 8.2,
  },
  'h-section': {
    kind: 'h-section',
    heightMm: 300,
    widthMm: 150,
    webThicknessMm: 6.5,
    flangeThicknessMm: 9,
  },
  channel: {
    kind: 'channel',
    heightMm: 200,
    widthMm: 75,
    webThicknessMm: 5.5,
    flangeThicknessMm: 9,
  },
  'lipped-channel': {
    kind: 'lipped-channel',
    heightMm: 150,
    widthMm: 50,
    lipLengthMm: 20,
    thicknessMm: 2.3,
  },
};

export type StandardSectionTemplateErrorCode =
  | 'invalid-dimension'
  | 'rectangular-thickness'
  | 'pipe-thickness'
  | 'web-thickness'
  | 'flange-thickness'
  | 'lipped-thickness'
  | 'lip-geometry'
  | 'curve-vertex-limit';

export class StandardSectionTemplateError extends Error {
  readonly code: StandardSectionTemplateErrorCode;

  constructor(code: StandardSectionTemplateErrorCode, message: string) {
    super(message);
    this.name = 'StandardSectionTemplateError';
    this.code = code;
  }
}

const MAX_STANDARD_SECTION_DIMENSION_MM = 1_000_000_000;
// A pipe has two rings; keeping each at 50,000 vertices stays within the
// document serializer's 100,000-point section limit.
const MAX_PIPE_RING_VERTICES = 50_000;

function assertPositive(label: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_STANDARD_SECTION_DIMENSION_MM) {
    throw new StandardSectionTemplateError(
      'invalid-dimension',
      `${label} must be a positive finite dimension no greater than ${MAX_STANDARD_SECTION_DIMENSION_MM} mm.`,
    );
  }
}

function rectangleRing(widthMm: number, heightMm: number, role: SectionRing['role']): SectionRing {
  const halfWidth = widthMm / 2;
  const halfHeight = heightMm / 2;
  const points: SectionPoint[] = role === 'outer'
    ? [
      { x: -halfWidth, y: -halfHeight },
      { x: halfWidth, y: -halfHeight },
      { x: halfWidth, y: halfHeight },
      { x: -halfWidth, y: halfHeight },
    ]
    : [
      { x: -halfWidth, y: -halfHeight },
      { x: -halfWidth, y: halfHeight },
      { x: halfWidth, y: halfHeight },
      { x: halfWidth, y: -halfHeight },
    ];
  return { role, points };
}

function circleSegmentCount(radiusMm: number, toleranceMm: number): number {
  // Match the conservative curve integration margin used by Fabric section
  // conversion: the public tolerance remains an upper bound on chord sagitta.
  const sagittaMm = Math.min(radiusMm, toleranceMm / 16);
  const maximumAngle = 2 * Math.acos(Math.max(-1, 1 - sagittaMm / radiusMm));
  const requiredCount = Math.ceil(Math.PI * 2 / maximumAngle);
  const segmentCount = Math.max(32, Math.ceil(requiredCount / 4) * 4);
  if (!Number.isFinite(segmentCount) || segmentCount > MAX_PIPE_RING_VERTICES) {
    throw new StandardSectionTemplateError(
      'curve-vertex-limit',
      `Pipe curve tessellation exceeds ${MAX_PIPE_RING_VERTICES.toLocaleString()} vertices per ring. Increase the analysis tolerance.`,
    );
  }
  return segmentCount;
}

function circularRing(
  radiusMm: number,
  role: SectionRing['role'],
  segmentCount: number,
): SectionRing {
  const direction = role === 'outer' ? 1 : -1;
  return {
    role,
    points: Array.from({ length: segmentCount }, (_, index) => {
      const angle = direction * Math.PI * 2 * index / segmentCount;
      return { x: radiusMm * Math.cos(angle), y: radiusMm * Math.sin(angle) };
    }),
  };
}

function profile(
  rings: SectionRing[],
  analysisToleranceMm: number,
  approximate: boolean,
): SectionProfileData {
  return normalizeAndAssertValidSectionProfileTopology({
    version: 1,
    rings,
    analysisToleranceMm,
    approximate,
  });
}

function rectangularHollowProfile(
  spec: Extract<StandardSectionSpec, { kind: 'rectangular-hollow' }>,
  toleranceMm: number,
): SectionProfileData {
  const { heightMm, widthMm, thicknessMm } = spec;
  assertPositive('H', heightMm);
  assertPositive('B', widthMm);
  assertPositive('t', thicknessMm);
  if (2 * thicknessMm >= Math.min(heightMm, widthMm)) {
    throw new StandardSectionTemplateError(
      'rectangular-thickness',
      'Rectangular tube thickness must satisfy 2t < min(H, B).',
    );
  }
  return profile([
    rectangleRing(widthMm, heightMm, 'outer'),
    rectangleRing(widthMm - 2 * thicknessMm, heightMm - 2 * thicknessMm, 'hole'),
  ], toleranceMm, false);
}

function circularHollowProfile(
  spec: Extract<StandardSectionSpec, { kind: 'circular-hollow' }>,
  toleranceMm: number,
): SectionProfileData {
  const { diameterMm, thicknessMm } = spec;
  assertPositive('D', diameterMm);
  assertPositive('t', thicknessMm);
  if (2 * thicknessMm >= diameterMm) {
    throw new StandardSectionTemplateError('pipe-thickness', 'Pipe thickness must satisfy 2t < D.');
  }
  const segmentCount = circleSegmentCount(diameterMm / 2, toleranceMm);
  return profile([
    circularRing(diameterMm / 2, 'outer', segmentCount),
    circularRing(diameterMm / 2 - thicknessMm, 'hole', segmentCount),
  ], toleranceMm, true);
}

function assertWebAndFlangeDimensions(
  spec: Extract<StandardSectionSpec, { kind: 'h-section' | 'channel' }>,
): void {
  assertPositive('H', spec.heightMm);
  assertPositive('B', spec.widthMm);
  assertPositive('tw', spec.webThicknessMm);
  assertPositive('tf', spec.flangeThicknessMm);
  if (spec.webThicknessMm >= spec.widthMm) {
    throw new StandardSectionTemplateError('web-thickness', 'Web thickness must satisfy tw < B.');
  }
  if (2 * spec.flangeThicknessMm >= spec.heightMm) {
    throw new StandardSectionTemplateError('flange-thickness', 'Flange thickness must satisfy 2tf < H.');
  }
}

function hSectionProfile(
  spec: Extract<StandardSectionSpec, { kind: 'h-section' }>,
  toleranceMm: number,
): SectionProfileData {
  assertWebAndFlangeDimensions(spec);
  const halfWidth = spec.widthMm / 2;
  const halfHeight = spec.heightMm / 2;
  const halfWeb = spec.webThicknessMm / 2;
  const flangeInner = halfHeight - spec.flangeThicknessMm;
  return profile([{
    role: 'outer',
    points: [
      { x: -halfWidth, y: -halfHeight },
      { x: halfWidth, y: -halfHeight },
      { x: halfWidth, y: -flangeInner },
      { x: halfWeb, y: -flangeInner },
      { x: halfWeb, y: flangeInner },
      { x: halfWidth, y: flangeInner },
      { x: halfWidth, y: halfHeight },
      { x: -halfWidth, y: halfHeight },
      { x: -halfWidth, y: flangeInner },
      { x: -halfWeb, y: flangeInner },
      { x: -halfWeb, y: -flangeInner },
      { x: -halfWidth, y: -flangeInner },
    ],
  }], toleranceMm, false);
}

function channelProfile(
  spec: Extract<StandardSectionSpec, { kind: 'channel' }>,
  toleranceMm: number,
): SectionProfileData {
  assertWebAndFlangeDimensions(spec);
  const left = -spec.widthMm / 2;
  const right = spec.widthMm / 2;
  const halfHeight = spec.heightMm / 2;
  const webInner = left + spec.webThicknessMm;
  const flangeInner = halfHeight - spec.flangeThicknessMm;
  return profile([{
    role: 'outer',
    points: [
      { x: left, y: -halfHeight },
      { x: right, y: -halfHeight },
      { x: right, y: -flangeInner },
      { x: webInner, y: -flangeInner },
      { x: webInner, y: flangeInner },
      { x: right, y: flangeInner },
      { x: right, y: halfHeight },
      { x: left, y: halfHeight },
    ],
  }], toleranceMm, false);
}

function lippedChannelProfile(
  spec: Extract<StandardSectionSpec, { kind: 'lipped-channel' }>,
  toleranceMm: number,
): SectionProfileData {
  const { heightMm, widthMm, lipLengthMm, thicknessMm } = spec;
  assertPositive('H', heightMm);
  assertPositive('B', widthMm);
  assertPositive('C', lipLengthMm);
  assertPositive('t', thicknessMm);
  if (2 * thicknessMm >= widthMm) {
    throw new StandardSectionTemplateError(
      'lipped-thickness',
      'Lipped channel thickness must satisfy 2t < B.',
    );
  }
  if (lipLengthMm <= thicknessMm || 2 * lipLengthMm >= heightMm) {
    throw new StandardSectionTemplateError(
      'lip-geometry',
      'Lip depth must satisfy t < C and 2C < H.',
    );
  }
  const left = -widthMm / 2;
  const right = widthMm / 2;
  const halfHeight = heightMm / 2;
  const webInner = left + thicknessMm;
  const lipInner = right - thicknessMm;
  return profile([{
    role: 'outer',
    points: [
      { x: left, y: -halfHeight },
      { x: right, y: -halfHeight },
      { x: right, y: -halfHeight + lipLengthMm },
      { x: lipInner, y: -halfHeight + lipLengthMm },
      { x: lipInner, y: -halfHeight + thicknessMm },
      { x: webInner, y: -halfHeight + thicknessMm },
      { x: webInner, y: halfHeight - thicknessMm },
      { x: lipInner, y: halfHeight - thicknessMm },
      { x: lipInner, y: halfHeight - lipLengthMm },
      { x: right, y: halfHeight - lipLengthMm },
      { x: right, y: halfHeight },
      { x: left, y: halfHeight },
    ],
  }], toleranceMm, false);
}

/** Creates a centred x-right/y-up profile from nominal section dimensions. */
export function createStandardSectionProfile(
  spec: StandardSectionSpec,
  toleranceMm = 0.01,
): SectionProfileData {
  assertPositive('Analysis tolerance', toleranceMm);
  switch (spec.kind) {
    case 'rectangular-hollow': return rectangularHollowProfile(spec, toleranceMm);
    case 'circular-hollow': return circularHollowProfile(spec, toleranceMm);
    case 'h-section': return hSectionProfile(spec, toleranceMm);
    case 'channel': return channelProfile(spec, toleranceMm);
    case 'lipped-channel': return lippedChannelProfile(spec, toleranceMm);
  }
}
