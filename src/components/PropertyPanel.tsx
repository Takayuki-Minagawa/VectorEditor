import { useEffect, useId, useState, useCallback } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import { CANVAS_PRESETS, mmToUnit, unitToMm, formatReal } from '../types';
import type { TranslationKeys } from '../i18n/ja';
import { ColorField, NumberField, PropertyField, TextField } from './PropertyField';
import {
  applyEditorStyle,
  BUILTIN_STYLE_PRESETS,
  captureEditorStyle,
  loadCurrentEditorStyle,
  saveCurrentEditorStyle,
  styleKindForObject,
} from '../utils/stylePresets';
import { updateLinkedSemanticObjects } from '../utils/semanticObjects';
import { getFabricMetadata } from '../utils/fabricObjectMetadata';
import SectionPropertiesPanel from './SectionPropertiesPanel';

interface ObjProps {
  left: number; top: number; width: number; height: number; angle: number;
  fill: string; stroke: string; strokeWidth: number; opacity: number;
  fontFamily: string; fontSize: number; fontWeight: string; fontStyle: string;
  underline: boolean; textAlign: string; lineHeight: number;
  strokeDashArray: string; rx: number; ry: number;
}

type ObjPropKey = keyof ObjProps;

const defaultProps: ObjProps = {
  left: 0, top: 0, width: 0, height: 0, angle: 0,
  fill: '#D9EAF7', stroke: '#1F4E79', strokeWidth: 2, opacity: 1,
  fontFamily: 'sans-serif', fontSize: 24, fontWeight: 'normal', fontStyle: 'normal',
  underline: false, textAlign: 'left', lineHeight: 1.2, strokeDashArray: '', rx: 0, ry: 0,
};

