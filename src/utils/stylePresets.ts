import * as fabric from 'fabric';

const LEGACY_STORAGE_KEY = 'vectoreditor-current-style-v1';
const STORAGE_PREFIX = 'vectoreditor-current-style-v2';

export type EditorStyleKind = 'shape' | 'line' | 'text';

export interface EditorStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  strokeDashArray?: number[];
  fontFamily: string;
  fontSize: number;
  fontWeight: string | number;
  fontStyle: string;
}

export const DEFAULT_EDITOR_STYLE: EditorStyle = {
  fill: '#D9EAF7',
  stroke: '#1F4E79',
  strokeWidth: 2,
  opacity: 1,
  fontFamily: 'sans-serif',
  fontSize: 24,
  fontWeight: 'normal',
  fontStyle: 'normal',
};

export const DEFAULT_EDITOR_STYLES: Record<EditorStyleKind, EditorStyle> = {
  shape: DEFAULT_EDITOR_STYLE,
  line: { ...DEFAULT_EDITOR_STYLE, fill: '', stroke: '#1F4E79' },
  text: { ...DEFAULT_EDITOR_STYLE, fill: '#333333', stroke: '', strokeWidth: 0 },
};

export const BUILTIN_STYLE_PRESETS: ReadonlyArray<{ id: string; style: EditorStyle }> = [
  { id: 'blue', style: DEFAULT_EDITOR_STYLE },
  { id: 'mono', style: { ...DEFAULT_EDITOR_STYLE, fill: '#FFFFFF', stroke: '#222222' } },
  { id: 'accent', style: { ...DEFAULT_EDITOR_STYLE, fill: '#FFF0C2', stroke: '#C85A17', strokeWidth: 3 } },
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFontWeight(value: unknown): value is string | number {
  if (isFiniteNumber(value)) return value >= 1 && value <= 1000;
  return typeof value === 'string'
    && (['normal', 'bold', 'lighter', 'bolder'].includes(value) || /^(?:[1-9]00)$/.test(value));
}

function isFontStyle(value: unknown): value is string {
  return typeof value === 'string' && ['normal', 'italic', 'oblique'].includes(value);
}

export function loadCurrentEditorStyle(kind: EditorStyleKind = 'shape'): EditorStyle {
  const fallback = DEFAULT_EDITOR_STYLES[kind];
  try {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}-${kind}`)
      ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    const parsed = JSON.parse(stored ?? 'null') as Partial<EditorStyle> | null;
    if (!parsed || typeof parsed.fill !== 'string' || typeof parsed.stroke !== 'string') {
      return { ...fallback };
    }
    return {
      fill: parsed.fill,
      stroke: parsed.stroke,
      strokeWidth: isFiniteNumber(parsed.strokeWidth) ? Math.max(0, parsed.strokeWidth) : fallback.strokeWidth,
      opacity: isFiniteNumber(parsed.opacity) ? Math.min(1, Math.max(0, parsed.opacity)) : fallback.opacity,
      strokeDashArray: Array.isArray(parsed.strokeDashArray)
        ? parsed.strokeDashArray.filter(isFiniteNumber).map((value) => Math.max(0, value))
        : undefined,
      fontFamily: typeof parsed.fontFamily === 'string' && parsed.fontFamily.trim()
        ? parsed.fontFamily
        : fallback.fontFamily,
      fontSize: isFiniteNumber(parsed.fontSize) && parsed.fontSize > 0
        ? Math.min(1000, parsed.fontSize)
        : fallback.fontSize,
      fontWeight: isFontWeight(parsed.fontWeight) ? parsed.fontWeight : fallback.fontWeight,
      fontStyle: isFontStyle(parsed.fontStyle) ? parsed.fontStyle : fallback.fontStyle,
    };
  } catch {
    return { ...fallback };
  }
}

export function saveCurrentEditorStyle(style: EditorStyle, kind: EditorStyleKind = 'shape'): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}-${kind}`, JSON.stringify(style));
  } catch {
    // The style still applies for this operation when storage is unavailable.
  }
}

