import { useEffect, useState } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import type { CadUnit } from '../types';
import { findCadSnap } from '../utils/cadSnapping';
import { createAsyncCanvasMutationGuard } from '../utils/canvasCommands';
import { calibrateSelection, calibrationFactor } from '../utils/calibration';
import { measureClosedShape, measurementValue, pointAngle, pointDistance, type DrawingPoint, type ShapeMeasurement } from '../utils/geometryMeasurements';
import Dialog from './Dialog';

export const MEASURE_SHAPE_EVENT = 'vectoreditor:measure-shape';
type Result = { kind: 'distance' | 'angle'; value: number; cad: boolean } | { kind: 'shape'; value: ShapeMeasurement; cad: boolean };
interface Calibration { objects: fabric.FabricObject[]; a: DrawingPoint; b: DrawingPoint; canCommit: () => boolean }
export default function GeometryTools() {
  const canvas = useEditorStore((s) => s.canvas);
  const tool = useEditorStore((s) => s.activeTool);
  const drawingMode = useEditorStore((s) => s.drawingMode);
  const selected = useEditorStore((s) => s.selectedObjectIds.length);
  const setTool = useEditorStore((s) => s.setActiveTool);
  const cadUnit = useEditorStore((s) => s.cadUnit);
  const t = useI18n((s) => s.t);
  const [result, setResult] = useState<Result | null>(null);
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [length, setLength] = useState('1000');
  const [unit, setUnit] = useState<CadUnit>('mm');
  const [count, setCount] = useState(0);
  const picking = tool === 'calibrate' || tool === 'distanceMeasure' || tool === 'angleMeasure';

  useEffect(() => {
    const measure = () => {
      const target = canvas?.getActiveObject();
      if (!target) return;
      try { setUnit(cadUnit); setResult({ kind: 'shape', value: measureClosedShape(target), cad: drawingMode === 'cad' }); }
      catch { useEditorStore.getState().showToast(t('measurementShapeError'), 'error'); }
    };
    window.addEventListener(MEASURE_SHAPE_EVENT, measure);
    return () => window.removeEventListener(MEASURE_SHAPE_EVENT, measure);
  }, [canvas, drawingMode, cadUnit, t]);

  useEffect(() => {
    if (!canvas || !picking) return;
    const target = canvas.getActiveObject();
    if (tool === 'calibrate' && (drawingMode !== 'cad' || !target)) {
      useEditorStore.getState().showToast(t('calibrationSelect'), 'info');
      setTool('select'); return;
    }
    const objects = [...canvas.getActiveObjects()];
    if (tool === 'calibrate') canvas.discardActiveObject();
    const canCommit = createAsyncCanvasMutationGuard(canvas);
    let points: DrawingPoint[] = [];
    let hover: DrawingPoint | null = null;
    let space = false;
    let completed = false;
    setCount(0); setCalibration(null); setUnit(cadUnit);
    const resolve = (e: fabric.TPointerEvent): DrawingPoint => {
      const raw = canvas.getScenePoint(e);
      if (drawingMode === 'cad') {
        const candidate = findCadSnap(canvas.getObjects(), raw, 10 / canvas.getZoom());
        if (candidate) return candidate.point;
      }
      const state = useEditorStore.getState();
      return state.snapToGrid ? { x: Math.round(raw.x / state.gridSize) * state.gridSize, y: Math.round(raw.y / state.gridSize) * state.gridSize } : raw;
    };
    const down = (event: fabric.TPointerEventInfo) => {
      if (completed || space || (event.e as MouseEvent).button !== 0 || document.querySelector('[role="dialog"]')) return;
      if (!canCommit()) { setTool('select'); return; }
      points.push(resolve(event.e)); setCount(points.length);
      const needed = tool === 'angleMeasure' ? 3 : 2;
      if (points.length < needed) { canvas.requestRenderAll(); return; }
      try {
        if (tool === 'calibrate' && target) {
          pointDistance(points[0], points[1]);
          setCalibration({ objects, a: points[0], b: points[1], canCommit }); completed = true;
        } else {
          const value = tool === 'angleMeasure' ? pointAngle(points[0], points[1], points[2]) : pointDistance(points[0], points[1]);
          setResult({ kind: tool === 'angleMeasure' ? 'angle' : 'distance', value, cad: drawingMode === 'cad' });
          setTool('select');
        }
      } catch {
        points = []; setCount(0);
        useEditorStore.getState().showToast(t('measurementPointError'), 'error');
      }
      canvas.requestRenderAll();
    };
    const move = (event: fabric.TPointerEventInfo) => {
      if (!completed && !space) { hover = resolve(event.e); canvas.requestRenderAll(); }
    };
    const render = ({ ctx }: { ctx: CanvasRenderingContext2D }) => {
      if (!points.length) return;
      const vpt = canvas.viewportTransform;
      const screen = (p: DrawingPoint) => ({ x: vpt[0] * p.x + vpt[2] * p.y + vpt[4], y: vpt[1] * p.x + vpt[3] * p.y + vpt[5] });
      ctx.save(); ctx.strokeStyle = '#f59e0b'; ctx.fillStyle = '#f59e0b'; ctx.lineWidth = 2;
      ctx.beginPath();
      [...points, ...(hover && !completed ? [hover] : [])].map(screen).forEach((p, i) => { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
      ctx.stroke();
      points.map(screen).forEach((p, i) => { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.fillText(String(i + 1), p.x + 8, p.y - 8); });
      ctx.restore();
    };
    const keydown = (e: KeyboardEvent) => {
      if (e.code === 'Space') space = true;
      if (e.key === 'Escape') { setCalibration(null); setTool('select'); }
    };
    const keyup = (e: KeyboardEvent) => { if (e.code === 'Space') space = false; };
    const blur = () => { space = false; };
    const dispose = [canvas.on('mouse:down', down), canvas.on('mouse:move', move), canvas.on('after:render', render)];
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', blur);
    return () => {
      dispose.forEach((fn) => fn()); canvas.requestRenderAll();
      window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur);
    };
  }, [canvas, picking, tool, drawingMode, cadUnit, setTool, t]);

  const closeCalibration = () => { setCalibration(null); setTool('select'); };
  let factor: number | null = null;
  if (calibration) { try { factor = calibrationFactor(calibration.a, calibration.b, Number(length), unit); } catch { /* invalid input */ } }
  const apply = () => {
    if (!calibration || !canvas) return;
    try {
      if (!calibration.canCommit() || calibration.objects.some((o) => !canvas.getObjects().includes(o))) throw new Error('Document changed');
      const target = calibration.objects.length === 1 ? calibration.objects[0] : new fabric.ActiveSelection(calibration.objects, { canvas });
      canvas.setActiveObject(target);
      calibrateSelection(canvas, target, calibration.a, calibration.b, Number(length), unit, useEditorStore.getState().pushHistory);
      closeCalibration(); useEditorStore.getState().showToast(t('calibrationDone'), 'success');
    } catch { useEditorStore.getState().showToast(t('calibrationError'), 'error'); }
  };
  const displayUnit = result?.cad ? unit : 'px';
  const lines: string[] = !result ? [] : result.kind === 'shape' ? [
    `${t('measurementArea')}: ${measurementValue(result.value.area, displayUnit, 2)}`,
    `${t('measurementOuter')}: ${measurementValue(result.value.outerPerimeter, displayUnit)}`,
    `${t('measurementHoles')}: ${measurementValue(result.value.holePerimeter, displayUnit)}`,
    ...(result.value.approximate ? [`${t('measurementApproximate')}: ${measurementValue(result.value.tolerance, displayUnit)}`] : []),
  ] : [`${t(result.kind === 'angle' ? 'measurementAngle' : 'measurementDistance')}: ${result.kind === 'angle' ? `${Number(result.value.toPrecision(8))}°` : measurementValue(result.value, displayUnit)}`];
  return <>
    <button className="toolbar-btn" disabled={!selected} onClick={() => window.dispatchEvent(new Event(MEASURE_SHAPE_EVENT))}>{t('measureShape')}</button>
    {picking && !calibration && <div className="geometry-instructions" role="status">
      <span>{t(tool === 'angleMeasure' ? 'anglePickHelp' : tool === 'calibrate' ? 'calibrationPickHelp' : 'distancePickHelp')} ({count}/{tool === 'angleMeasure' ? 3 : 2})</span>
      <button className="toolbar-btn" onClick={() => setTool('select')}>{t('cancel')}</button>
    </div>}
    {calibration && tool === 'calibrate' && <Dialog title={t('tool_calibrate')} onClose={closeCalibration} closeLabel={t('cancel')}>
      <div className="modal-body">
        <p>{t('calibrationHelp')}</p>
        <div className="nm-row"><label htmlFor="calibration-length">{t('calibrationLength')}</label><input id="calibration-length" type="number" min="0" step="any" value={length} onChange={(e) => setLength(e.target.value)} data-autofocus /></div>
        <div className="nm-row"><label htmlFor="calibration-unit">{t('measurementUnit')}</label><select id="calibration-unit" value={unit} onChange={(e) => setUnit(e.target.value as CadUnit)}><option>mm</option><option>cm</option><option>m</option></select></div>
        <p>{t('calibrationMultiplier')}: {factor === null ? '—' : `${Number(factor.toPrecision(8))}×`}</p>
        <div className="feature-actions"><button className="toolbar-btn" disabled={factor === null} onClick={apply}>{t('calibrationApply')}</button><button className="toolbar-btn" onClick={closeCalibration}>{t('cancel')}</button></div>
      </div>
    </Dialog>}
    {result && <Dialog title={t('measurementTitle')} onClose={() => setResult(null)} closeLabel={t('close')}>
      <div className="modal-body">
        {result.cad && result.kind !== 'angle' && <div className="nm-row"><label htmlFor="measurement-unit">{t('measurementUnit')}</label><select id="measurement-unit" value={unit} onChange={(e) => setUnit(e.target.value as CadUnit)}><option>mm</option><option>cm</option><option>m</option></select></div>}
        {lines.map((line) => <p key={line}>{line}</p>)}
        <button className="toolbar-btn" onClick={() => void navigator.clipboard.writeText(lines.join('\n')).then(() => useEditorStore.getState().showToast(t('exportCopied'), 'success')).catch(() => useEditorStore.getState().showToast(t('clipboardError'), 'error'))}>{t('copyToClipboard')}</button>
      </div>
    </Dialog>}
  </>;
}
