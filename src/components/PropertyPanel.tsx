import { useEffect, useState, useCallback } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import { CANVAS_PRESETS } from '../types';
import type { TranslationKeys } from '../i18n/ja';

interface ObjProps {
  left: number; top: number; width: number; height: number; angle: number;
  fill: string; stroke: string; strokeWidth: number; opacity: number;
  fontFamily: string; fontSize: number; fontWeight: string; fontStyle: string;
  underline: boolean; textAlign: string; lineHeight: number;
  strokeDashArray: string; rx: number; ry: number;
}

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
  const t = useI18n((s) => s.t);

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

  const updateProp = (key: string, value: unknown) => {
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
        <div className="prop-section-title">{t('canvas')}</div>
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
        <div className="prop-row">
          <label>{t('width')}</label>
          <input type="number" value={canvasWidth} onChange={(e) => setCanvasSize(Number(e.target.value), canvasHeight)} min={100} />
        </div>
        <div className="prop-row">
          <label>{t('height')}</label>
          <input type="number" value={canvasHeight} onChange={(e) => setCanvasSize(canvasWidth, Number(e.target.value))} min={100} />
        </div>
        <div className="prop-row">
          <label>{t('bgColor')}</label>
          <input type="color" value={backgroundColor} onChange={(e) => setBackgroundColor(e.target.value)} />
        </div>
      </div>

      {hasSelection && (
        <>
          <div className="prop-section">
            <div className="prop-section-title">{t('positionSize')}</div>
            <div className="prop-row"><label>{t('x')}</label><input type="number" value={props.left} onChange={(e) => updateProp('left', Number(e.target.value))} onBlur={commitChange} /></div>
            <div className="prop-row"><label>{t('y')}</label><input type="number" value={props.top} onChange={(e) => updateProp('top', Number(e.target.value))} onBlur={commitChange} /></div>
            <div className="prop-row"><label>{t('width')}</label><input type="number" value={props.width} onChange={(e) => updateProp('width', Number(e.target.value))} onBlur={commitChange} min={1} /></div>
            <div className="prop-row"><label>{t('height')}</label><input type="number" value={props.height} onChange={(e) => updateProp('height', Number(e.target.value))} onBlur={commitChange} min={1} /></div>
            <div className="prop-row"><label>{t('rotation')}</label><input type="number" value={props.angle} onChange={(e) => updateProp('angle', Number(e.target.value))} onBlur={commitChange} /></div>
          </div>

          <div className="prop-section">
            <div className="prop-section-title">{t('appearance')}</div>
            <div className="prop-row"><label>{t('fill')}</label><input type="color" value={props.fill || '#ffffff'} onChange={(e) => updateProp('fill', e.target.value)} onBlur={commitChange} /></div>
            <div className="prop-row"><label>{t('strokeColor')}</label><input type="color" value={props.stroke || '#000000'} onChange={(e) => updateProp('stroke', e.target.value)} onBlur={commitChange} /></div>
            <div className="prop-row"><label>{t('strokeWidth')}</label><input type="number" value={props.strokeWidth} onChange={(e) => updateProp('strokeWidth', Number(e.target.value))} onBlur={commitChange} min={0} max={50} /></div>
            <div className="prop-row"><label>{t('dash')}</label><input type="text" value={props.strokeDashArray} onChange={(e) => updateProp('strokeDashArray', e.target.value)} onBlur={commitChange} placeholder={t('dashPlaceholder')} /></div>
            <div className="prop-row">
              <label>{t('opacity')}</label>
              <input type="range" min={0} max={1} step={0.05} value={props.opacity} onChange={(e) => updateProp('opacity', Number(e.target.value))} onMouseUp={commitChange} />
              <span className="prop-value">{Math.round(props.opacity * 100)}%</span>
            </div>
            {isRect && (
              <div className="prop-row"><label>{t('cornerRadius')}</label><input type="number" value={props.rx} onChange={(e) => { const v = Number(e.target.value); updateProp('rx', v); updateProp('ry', v); }} onBlur={commitChange} min={0} /></div>
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
