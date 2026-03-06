import { useEffect, useState, useCallback } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../store/useEditorStore';

interface ObjProps {
  left: number;
  top: number;
  width: number;
  height: number;
  angle: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  // text
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  fontStyle: string;
  underline: boolean;
  textAlign: string;
  lineHeight: number;
  // stroke style
  strokeDashArray: string;
  rx: number;
  ry: number;
}

const defaultProps: ObjProps = {
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  angle: 0,
  fill: '#D9EAF7',
  stroke: '#1F4E79',
  strokeWidth: 2,
  opacity: 1,
  fontFamily: 'sans-serif',
  fontSize: 24,
  fontWeight: 'normal',
  fontStyle: 'normal',
  underline: false,
  textAlign: 'left',
  lineHeight: 1.2,
  strokeDashArray: '',
  rx: 0,
  ry: 0,
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

  const [props, setProps] = useState<ObjProps>(defaultProps);
  const [isText, setIsText] = useState(false);
  const [isRect, setIsRect] = useState(false);

  const readProps = useCallback(() => {
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (!obj) {
      setProps(defaultProps);
      return;
    }

    const bound = obj.getBoundingRect();
    const scaleX = obj.scaleX || 1;
    const scaleY = obj.scaleY || 1;

    setIsText(obj instanceof fabric.Textbox || obj instanceof fabric.IText);
    setIsRect(obj instanceof fabric.Rect);

    setProps({
      left: Math.round(obj.left || 0),
      top: Math.round(obj.top || 0),
      width: Math.round(bound.width),
      height: Math.round(bound.height),
      angle: Math.round(obj.angle || 0),
      fill: (typeof obj.fill === 'string' ? obj.fill : '') || '',
      stroke: obj.stroke || '',
      strokeWidth: obj.strokeWidth || 0,
      opacity: obj.opacity ?? 1,
      fontFamily: (obj as fabric.Textbox).fontFamily || 'sans-serif',
      fontSize: (obj as fabric.Textbox).fontSize || 24,
      fontWeight: String((obj as fabric.Textbox).fontWeight || 'normal'),
      fontStyle: (obj as fabric.Textbox).fontStyle || 'normal',
      underline: (obj as fabric.Textbox).underline || false,
      textAlign: (obj as fabric.Textbox).textAlign || 'left',
      lineHeight: (obj as fabric.Textbox).lineHeight || 1.2,
      strokeDashArray: obj.strokeDashArray ? obj.strokeDashArray.join(',') : '',
      rx: (obj as fabric.Rect).rx || 0,
      ry: (obj as fabric.Rect).ry || 0,
    });
  }, [canvas]);

  useEffect(() => {
    readProps();
  }, [selectedObjectIds, readProps]);

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

    if (key === 'width') {
      const scaleX = (value as number) / ((obj.width || 1));
      obj.set({ scaleX });
    } else if (key === 'height') {
      const scaleY = (value as number) / ((obj.height || 1));
      obj.set({ scaleY });
    } else if (key === 'strokeDashArray') {
      const str = value as string;
      if (str.trim() === '') {
        obj.set({ strokeDashArray: undefined });
      } else {
        obj.set({ strokeDashArray: str.split(',').map(Number) });
      }
    } else {
      obj.set({ [key]: value } as Partial<fabric.FabricObject>);
    }
    obj.setCoords();
    canvas.requestRenderAll();
    readProps();
  };

  const commitChange = () => {
    pushHistory();
  };

  const hasSelection = selectedObjectIds.length > 0;

  return (
    <div className="property-panel">
      {/* Canvas settings */}
      <div className="prop-section">
        <div className="prop-section-title">キャンバス</div>
        <div className="prop-row">
          <label>幅</label>
          <input
            type="number"
            value={canvasWidth}
            onChange={(e) => setCanvasSize(Number(e.target.value), canvasHeight)}
            min={100}
          />
        </div>
        <div className="prop-row">
          <label>高さ</label>
          <input
            type="number"
            value={canvasHeight}
            onChange={(e) => setCanvasSize(canvasWidth, Number(e.target.value))}
            min={100}
          />
        </div>
        <div className="prop-row">
          <label>背景色</label>
          <input
            type="color"
            value={backgroundColor}
            onChange={(e) => setBackgroundColor(e.target.value)}
          />
        </div>
      </div>

      {hasSelection && (
        <>
          {/* Position & Size */}
          <div className="prop-section">
            <div className="prop-section-title">位置・サイズ</div>
            <div className="prop-row">
              <label>X</label>
              <input
                type="number"
                value={props.left}
                onChange={(e) => updateProp('left', Number(e.target.value))}
                onBlur={commitChange}
              />
            </div>
            <div className="prop-row">
              <label>Y</label>
              <input
                type="number"
                value={props.top}
                onChange={(e) => updateProp('top', Number(e.target.value))}
                onBlur={commitChange}
              />
            </div>
            <div className="prop-row">
              <label>幅</label>
              <input
                type="number"
                value={props.width}
                onChange={(e) => updateProp('width', Number(e.target.value))}
                onBlur={commitChange}
                min={1}
              />
            </div>
            <div className="prop-row">
              <label>高さ</label>
              <input
                type="number"
                value={props.height}
                onChange={(e) => updateProp('height', Number(e.target.value))}
                onBlur={commitChange}
                min={1}
              />
            </div>
            <div className="prop-row">
              <label>回転</label>
              <input
                type="number"
                value={props.angle}
                onChange={(e) => updateProp('angle', Number(e.target.value))}
                onBlur={commitChange}
              />
            </div>
          </div>

          {/* Appearance */}
          <div className="prop-section">
            <div className="prop-section-title">外観</div>
            <div className="prop-row">
              <label>塗り</label>
              <input
                type="color"
                value={props.fill || '#ffffff'}
                onChange={(e) => updateProp('fill', e.target.value)}
                onBlur={commitChange}
              />
            </div>
            <div className="prop-row">
              <label>線色</label>
              <input
                type="color"
                value={props.stroke || '#000000'}
                onChange={(e) => updateProp('stroke', e.target.value)}
                onBlur={commitChange}
              />
            </div>
            <div className="prop-row">
              <label>線幅</label>
              <input
                type="number"
                value={props.strokeWidth}
                onChange={(e) => updateProp('strokeWidth', Number(e.target.value))}
                onBlur={commitChange}
                min={0}
                max={50}
              />
            </div>
            <div className="prop-row">
              <label>破線</label>
              <input
                type="text"
                value={props.strokeDashArray}
                onChange={(e) => updateProp('strokeDashArray', e.target.value)}
                onBlur={commitChange}
                placeholder="例: 5,5"
              />
            </div>
            <div className="prop-row">
              <label>透明度</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={props.opacity}
                onChange={(e) => updateProp('opacity', Number(e.target.value))}
                onMouseUp={commitChange}
              />
              <span className="prop-value">{Math.round(props.opacity * 100)}%</span>
            </div>
            {isRect && (
              <div className="prop-row">
                <label>角丸</label>
                <input
                  type="number"
                  value={props.rx}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    updateProp('rx', v);
                    updateProp('ry', v);
                  }}
                  onBlur={commitChange}
                  min={0}
                />
              </div>
            )}
          </div>

          {/* Text properties */}
          {isText && (
            <div className="prop-section">
              <div className="prop-section-title">文字</div>
              <div className="prop-row">
                <label>フォント</label>
                <select
                  value={props.fontFamily}
                  onChange={(e) => updateProp('fontFamily', e.target.value)}
                  onBlur={commitChange}
                >
                  <option value="sans-serif">Sans Serif</option>
                  <option value="serif">Serif</option>
                  <option value="monospace">Monospace</option>
                  <option value="'Noto Sans JP', sans-serif">Noto Sans JP</option>
                </select>
              </div>
              <div className="prop-row">
                <label>サイズ</label>
                <input
                  type="number"
                  value={props.fontSize}
                  onChange={(e) => updateProp('fontSize', Number(e.target.value))}
                  onBlur={commitChange}
                  min={8}
                  max={200}
                />
              </div>
              <div className="prop-row prop-row-buttons">
                <button
                  className={`prop-toggle ${props.fontWeight === 'bold' || props.fontWeight === '700' ? 'active' : ''}`}
                  onClick={() => {
                    updateProp('fontWeight', props.fontWeight === 'bold' || props.fontWeight === '700' ? 'normal' : 'bold');
                    commitChange();
                  }}
                  title="太字"
                >
                  B
                </button>
                <button
                  className={`prop-toggle ${props.fontStyle === 'italic' ? 'active' : ''}`}
                  onClick={() => {
                    updateProp('fontStyle', props.fontStyle === 'italic' ? 'normal' : 'italic');
                    commitChange();
                  }}
                  title="斜体"
                >
                  I
                </button>
                <button
                  className={`prop-toggle ${props.underline ? 'active' : ''}`}
                  onClick={() => {
                    updateProp('underline', !props.underline);
                    commitChange();
                  }}
                  title="下線"
                >
                  U
                </button>
              </div>
              <div className="prop-row">
                <label>揃え</label>
                <select
                  value={props.textAlign}
                  onChange={(e) => {
                    updateProp('textAlign', e.target.value);
                    commitChange();
                  }}
                >
                  <option value="left">左</option>
                  <option value="center">中央</option>
                  <option value="right">右</option>
                </select>
              </div>
              <div className="prop-row">
                <label>文字色</label>
                <input
                  type="color"
                  value={props.fill || '#333333'}
                  onChange={(e) => updateProp('fill', e.target.value)}
                  onBlur={commitChange}
                />
              </div>
              <div className="prop-row">
                <label>行間</label>
                <input
                  type="number"
                  value={props.lineHeight}
                  onChange={(e) => updateProp('lineHeight', Number(e.target.value))}
                  onBlur={commitChange}
                  min={0.5}
                  max={3}
                  step={0.1}
                />
              </div>
            </div>
          )}
        </>
      )}

      {!hasSelection && (
        <div className="prop-placeholder">
          オブジェクトを選択すると<br />プロパティが表示されます
        </div>
      )}
    </div>
  );
}
