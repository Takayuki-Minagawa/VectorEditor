import * as fabric from 'fabric';
import { unitToMm, type CadUnit } from '../types';
import { collectFabricObjectTree } from './fabricObjectTree';
import { getFabricMetadata, setFabricMetadataValues, type SemanticAnchor } from './fabricObjectMetadata';
import { executeCanvasTransaction, type PushHistory } from './canvasCommands';
import { ensureObjectId } from './objectIds';
import { pointDistance, type DrawingPoint } from './geometryMeasurements';

export function calibrationFactor(a: DrawingPoint, b: DrawingPoint, length: number, unit: CadUnit): number {
  const factor = unitToMm(length, unit) / pointDistance(a, b);
  if (!Number.isFinite(factor) || factor < 1e-6 || factor > 1e6) throw new Error('Invalid calibration scale');
  return factor;
}
export function calibrateSelection(canvas: fabric.Canvas, target: fabric.FabricObject, a: DrawingPoint, b: DrawingPoint, length: number, unit: CadUnit, pushHistory: PushHistory): void {
  const factor = calibrationFactor(a, b, length, unit);
  if (canvas.getActiveObject() !== target) throw new Error('Selection changed');
  const tree = collectFabricObjectTree([target]);
  if (tree.some((o) => getFabricMetadata(o).locked && !getFabricMetadata(o).dimensionData && !getFabricMetadata(o).connectorData)) throw new Error('Selection contains locked geometry');
  const transform = (point: DrawingPoint): DrawingPoint => ({ x: a.x + factor * (point.x - a.x), y: a.y + factor * (point.y - a.y) });
  const center = transform(target.getCenterPoint());
  const bounds = target.getBoundingRect();
  const values = [center.x, center.y, factor * bounds.width, factor * bounds.height, factor * target.scaleX, factor * target.scaleY];
  if (values.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e9)) throw new Error('Calibration exceeds drawing limits');
  const anchors = tree.map((object) => {
    const metadata = getFabricMetadata(object);
    const anchor = (value: SemanticAnchor): SemanticAnchor => ({ ...value, ...transform(value) });
    return { object, values: {
      ...(metadata.dimensionData ? { dimensionData: { ...metadata.dimensionData, start: anchor(metadata.dimensionData.start), end: anchor(metadata.dimensionData.end) } } : {}),
      ...(metadata.connectorData ? { connectorData: { ...metadata.connectorData, from: anchor(metadata.connectorData.from), to: anchor(metadata.connectorData.to) } } : {}),
    } };
  });
  executeCanvasTransaction({ canvas, pushHistory }, () => {
    target.set({ scaleX: target.scaleX * factor, scaleY: target.scaleY * factor });
    target.setPositionByOrigin(new fabric.Point(center.x, center.y), 'center', 'center');
    target.setCoords();
    anchors.forEach(({ object, values }) => setFabricMetadataValues(object, values));
    // Materialize ActiveSelection transforms before linked dimensions are rebuilt.
    canvas.discardActiveObject();
    tree.forEach((object) => object.setCoords());
  }, { semanticUpdate: () => tree.map((object) => ensureObjectId(object)) });
}