export function styleKindForObject(object: fabric.FabricObject): EditorStyleKind {
  if (object instanceof fabric.Text || object instanceof fabric.IText || object instanceof fabric.Textbox) return 'text';
  const objectKind = (object as fabric.FabricObject & { objectKind?: string }).objectKind;
  if (
    object instanceof fabric.Line
    || object instanceof fabric.Path
    || (object instanceof fabric.Polyline && !(object instanceof fabric.Polygon))
    || ['line', 'arrow', 'pencil', 'dimension', 'connector'].includes(objectKind ?? '')
  ) return 'line';
  return 'shape';
}

export function captureEditorStyle(object: fabric.FabricObject): EditorStyle {
  if (object instanceof fabric.Group || object instanceof fabric.ActiveSelection) {
    const children = object.getObjects();
    const strokeSource = children.find((child) => (
      child instanceof fabric.Line
      || child instanceof fabric.Path
      || (child instanceof fabric.Polyline && !(child instanceof fabric.Polygon))
    ));
    const textSource = children.find((child) => (
      child instanceof fabric.Text || child instanceof fabric.IText || child instanceof fabric.Textbox
    )) as fabric.Text | undefined;
    const representative = strokeSource ?? textSource ?? children[0];
    if (representative) {
      const captured = captureEditorStyle(representative);
      if (textSource) {
        captured.fontFamily = textSource.fontFamily ?? captured.fontFamily;
        captured.fontSize = textSource.fontSize ?? captured.fontSize;
        captured.fontWeight = textSource.fontWeight ?? captured.fontWeight;
        captured.fontStyle = textSource.fontStyle ?? captured.fontStyle;
      }
      return captured;
    }
  }
  const textObject = object as fabric.FabricObject & Partial<fabric.Text>;
  return {
    fill: typeof object.fill === 'string' ? object.fill : DEFAULT_EDITOR_STYLE.fill,
    stroke: typeof object.stroke === 'string' ? object.stroke : DEFAULT_EDITOR_STYLE.stroke,
    strokeWidth: object.strokeWidth ?? DEFAULT_EDITOR_STYLE.strokeWidth,
    opacity: object.opacity ?? 1,
    strokeDashArray: object.strokeDashArray ? [...object.strokeDashArray] : undefined,
    fontFamily: textObject.fontFamily ?? DEFAULT_EDITOR_STYLE.fontFamily,
    fontSize: textObject.fontSize ?? DEFAULT_EDITOR_STYLE.fontSize,
    fontWeight: textObject.fontWeight ?? DEFAULT_EDITOR_STYLE.fontWeight,
    fontStyle: textObject.fontStyle ?? DEFAULT_EDITOR_STYLE.fontStyle,
  };
}

export function applyEditorStyle(object: fabric.FabricObject, style: EditorStyle): void {
  if (object instanceof fabric.Group || object instanceof fabric.ActiveSelection) {
    const objectKind = (object as fabric.FabricObject & { objectKind?: string }).objectKind;
    const childStyle = ['arrow', 'dimension', 'connector'].includes(objectKind ?? '')
      ? { ...style, fill: style.stroke }
      : style;
    object.getObjects().forEach((child) => applyEditorStyle(child, childStyle));
    object.triggerLayout();
    object.setCoords();
    object.dirty = true;
    return;
  }

  const isOpenStroke = object instanceof fabric.Line
    || object instanceof fabric.Path
    || (object instanceof fabric.Polyline && !(object instanceof fabric.Polygon));
  object.set({
    fill: isOpenStroke ? '' : style.fill,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    opacity: style.opacity,
    strokeDashArray: style.strokeDashArray ? [...style.strokeDashArray] : undefined,
  });

  if (object instanceof fabric.Text || object instanceof fabric.IText || object instanceof fabric.Textbox) {
    object.set({
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      fill: style.fill,
    });
  }
}
