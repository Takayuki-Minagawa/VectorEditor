import {
  CompensatedSum,
  SectionValidationError,
  sectionBoundsCentre,
  sectionProfileBounds,
  type SectionPoint,
  type SectionProfileData,
  type SectionProperties,
} from '../domain/section';
import { normalizeAndAssertValidSectionProfileTopology } from './sectionTopology';

interface IntegralAccumulator {
  twiceArea: CompensatedSum;
  firstXTimesSix: CompensatedSum;
  firstYTimesSix: CompensatedSum;
  ixTimesTwelve: CompensatedSum;
  iyTimesTwelve: CompensatedSum;
  ixyTimesTwentyFour: CompensatedSum;
}

interface RingIntegral {
  area: number;
  centroid: SectionPoint;
  ix: number;
  iy: number;
  ixy: number;
}

function createAccumulator(): IntegralAccumulator {
  return {
    twiceArea: new CompensatedSum(),
    firstXTimesSix: new CompensatedSum(),
    firstYTimesSix: new CompensatedSum(),
    ixTimesTwelve: new CompensatedSum(),
    iyTimesTwelve: new CompensatedSum(),
    ixyTimesTwentyFour: new CompensatedSum(),
  };
}

function accumulateRing(
  accumulator: IntegralAccumulator,
  points: readonly SectionPoint[],
  origin: SectionPoint,
): void {
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const x0 = current.x - origin.x;
    const y0 = current.y - origin.y;
    const x1 = next.x - origin.x;
    const y1 = next.y - origin.y;
    const cross = x0 * y1 - x1 * y0;

    accumulator.twiceArea.add(cross);
    accumulator.firstXTimesSix.add((x0 + x1) * cross);
    accumulator.firstYTimesSix.add((y0 + y1) * cross);
    accumulator.ixTimesTwelve.add((y0 * y0 + y0 * y1 + y1 * y1) * cross);
    accumulator.iyTimesTwelve.add((x0 * x0 + x0 * x1 + x1 * x1) * cross);
    accumulator.ixyTimesTwentyFour.add(
      (2 * x0 * y0 + x0 * y1 + x1 * y0 + 2 * x1 * y1) * cross,
    );
  }
}

function integrateRing(points: readonly SectionPoint[]): RingIntegral {
  // Integrate every ring in its own nearby frame. A single profile-wide frame
  // loses small ring areas when disconnected islands are very far apart.
  const origin = points[0];
  const accumulator = createAccumulator();
  accumulateRing(accumulator, points, origin);
  const twiceArea = accumulator.twiceArea.value();
  const area = twiceArea / 2;
  const centroidLocalX = accumulator.firstXTimesSix.value() / (3 * twiceArea);
  const centroidLocalY = accumulator.firstYTimesSix.value() / (3 * twiceArea);
  const ixOrigin = accumulator.ixTimesTwelve.value() / 12;
  const iyOrigin = accumulator.iyTimesTwelve.value() / 12;
  const ixyOrigin = accumulator.ixyTimesTwentyFour.value() / 24;

  return {
    area,
    centroid: {
      x: origin.x + centroidLocalX,
      y: origin.y + centroidLocalY,
    },
    ix: ixOrigin - area * centroidLocalY * centroidLocalY,
    iy: iyOrigin - area * centroidLocalX * centroidLocalX,
    ixy: ixyOrigin - area * centroidLocalX * centroidLocalY,
  };
}

function principalMomentAtAngle(
  integrals: readonly RingIntegral[],
  centroid: SectionPoint,
  angleRad: number,
): number {
  const cosine = Math.cos(angleRad);
  const sine = Math.sin(angleRad);
  const sum = new CompensatedSum();
  for (const integral of integrals) {
    const dx = integral.centroid.x - centroid.x;
    const dy = integral.centroid.y - centroid.y;
    const perpendicularDistance = -sine * dx + cosine * dy;
    sum.add(
      integral.ix * cosine * cosine
      - 2 * integral.ixy * cosine * sine
      + integral.iy * sine * sine
      + integral.area * perpendicularDistance * perpendicularDistance,
    );
  }
  return sum.value();
}

function normalizePrincipalAngle(angleRad: number): number {
  let degrees = angleRad * 180 / Math.PI;
  while (degrees < -90) degrees += 180;
  while (degrees >= 90) degrees -= 180;
  // Avoid displaying a negative zero in result tables.
  return Object.is(degrees, -0) || Math.abs(degrees) < 1e-12 ? 0 : degrees;
}

function createCalculationIssue(message: string): SectionValidationError {
  return new SectionValidationError([{ code: 'degenerate-ring', message }]);
}

function clampNumericalZero(value: number, reference: number): number {
  const tolerance = Math.max(1, Math.abs(reference)) * Number.EPSILON * 128;
  return Math.abs(value) <= tolerance ? 0 : value;
}

/**
 * Calculates gross geometric section properties in the section's mm,
 * x-right/y-up coordinate system. Ring role controls material addition/removal;
 * input winding is accepted and canonicalised before integration.
 */