export default function PropertyPanel() {
  const canvas = useEditorStore((s) => s.canvas);
  const selectedObjectIds = useEditorStore((s) => s.selectedObjectIds);
  // History revision: node edits (insert/delete) change an object's geometry
  // without firing object:modified or changing the selection, so the panel
  // re-reads whenever a history entry is pushed or undone.
  const revision = useEditorStore((s) => s.revision);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const setCanvasSize = useEditorStore((s) => s.setCanvasSize);
  const backgroundColor = useEditorStore((s) => s.backgroundColor);
  const setBackgroundColor = useEditorStore((s) => s.setBackgroundColor);
  const drawingMode = useEditorStore((s) => s.drawingMode);
  const cadUnit = useEditorStore((s) => s.cadUnit);
  const cadWidth = useEditorStore((s) => s.cadWidth);
  const cadHeight = useEditorStore((s) => s.cadHeight);
  const setCadSize = useEditorStore((s) => s.setCadSize);
  const t = useI18n((s) => s.t);
  const isCad = drawingMode === 'cad';

  const [props, setProps] = useState<ObjProps>(defaultProps);
  const [isText, setIsText] = useState(false);
  const [isRect, setIsRect] = useState(false);
  const [selectedObject, setSelectedObject] = useState<fabric.FabricObject | null>(null);
  const presetId = useId();
  const opacityId = useId();
  const fontId = useId();
  const textAlignId = useId();

  const readProps = useCallback(() => {
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (!obj) { setProps(defaultProps); setSelectedObject(null); return; }
    setSelectedObject(obj);
    const displayWidth = obj.getScaledWidth();
    const displayHeight = obj.getScaledHeight();
    const appearance = captureEditorStyle(obj);
    setIsText(obj instanceof fabric.Textbox || obj instanceof fabric.IText);
    setIsRect(obj instanceof fabric.Rect);
    setProps({
      left: Math.round(obj.left || 0), top: Math.round(obj.top || 0),
      width: Math.round(displayWidth), height: Math.round(displayHeight),
      angle: Math.round(obj.angle || 0),
      fill: appearance.fill,
      stroke: appearance.stroke,
      strokeWidth: appearance.strokeWidth,
      opacity: appearance.opacity,
      fontFamily: (obj as fabric.Textbox).fontFamily || 'sans-serif',
      fontSize: (obj as fabric.Textbox).fontSize || 24,
      fontWeight: String((obj as fabric.Textbox).fontWeight || 'normal'),
      fontStyle: (obj as fabric.Textbox).fontStyle || 'normal',
      underline: (obj as fabric.Textbox).underline || false,
      textAlign: (obj as fabric.Textbox).textAlign || 'left',
      lineHeight: (obj as fabric.Textbox).lineHeight || 1.2,
      strokeDashArray: appearance.strokeDashArray?.join(',') ?? '',
      rx: (obj as fabric.Rect).rx || 0, ry: (obj as fabric.Rect).ry || 0,
    });
  }, [canvas]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- readProps reads external canvas state
  useEffect(() => { readProps(); }, [selectedObjectIds, revision, readProps]);

  useEffect(() => {
    if (!canvas) return;
    const handler = () => readProps();
    canvas.on('object:modified', handler);
    canvas.on('object:scaling', handler);
    canvas.on('object:moving', handler);
    canvas.on('object:rotating', handler);
    return () => {
      canvas.off('object:modified', handler);
      canvas.off('object:scaling', handler);
      canvas.off('object:moving', handler);
      canvas.off('object:rotating', handler);
    };
  }, [canvas, readProps]);

  const updateProp = <K extends ObjPropKey>(key: K, value: ObjProps[K]) => {
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (!obj) return;
    if (key === 'width') {
      const currentWidth = obj.getScaledWidth() || 1;
      obj.set({ scaleX: (obj.scaleX || 1) * (value as number) / currentWidth });
    }
    else if (key === 'height') {
      const currentHeight = obj.getScaledHeight() || 1;
      obj.set({ scaleY: (obj.scaleY || 1) * (value as number) / currentHeight });
    }
    else if (key === 'strokeDashArray') {
      const str = value as string;
      const dash = str.split(',').map((part) => Number(part.trim()));
      if (str.trim() !== '' && dash.some((part) => !Number.isFinite(part) || part < 0)) return;
      const targets = obj instanceof fabric.ActiveSelection ? obj.getObjects() : [obj];
      targets.forEach((target) => applyEditorStyle(target, {
        ...captureEditorStyle(target),
        strokeDashArray: str.trim() === '' ? undefined : dash,
      }));
    } else if (key === 'fill' || key === 'stroke' || key === 'strokeWidth' || key === 'opacity') {
      const targets = obj instanceof fabric.ActiveSelection ? obj.getObjects() : [obj];
      targets.forEach((target) => {
        const style = captureEditorStyle(target);
        if (key === 'fill') style.fill = value as string;
        if (key === 'stroke') style.stroke = value as string;
        if (key === 'strokeWidth') style.strokeWidth = value as number;
        if (key === 'opacity') style.opacity = value as number;
        applyEditorStyle(target, style);
      });
    } else {
      obj.set({ [key]: value } as Partial<fabric.FabricObject>);
    }
    obj.setCoords();
    updateLinkedSemanticObjects(canvas);
    canvas.requestRenderAll();
    readProps();
  };

  const applyStyle = (style?: ReturnType<typeof loadCurrentEditorStyle>) => {
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active) return;
    const targets = active instanceof fabric.ActiveSelection ? active.getObjects() : [active];
    targets.forEach((target) => {
      applyEditorStyle(target, style ?? loadCurrentEditorStyle(styleKindForObject(target)));
      target.setCoords();
    });
    canvas.requestRenderAll();
    readProps();
    pushHistory();
  };

  const rememberStyle = () => {
    const active = canvas?.getActiveObject();
    if (!active) return;
    const source = active instanceof fabric.ActiveSelection ? active.getObjects()[0] : active;
    if (!source) return;
    saveCurrentEditorStyle(captureEditorStyle(source), styleKindForObject(source));
    useEditorStore.getState().showToast(t('styleSaved'), 'success');
  };

  const commitChange = () => pushHistory();
  const hasSelection = selectedObjectIds.length > 0;

  return (
    <div className="property-panel">
      <div className="prop-section">
        <div className="prop-section-title">{isCad ? t('cadDocSize') : t('canvas')}</div>
        {isCad ? (
          <>
            <NumberField label={t('cadDocWidth')} value={cadWidth} onChange={(value) => setCadSize(value, cadHeight)} min={100} step={100} />
            <NumberField label={t('cadDocHeight')} value={cadHeight} onChange={(value) => setCadSize(cadWidth, value)} min={100} step={100} />
            <ColorField label={t('bgColor')} value={backgroundColor} onChange={setBackgroundColor} />
          </>
        ) : (
          <>
            <div className="prop-row">
              <label htmlFor={presetId}>{t('presetSize')}</label>
              <select
                id={presetId}
                className="preset-select"
                value={
                  CANVAS_PRESETS.find((p) => p.width === canvasWidth && p.height === canvasHeight)?.labelKey
                  || 'preset_custom'
                }
                onChange={(e) => {
                  const preset = CANVAS_PRESETS.find((p) => p.labelKey === e.target.value);
                  if (preset && preset.width > 0) setCanvasSize(preset.width, preset.height);
                }}
              >
                {(['doc', 'slide', 'web', 'common', 'custom'] as const).map((cat) => {
                  const catKey = `preset_cat_${cat}` as TranslationKeys;
                  const items = CANVAS_PRESETS.filter((p) => p.category === cat);
                  return (
                    <optgroup key={cat} label={t(catKey)}>
                      {items.map((p) => (
                        <option key={p.labelKey} value={p.labelKey}>
                          {t(p.labelKey as TranslationKeys)}{p.width > 0 ? ` (${p.width}x${p.height})` : ''}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            </div>
            <NumberField label={t('width')} value={canvasWidth} onChange={(value) => setCanvasSize(value, canvasHeight)} min={100} />
            <NumberField label={t('height')} value={canvasHeight} onChange={(value) => setCanvasSize(canvasWidth, value)} min={100} />
            <ColorField label={t('bgColor')} value={backgroundColor} onChange={setBackgroundColor} />
          </>
        )}
      </div>

      {hasSelection && (
        <>
          <div className="prop-section">
            <div className="prop-section-title">{t('positionSize')}{isCad ? ` (${cadUnit})` : ''}</div>
            {isCad ? (
              <>
                <NumberField label={t('x')} value={Number(formatReal(mmToUnit(props.left, cadUnit), cadUnit))} onChange={(value) => updateProp('left', unitToMm(value, cadUnit))} onBlur={commitChange} step={cadUnit === 'mm' ? 1 : cadUnit === 'cm' ? 0.1 : 0.001} />
                <NumberField label={t('y')} value={Number(formatReal(mmToUnit(props.top, cadUnit), cadUnit))} onChange={(value) => updateProp('top', unitToMm(value, cadUnit))} onBlur={commitChange} step={cadUnit === 'mm' ? 1 : cadUnit === 'cm' ? 0.1 : 0.001} />
                <NumberField label={t('width')} value={Number(formatReal(mmToUnit(props.width, cadUnit), cadUnit))} onChange={(value) => updateProp('width', unitToMm(value, cadUnit))} onBlur={commitChange} min={0} step={cadUnit === 'mm' ? 1 : cadUnit === 'cm' ? 0.1 : 0.001} />
                <NumberField label={t('height')} value={Number(formatReal(mmToUnit(props.height, cadUnit), cadUnit))} onChange={(value) => updateProp('height', unitToMm(value, cadUnit))} onBlur={commitChange} min={0} step={cadUnit === 'mm' ? 1 : cadUnit === 'cm' ? 0.1 : 0.001} />
                <NumberField label={t('rotation')} value={props.angle} onChange={(value) => updateProp('angle', value)} onBlur={commitChange} />
              </>
            ) : (
              <>
                <NumberField label={t('x')} value={props.left} onChange={(value) => updateProp('left', value)} onBlur={commitChange} />
                <NumberField label={t('y')} value={props.top} onChange={(value) => updateProp('top', value)} onBlur={commitChange} />
                <NumberField label={t('width')} value={props.width} onChange={(value) => updateProp('width', value)} onBlur={commitChange} min={1} />
                <NumberField label={t('height')} value={props.height} onChange={(value) => updateProp('height', value)} onBlur={commitChange} min={1} />
                <NumberField label={t('rotation')} value={props.angle} onChange={(value) => updateProp('angle', value)} onBlur={commitChange} />
              </>
            )}
          </div>

          <div className="prop-section">
            <div className="prop-section-title">{t('appearance')}</div>
            <div className="style-preset-row" aria-label={t('stylePresets')}>
              {BUILTIN_STYLE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  className="style-swatch"
                  style={{ background: preset.style.fill, borderColor: preset.style.stroke }}
                  onClick={() => applyStyle(preset.style)}
                  aria-label={`${t('stylePresets')}: ${preset.id}`}
                  title={`${t('stylePresets')}: ${preset.id}`}
                />
              ))}
              <button className="toolbar-btn style-action" onClick={rememberStyle}>{t('rememberStyle')}</button>
              <button className="toolbar-btn style-action" onClick={() => applyStyle()}>{t('applyStyle')}</button>
            </div>
            <ColorField label={t('fill')} value={props.fill || '#ffffff'} onChange={(value) => updateProp('fill', value)} onBlur={commitChange} />
            <ColorField label={t('strokeColor')} value={props.stroke || '#000000'} onChange={(value) => updateProp('stroke', value)} onBlur={commitChange} />
            <NumberField label={t('strokeWidth')} value={props.strokeWidth} onChange={(value) => updateProp('strokeWidth', value)} onBlur={commitChange} min={0} max={50} />
            <TextField
              key={props.strokeDashArray}
              label={t('dash')}
              value={props.strokeDashArray}
              onCommit={(value) => { updateProp('strokeDashArray', value); commitChange(); }}
              placeholder={t('dashPlaceholder')}
              validate={(value) => value.trim() === '' || value.split(',').every((part) => {
                const number = Number(part.trim());
                return part.trim() !== '' && Number.isFinite(number) && number >= 0;
              })}
            />
            <PropertyField label={t('opacity')} labelFor={opacityId}>
              <input id={opacityId} type="range" min={0} max={1} step={0.05} value={props.opacity} onChange={(e) => updateProp('opacity', Number(e.target.value))} onPointerUp={commitChange} onKeyUp={commitChange} />
              <span className="prop-value">{Math.round(props.opacity * 100)}%</span>
            </PropertyField>
            {isRect && (
              <NumberField label={t('cornerRadius')} value={props.rx} onChange={(value) => { updateProp('rx', value); updateProp('ry', value); }} onBlur={commitChange} min={0} />
            )}
          </div>

          {isText && (
            <div className="prop-section">
              <div className="prop-section-title">{t('text')}</div>
              <div className="prop-row">
                <label htmlFor={fontId}>{t('font')}</label>
                <select id={fontId} value={props.fontFamily} onChange={(e) => updateProp('fontFamily', e.target.value)} onBlur={commitChange}>
                  <option value="sans-serif">Sans Serif</option>
                  <option value="serif">Serif</option>
                  <option value="monospace">Monospace</option>
                  <option value="'Noto Sans JP', sans-serif">Noto Sans JP</option>
                </select>
              </div>
              <NumberField label={t('fontSize')} value={props.fontSize} onChange={(value) => updateProp('fontSize', value)} onBlur={commitChange} min={8} max={200} />
              <div className="prop-row prop-row-buttons">
                <button className={`prop-toggle ${props.fontWeight === 'bold' || props.fontWeight === '700' ? 'active' : ''}`} onClick={() => { updateProp('fontWeight', props.fontWeight === 'bold' || props.fontWeight === '700' ? 'normal' : 'bold'); commitChange(); }} title={t('bold')} aria-pressed={props.fontWeight === 'bold' || props.fontWeight === '700'}>{t('bold')}</button>
                <button className={`prop-toggle ${props.fontStyle === 'italic' ? 'active' : ''}`} onClick={() => { updateProp('fontStyle', props.fontStyle === 'italic' ? 'normal' : 'italic'); commitChange(); }} title={t('italic')} aria-pressed={props.fontStyle === 'italic'}>{t('italic')}</button>
                <button className={`prop-toggle ${props.underline ? 'active' : ''}`} onClick={() => { updateProp('underline', !props.underline); commitChange(); }} title={t('underline')} aria-pressed={props.underline}>{t('underline')}</button>
              </div>
              <div className="prop-row">
                <label htmlFor={textAlignId}>{t('textAlign')}</label>
                <select id={textAlignId} value={props.textAlign} onChange={(e) => { updateProp('textAlign', e.target.value); commitChange(); }}>
                  <option value="left">{t('textAlignLeft')}</option>
                  <option value="center">{t('textAlignCenter')}</option>
                  <option value="right">{t('textAlignRight')}</option>
                </select>
              </div>
              <ColorField label={t('textColor')} value={props.fill || '#333333'} onChange={(value) => updateProp('fill', value)} onBlur={commitChange} />
              <NumberField label={t('lineHeight')} value={props.lineHeight} onChange={(value) => updateProp('lineHeight', value)} onBlur={commitChange} min={0.5} max={3} step={0.1} />
            </div>
          )}
          {canvas && selectedObject
            && getFabricMetadata(selectedObject).objectKind === 'sectionProfile'
            && <SectionPropertiesPanel canvas={canvas} object={selectedObject} />}
        </>
      )}

      {!hasSelection && (
        <div className="prop-placeholder">
          {t('propPlaceholder').split('\n').map((line, i) => (
            <span key={i}>{line}{i === 0 && <br />}</span>
          ))}
        </div>
      )}
    </div>
  );
}
