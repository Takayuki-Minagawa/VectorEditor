import * as fabric from 'fabric';
import { defaultCadLayers, type CadLayer } from '../domain/cadLayer';
import { ACI_COLORS } from '../domain/dxf';
import {
  isClosedFabricPath,
  readSectionProfileInDocumentCoordinates,
  sectionProfileFromFabricObject,
  SectionGeometryError,
} from '../utils/sectionGeometry';
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
  layers: readonly CadLayer[] = defaultCadLayers(),
): DxfExportResult {
  const entities: string[] = [];
  const unsupported = new Set<string>();
  const approximated = new Set<string>();

  const writeObject = (object: fabric.FabricObject): void => {
    if (!object.visible || object.excludeFromExport) return;

    const metadata = getFabricMetadata(object);
    if (metadata.objectKind === 'sectionProfile' && metadata.sectionProfileData) {
      let profile: ReturnType<typeof readSectionProfileInDocumentCoordinates>;
      try {
        profile = readSectionProfileInDocumentCoordinates(object);
      } catch (error: unknown) {
        if (!(error instanceof SectionGeometryError)) throw error;
        unsupported.add('SectionProfile');
        return;
      }
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
      object.getObjects().forEach((child) => visit(child));
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

    if (object instanceof fabric.Path) {
      // Closed (possibly compound) paths — e.g. Boolean operation results —
      // export as one closed POLYLINE per ring, flattened with the shared
      // section tolerance. Open paths stay unsupported.
      if (!isClosedFabricPath(object)) {
        unsupported.add(typeName(object));
        return;
      }
      let profile: ReturnType<typeof sectionProfileFromFabricObject>;
      try {
        profile = sectionProfileFromFabricObject(object);
      } catch (error: unknown) {
        if (!(error instanceof SectionGeometryError)) throw error;
        unsupported.add(typeName(object));
        return;
      }
      profile.rings.forEach((ring) => {
        addPolyline(
          entities,
          ring.points.map((point) => ({
            x: point.x,
            // Ring points use engineering coordinates (+y up); shift them
            // into the bottom-left DXF space like the section profiles.
            y: drawingHeight + point.y,
          })),
          true,
        );
      });
      if (profile.approximate) approximated.add('PathApproximation');
      if (profile.rings.some((ring) => ring.role === 'hole')) {
        // R12 POLYLINE carries no hole topology; the boundary is exported but
        // downstream CAD software may interpret it as material.
        approximated.add('PathHoles');
      }
      return;
    }

    if (object instanceof fabric.Polyline) {
      const points = object.points.map((point) => dxfPoint(
        scenePoint(object, {
          x: point.x - object.pathOffset.x,
          y: point.y - object.pathOffset.y,
        }),
        drawingHeight,
      ));
      addPolyline(entities, points, object instanceof fabric.Polygon);
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

  const names = new Map<string, string>();
  const usedNames = new Set<string>();
  layers.forEach((layer, index) => {
    let name = layer.id === '0' ? '0' : layer.name.replace(/[^a-zA-Z0-9_$-]/g, '_').slice(0, 31);
    if (!name || usedNames.has(name.toUpperCase())) name = `LAYER_${index}`;
    while (usedNames.has(name.toUpperCase())) name += '_';
    if (name !== layer.name) approximated.add('LayerNameEncoding');
    names.set(layer.id, name); usedNames.add(name.toUpperCase());
  });
  const aci = (color: string): number => {
    color = '#' + new fabric.Color(color).toHex().toLowerCase();
    if (color === '#000000' || color === '#ffffff') return 7;
    const exact = ACI_COLORS.findIndex((value, index) => index > 0 && value === color.toLowerCase());
    if (exact > 0) return exact;
    approximated.add('LayerColor');
    if (!/^#[0-9a-f]{6}$/i.test(color)) return 7;
    const rgb = (hex: string) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
    const input = rgb(color);
    let best = 7; let distance = Infinity;
    for (let i = 1; i <= 7; i++) {
      const error = rgb(ACI_COLORS[i]).reduce((sum, component, j) => sum + (component - input[j]) ** 2, 0);
      if (error < distance) { best = i; distance = error; }
    }
    return best;
  };
  const visit = (object: fabric.FabricObject, parentId = '0'): void => {
    const metadata = getFabricMetadata(object);
    const id = metadata.cadLayerId ?? parentId;
    const layer = layers.find((item) => item.id === id) ?? layers[0];
    if (!object.visible || object.excludeFromExport || !layer.visible || !layer.printable) return;
    if (object instanceof fabric.Group && metadata.objectKind !== 'sectionProfile') {
      object.getObjects().forEach((child) => visit(child, id)); return;
    }
    const start = entities.length;
    writeObject(object);
    const written = entities.splice(start);
    for (let i = 0; i < written.length; i += 2) {
      entities.push(written[i], written[i] === '8' ? names.get(layer.id) ?? '0' : written[i + 1]);
      if (written[i] === '0' && ['LINE', 'POLYLINE', 'CIRCLE', 'TEXT'].includes(written[i + 1]) && metadata.cadStyleMode !== 'layer') {
        const color = object instanceof fabric.FabricText ? object.fill : object.stroke;
        const dash = object.strokeDashArray;
        entities.push(...pair(62, typeof color === 'string' ? aci(color) : 7), ...pair(6, dash?.length ? dash[0] <= 1 ? 'DOTTED' : 'DASHED' : 'CONTINUOUS'));
        if (dash?.length && JSON.stringify(dash) !== JSON.stringify(dash[0] <= 1 ? [1, 3] : [8, 4])) approximated.add('LinePattern');
      }
    }
    if (object.strokeWidth !== 1 && !(object instanceof fabric.FabricText)) approximated.add('LineWeight');
  };
  objects.forEach((object) => visit(object));
  const layerTable = layers.flatMap((layer) => [
    ...pair(0, 'LAYER'), ...pair(2, names.get(layer.id)!), ...pair(70, layer.locked ? 4 : 0),
    ...pair(62, aci(layer.color) * (layer.visible ? 1 : -1)), ...pair(6, layer.lineType.toUpperCase()),
  ]);

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
    ...pair(70, 3),
    ...pair(0, 'LTYPE'),
    ...pair(2, 'CONTINUOUS'),
    ...pair(70, 0),
    ...pair(3, 'Solid line'),
    ...pair(72, 65),
    ...pair(73, 0),
    ...pair(40, 0),
    ...['DASHED', 'DOTTED'].flatMap((name) => [
      ...pair(0, 'LTYPE'), ...pair(2, name), ...pair(70, 0), ...pair(3, name), ...pair(72, 65),
      ...pair(73, 2), ...pair(40, name === 'DASHED' ? 12 : 4), ...pair(49, name === 'DASHED' ? 8 : 1), ...pair(49, name === 'DASHED' ? -4 : -3),
    ]),
    ...pair(0, 'ENDTAB'),
    ...pair(0, 'TABLE'),
    ...pair(2, 'LAYER'),
    ...pair(70, layers.length),
    ...layerTable,
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
