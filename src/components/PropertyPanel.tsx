import { useEffect, useState, useCallback } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import { CANVAS_PRESETS, mmToUnit, unitToMm, formatReal } from '../types';
import type { TranslationKeys } from '../i18n/ja';
import { ColorField, NumberField, PropertyField } from './PropertyField';

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

  const readProps = useCallback(() => {
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (!obj) { setProps(defaultProps); return; }
    const bound = obj.getBoundingRect();
    setIsText(obj instanceof fabric.Textbox || obj instanceof fabric.IText);
    setIsRect(obj instanceof fabric.Rect);
    setProps({
      left: Math.round(obj.left || 0), top: Math.round(obj.top || 0),
      width: Math.round(bound.width), height: Math.round(bound.height),
      angle: Math.round(obj.angle || 0),
      fill: (typeof obj.fill === 'string' ? obj.fill : '') || '',
      stroke: (typeof obj.stroke === 'string' ? obj.stroke : '') || '',
      strokeWidth: obj.strokeWidth || 0, opacity: obj.opacity ?? 1,
      fontFamily: (obj as fabric.Textbox).fontFamily || 'sans-serif',
      fontSize: (obj as fabric.Textbox).fontSize || 24,
      fontWeight: String((obj as fabric.Textbox).fontWeight || 'normal'),
      fontStyle: (obj as fabric.Textbox).fontStyle || 'normal',
      underline: (obj as fabric.Textbox).underline || false,
      textAlign: (obj as fabric.Textbox).textAlign || 'left',
      lineHeight: (obj as fabric.Textbox).lineHeight || 1.2,
      strokeDashArray: obj.strokeDashArray ? obj.strokeDashArray.join(',') : '',
      rx: (obj as fabric.Rect).rx || 0, ry: (obj as fabric.Rect).ry || 0,
    });
  }, [canvas]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- readProps reads external canvas state
  useEffect(() => { readProps(); }, [selectedObjectIds, readProps]);

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

  const updateProp = (key: ObjPropKey, value: unknown) => {
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (!obj) return;
    if (key === 'width') { obj.set({ scaleX: (value as number) / (obj.width || 1) }); }
    else if (key === 'height') { obj.set({ scaleY: (value as number) / (obj.height || 1) }); }
    else if (key === 'strokeDashArray') {
      const str = value as string;
      obj.set({ strokeDashArray: str.trim() === '' ? undefined : str.split(',').map(Number) });
    } else { obj.set({ [key]: value } as Partial<fabric.FabricObject>); }
    obj.setCoords(); canvas.requestRenderAll(); readProps();
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
              <label>{t('presetSize')}</label>
              <select
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
            <ColorField label={t('fill')} value={props.fill || '#ffffff'} onChange={(value) => updateProp('fill', value)} onBlur={commitChange} />
            <ColorField label={t('strokeColor')} value={props.stroke || '#000000'} onChange={(value) => updateProp('stroke', value)} onBlur={commitChange} />
            <NumberField label={t('strokeWidth')} value={props.strokeWidth} onChange={(value) => updateProp('strokeWidth', value)} onBlur={commitChange} min={0} max={50} />
            <PropertyField label={t('dash')}>
              <input type="text" value={props.strokeDashArray} onChange={(e) => updateProp('strokeDashArray', e.target.value)} onBlur={commitChange} placeholder={t('dashPlaceholder')} />
            </PropertyField>
            <PropertyField label={t('opacity')}>
              <input type="range" min={0} max={1} step={0.05} value={props.opacity} onChange={(e) => updateProp('opacity', Number(e.target.value))} onMouseUp={commitChange} />
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
                <label>{t('font')}</label>
                <select value={props.fontFamily} onChange={(e) => updateProp('fontFamily', e.target.value)} onBlur={commitChange}>
                  <option value="sans-serif">Sans Serif</option>
                  <option value="serif">Serif</option>
                  <option value="monospace">Monospace</option>
                  <option value="'Noto Sans JP', sans-serif">Noto Sans JP</option>
                </select>
              </div>
              <div className="prop-row"><label>{t('fontSize')}</label><input type="number" value={props.fontSize} onChange={(e) => updateProp('fontSize', Number(e.target.value))} onBlur={commitChange} min={8} max={200} /></div>
              <div className="prop-row prop-row-buttons">
                <button className={`prop-toggle ${props.fontWeight === 'bold' || props.fontWeight === '700' ? 'active' : ''}`} onClick={() => { updateProp('fontWeight', props.fontWeight === 'bold' || props.fontWeight === '700' ? 'normal' : 'bold'); commitChange(); }} title={t('bold')}>{t('bold')}</button>
                <button className={`prop-toggle ${props.fontStyle === 'italic' ? 'active' : ''}`} onClick={() => { updateProp('fontStyle', props.fontStyle === 'italic' ? 'normal' : 'italic'); commitChange(); }} title={t('italic')}>{t('italic')}</button>
                <button className={`prop-toggle ${props.underline ? 'active' : ''}`} onClick={() => { updateProp('underline', !props.underline); commitChange(); }} title={t('underline')}>{t('underline')}</button>
              </div>
              <div className="prop-row">
                <label>{t('textAlign')}</label>
                <select value={props.textAlign} onChange={(e) => { updateProp('textAlign', e.target.value); commitChange(); }}>
                  <option value="left">{t('textAlignLeft')}</option>
                  <option value="center">{t('textAlignCenter')}</option>
                  <option value="right">{t('textAlignRight')}</option>
                </select>
              </div>
              <div className="prop-row"><label>{t('textColor')}</label><input type="color" value={props.fill || '#333333'} onChange={(e) => updateProp('fill', e.target.value)} onBlur={commitChange} /></div>
              <div className="prop-row"><label>{t('lineHeight')}</label><input type="number" value={props.lineHeight} onChange={(e) => updateProp('lineHeight', Number(e.target.value))} onBlur={commitChange} min={0.5} max={3} step={0.1} /></div>
            </div>
          )}
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
