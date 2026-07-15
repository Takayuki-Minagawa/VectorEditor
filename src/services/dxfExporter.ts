import * as fabric from 'fabric';
import { readSectionProfileInDocumentCoordinates } from '../utils/sectionGeometry';
import { getFabricMetadata } from '../utils/fabricObjectMetadata';

export interface DxfExportResult {
  text: string;
  unsupportedTypes: string[];
  approximatedTypes: string[];
}

interface DxfPoint {
  x: number;
  y: number;
}

const ELLIPSE_SEGMENTS = 64;

function number(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.abs(value) < 1e-9 ? 0 : value;
  return rounded.toFixed(6).replace(/\.?0+$/, '');
}

function pair(code: number, value: string | number): string[] {
  return [String(code), typeof value === 'number' ? number(value) : value];
}

function escapeText(value: string): string {
  return Array.from(value.replace(/[\r\n]+/g, ' '))
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 32 && codePoint <= 126 ? character : '?';
    })
    .join('');
}

function hasNonAsciiText(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint > 126;
  });
}

function scenePoint(object: fabric.FabricObject, point: DxfPoint): DxfPoint {
  const transformed = fabric.util.transformPoint(point, object.calcTransformMatrix());
  return { x: transformed.x, y: transformed.y };
}

function dxfPoint(point: DxfPoint, drawingHeight: number): DxfPoint {
  return { x: point.x, y: drawingHeight - point.y };
}

function addLine(lines: string[], from: DxfPoint, to: DxfPoint): void {
  lines.push(
    ...pair(0, 'LINE'),
    ...pair(8, '0'),
    ...pair(10, from.x),
    ...pair(20, from.y),
    ...pair(30, 0),
    ...pair(11, to.x),
    ...pair(21, to.y),
    ...pair(31, 0),
  );
}

function addPolyline(lines: string[], points: DxfPoint[], closed: boolean): void {
  if (points.length < 2) return;
  lines.push(
    ...pair(0, 'POLYLINE'),
    ...pair(8, '0'),
    ...pair(66, 1),
    ...pair(70, closed ? 1 : 0),
    ...pair(10, 0),
    ...pair(20, 0),
    ...pair(30, 0),
  );
  points.forEach((point) => {
    lines.push(
      ...pair(0, 'VERTEX'),
      ...pair(8, '0'),
      ...pair(10, point.x),
      ...pair(20, point.y),
      ...pair(30, 0),
      ...pair(70, 0),
    );
  });
  lines.push(...pair(0, 'SEQEND'), ...pair(8, '0'));
}

function transformedEllipsePoints(
  object: fabric.FabricObject,
  rx: number,
  ry: number,
  drawingHeight: number,
): DxfPoint[] {
  return Array.from({ length: ELLIPSE_SEGMENTS }, (_, index) => {
    const angle = (index / ELLIPSE_SEGMENTS) * Math.PI * 2;
    return dxfPoint(
      scenePoint(object, { x: Math.cos(angle) * rx, y: Math.sin(angle) * ry }),
      drawingHeight,
    );
  });
}

function isUniformCircleTransform(object: fabric.Circle): boolean {
  const matrix = object.calcTransformMatrix();
  const scaleX = Math.hypot(matrix[0], matrix[1]);
  const scaleY = Math.hypot(matrix[2], matrix[3]);
  const perpendicular = Math.abs(matrix[0] * matrix[2] + matrix[1] * matrix[3]) < 1e-7;
  return perpendicular && Math.abs(scaleX - scaleY) < 1e-7;
}

interface DxfTextTransform {
  heightScale: number;
  rotation: number;
  approximated: boolean;
}

function getTextTransform(object: fabric.FabricText): DxfTextTransform {
  const matrix = object.calcTransformMatrix();
  const scaleX = Math.hypot(matrix[0], matrix[1]);
  const scaleY = Math.hypot(matrix[2], matrix[3]);
  const scaleReference = Math.max(1, scaleX, scaleY);
  const nonUniform = Math.abs(scaleX - scaleY) > 1e-7 * scaleReference;
  const scaleProduct = scaleX * scaleY;
  const normalizedAxisDot = scaleProduct > 1e-12
    ? Math.abs(matrix[0] * matrix[2] + matrix[1] * matrix[3]) / scaleProduct
    : 0;
  const mirrored = matrix[0] * matrix[3] - matrix[1] * matrix[2] < 0;
  return {
    // Text height follows the transformed local Y axis. Using the X axis
    // scale produces visibly incorrect DXF text for scaleY/skew transforms.
    heightScale: scaleY,
    rotation: -Math.atan2(matrix[1], matrix[0]) * 180 / Math.PI,
    // R12 TEXT has no mirror flag in the subset emitted here, so a reflected
    // Fabric transform must also be disclosed as an approximation.
    approximated: nonUniform || normalizedAxisDot > 1e-7 || mirrored,
  };
}