export function calculateSectionProperties(input: SectionProfileData): SectionProperties {
  const profile = normalizeAndAssertValidSectionProfileTopology(input);
  const bounds = sectionProfileBounds(profile, 'outer');
  const reference = sectionBoundsCentre(bounds);
  if (!Number.isFinite(reference.x) || !Number.isFinite(reference.y)) {
    throw createCalculationIssue('Section coordinate range is too large to analyse safely.');
  }

  const integrals = profile.rings.map((ring) => integrateRing(ring.points));
  const areaSum = new CompensatedSum();
  integrals.forEach((integral) => areaSum.add(integral.area));
  const area = areaSum.value();
  // A global bounding box is not a numerical error scale for disconnected
  // profiles: two tiny valid islands can be kilometres apart. Base the
  // cancellation threshold on the actual contributing ring areas instead.
  const areaScale = Math.max(
    1,
    integrals.reduce((sum, integral) => sum + Math.abs(integral.area), 0),
  );
  const areaTolerance = areaScale * Number.EPSILON * 256;
  if (!Number.isFinite(area) || area <= areaTolerance) {
    throw createCalculationIssue('Section material area must be positive and nondegenerate after holes are removed.');
  }

  const firstX = new CompensatedSum();
  const firstY = new CompensatedSum();
  integrals.forEach((integral) => {
    firstX.add(integral.area * (integral.centroid.x - reference.x));
    firstY.add(integral.area * (integral.centroid.y - reference.y));
  });
  const centroid = {
    x: reference.x + firstX.value() / area,
    y: reference.y + firstY.value() / area,
  };

  const ixSum = new CompensatedSum();
  const iySum = new CompensatedSum();
  const ixySum = new CompensatedSum();
  let ixMagnitude = 0;
  let iyMagnitude = 0;
  let ixyMagnitude = 0;
  integrals.forEach((integral) => {
    const dx = integral.centroid.x - centroid.x;
    const dy = integral.centroid.y - centroid.y;
    const ixContribution = integral.ix + integral.area * dy * dy;
    const iyContribution = integral.iy + integral.area * dx * dx;
    const ixyContribution = integral.ixy + integral.area * dx * dy;
    ixSum.add(ixContribution);
    iySum.add(iyContribution);
    ixySum.add(ixyContribution);
    ixMagnitude += Math.abs(ixContribution);
    iyMagnitude += Math.abs(iyContribution);
    ixyMagnitude += Math.abs(ixyContribution);
  });
  const ix = clampNumericalZero(ixSum.value(), ixMagnitude);
  const iy = clampNumericalZero(iySum.value(), iyMagnitude);
  const ixy = clampNumericalZero(
    ixySum.value(),
    Math.max(ixyMagnitude, Math.sqrt(Math.abs(ix * iy))),
  );

  if (![centroid.x, centroid.y, ix, iy, ixy].every(Number.isFinite) || ix <= 0 || iy <= 0) {
    throw createCalculationIssue('Section properties are non-finite or non-positive; check ring containment and geometry.');
  }

  const isotropicTolerance = Math.max(ix, iy) * Number.EPSILON * 128;
  let principalAngleRad = Math.abs(ix - iy) <= isotropicTolerance && Math.abs(ixy) <= isotropicTolerance
    ? 0
    : Math.atan2(-2 * ixy, ix - iy) / 2;
  let principalMax = principalMomentAtAngle(integrals, centroid, principalAngleRad);
  let principalMin = principalMomentAtAngle(integrals, centroid, principalAngleRad + Math.PI / 2);
  if (principalMin > principalMax) {
    [principalMax, principalMin] = [principalMin, principalMax];
    principalAngleRad += Math.PI / 2;
  }
  // Do not scale the zero threshold by Imax. A valid, widely separated
  // built-up section can be extremely ill-conditioned while still having a
  // small positive minor-axis inertia.
  principalMin = clampNumericalZero(principalMin, principalMin);
  if (
    principalMin <= 0
    || !Number.isFinite(principalMin)
    || !Number.isFinite(principalMax)
  ) {
    throw createCalculationIssue('Section principal second moments must be positive.');
  }
  const principalAngleDeg = normalizePrincipalAngle(principalAngleRad);

  const cTop = bounds.maxY - centroid.y;
  const cBottom = centroid.y - bounds.minY;
  const cLeft = centroid.x - bounds.minX;
  const cRight = bounds.maxX - centroid.x;
  if (![cTop, cBottom, cLeft, cRight].every((distance) => Number.isFinite(distance) && distance > 0)) {
    throw createCalculationIssue('Section centroid must lie within finite outer-bound extents.');
  }

  return {
    area,
    centroid,
    ix,
    iy,
    ixy,
    principalMax,
    principalMin,
    principalAngleDeg,
    cTop,
    cBottom,
    cLeft,
    cRight,
    zxTop: ix / cTop,
    zxBottom: ix / cBottom,
    zyLeft: iy / cLeft,
    zyRight: iy / cRight,
  };
}