function addText(
  lines: string[],
  object: fabric.FabricText,
  drawingHeight: number,
  transform: DxfTextTransform,
): void {
  const lineStep = object.fontSize * object.lineHeight;
  const values = object.text.split(/\r?\n/);

  values.forEach((value, index) => {
    const localX = -object.width / 2;
    const localY = -object.height / 2 + object.fontSize + index * lineStep;
    const insertion = dxfPoint(scenePoint(object, { x: localX, y: localY }), drawingHeight);
    lines.push(
      ...pair(0, 'TEXT'),
      ...pair(8, '0'),
      ...pair(10, insertion.x),
      ...pair(20, insertion.y),
      ...pair(30, 0),
      ...pair(40, Math.max(0.01, object.fontSize * transform.heightScale)),
      ...pair(1, escapeText(value)),
      ...pair(50, transform.rotation),
      ...pair(7, 'STANDARD'),
    );
  });
}

function typeName(object: fabric.FabricObject): string {
  const constructor = object.constructor as typeof fabric.FabricObject;
  return constructor.type || object.type || constructor.name || 'Unknown';
}

/**
 * Convert Fabric objects to the AutoCAD R12 ASCII DXF subset used by this editor.
 * Scene coordinates are treated as millimetres and the Y axis is flipped to the
 * conventional CAD bottom-left origin.
 */
export function exportObjectsToDxf(
  objects: fabric.FabricObject[],
  drawingWidth: number,
  drawingHeight: number,
): DxfExportResult {
  const entities: string[] = [];
  const unsupported = new Set<string>();
  const approximated = new Set<string>();

  const visit = (object: fabric.FabricObject): void => {
    if (!object.visible || object.excludeFromExport) return;

    const metadata = getFabricMetadata(object);
    if (metadata.objectKind === 'sectionProfile' && metadata.sectionProfileData) {
      const profile = readSectionProfileInDocumentCoordinates(object);
      profile.rings.forEach((ring) => {
        addPolyline(
          entities,
          ring.points.map((point) => ({
            x: point.x,
            // Section metadata uses engineering coordinates (+y up), with
            // document y=0 at the Canvas top. Shift that coordinate into the
            // same bottom-left DXF space used by the ordinary Fabric paths.
            y: drawingHeight + point.y,
          })),
          true,
        );
      });
      if (profile.approximate) approximated.add('SectionProfileApproximation');
      if (profile.rings.some((ring) => ring.role === 'hole')) {
        // R12 POLYLINE carries no material/hole topology. The boundary is
        // exported, but downstream CAD software may interpret it as material.
        approximated.add('SectionProfileHoles');
      }
      return;
    }

    if (object instanceof fabric.Group) {
      object.getObjects().forEach(visit);
      return;
    }

    if (object instanceof fabric.Line) {
      const points = object.calcLinePoints();
      addLine(
        entities,
        dxfPoint(scenePoint(object, { x: points.x1, y: points.y1 }), drawingHeight),
        dxfPoint(scenePoint(object, { x: points.x2, y: points.y2 }), drawingHeight),
      );
      return;
    }

    if (object instanceof fabric.Polyline && !(object instanceof fabric.Polygon)) {
      const points = object.points.map((point) => dxfPoint(
        scenePoint(object, {
          x: point.x - object.pathOffset.x,
          y: point.y - object.pathOffset.y,
        }),
        drawingHeight,
      ));
      addPolyline(entities, points, false);
      return;
    }

    if (object instanceof fabric.Rect) {
      const halfWidth = object.width / 2;
      const halfHeight = object.height / 2;
      const points = [
        { x: -halfWidth, y: -halfHeight },
        { x: halfWidth, y: -halfHeight },
        { x: halfWidth, y: halfHeight },
        { x: -halfWidth, y: halfHeight },
      ].map((point) => dxfPoint(scenePoint(object, point), drawingHeight));
      addPolyline(entities, points, true);
      if (object.rx > 0 || object.ry > 0) approximated.add('RoundedRect');
      return;
    }

    if (object instanceof fabric.Circle) {
      if (isUniformCircleTransform(object)) {
        const matrix = object.calcTransformMatrix();
        const scale = Math.hypot(matrix[0], matrix[1]);
        const center = dxfPoint(scenePoint(object, { x: 0, y: 0 }), drawingHeight);
        entities.push(
          ...pair(0, 'CIRCLE'),
          ...pair(8, '0'),
          ...pair(10, center.x),
          ...pair(20, center.y),
          ...pair(30, 0),
          ...pair(40, object.radius * scale),
        );
      } else {
        addPolyline(
          entities,
          transformedEllipsePoints(object, object.radius, object.radius, drawingHeight),
          true,
        );
        approximated.add('Circle');
      }
      return;
    }

    if (object instanceof fabric.Ellipse) {
      addPolyline(
        entities,
        transformedEllipsePoints(object, object.rx, object.ry, drawingHeight),
        true,
      );
      approximated.add('Ellipse');
      return;
    }

    if (object instanceof fabric.FabricText) {
      if (hasNonAsciiText(object.text)) approximated.add('TextEncoding');
      const transform = getTextTransform(object);
      if (transform.approximated) approximated.add('TextTransform');
      addText(entities, object, drawingHeight, transform);
      return;
    }

    unsupported.add(typeName(object));
  };

  objects.forEach(visit);

  const lines = [
    ...pair(0, 'SECTION'),
    ...pair(2, 'HEADER'),
    ...pair(9, '$ACADVER'),
    ...pair(1, 'AC1009'),
    ...pair(9, '$MEASUREMENT'),
    ...pair(70, 1),
    ...pair(9, '$EXTMIN'),
    ...pair(10, 0),
    ...pair(20, 0),
    ...pair(30, 0),
    ...pair(9, '$EXTMAX'),
    ...pair(10, drawingWidth),
    ...pair(20, drawingHeight),
    ...pair(30, 0),
    ...pair(0, 'ENDSEC'),
    ...pair(0, 'SECTION'),
    ...pair(2, 'TABLES'),
    ...pair(0, 'TABLE'),
    ...pair(2, 'LTYPE'),
    ...pair(70, 1),
    ...pair(0, 'LTYPE'),
    ...pair(2, 'CONTINUOUS'),
    ...pair(70, 0),
    ...pair(3, 'Solid line'),
    ...pair(72, 65),
    ...pair(73, 0),
    ...pair(40, 0),
    ...pair(0, 'ENDTAB'),
    ...pair(0, 'TABLE'),
    ...pair(2, 'LAYER'),
    ...pair(70, 1),
    ...pair(0, 'LAYER'),
    ...pair(2, '0'),
    ...pair(70, 0),
    ...pair(62, 7),
    ...pair(6, 'CONTINUOUS'),
    ...pair(0, 'ENDTAB'),
    ...pair(0, 'TABLE'),
    ...pair(2, 'STYLE'),
    ...pair(70, 1),
    ...pair(0, 'STYLE'),
    ...pair(2, 'STANDARD'),
    ...pair(70, 0),
    ...pair(40, 0),
    ...pair(41, 1),
    ...pair(50, 0),
    ...pair(71, 0),
    ...pair(42, 1),
    ...pair(3, 'txt'),
    ...pair(4, ''),
    ...pair(0, 'ENDTAB'),
    ...pair(0, 'ENDSEC'),
    ...pair(0, 'SECTION'),
    ...pair(2, 'BLOCKS'),
    ...pair(0, 'ENDSEC'),
    ...pair(0, 'SECTION'),
    ...pair(2, 'ENTITIES'),
    ...entities,
    ...pair(0, 'ENDSEC'),
    ...pair(0, 'EOF'),
  ];

  return {
    text: `${lines.join('\r\n')}\r\n`,
    unsupportedTypes: [...unsupported].sort(),
    approximatedTypes: [...approximated].sort(),
  };
}
