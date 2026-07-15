import * as fabric from 'fabric';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyEditorStyle,
  captureEditorStyle,
  loadCurrentEditorStyle,
  saveCurrentEditorStyle,
} from './stylePresets';

describe('style presets', () => {
  beforeEach(() => localStorage.clear());

  it('persists validated current style values', () => {
    const style = {
      ...loadCurrentEditorStyle(),
      fill: '#123456',
      stroke: '#654321',
      strokeWidth: 4,
    };
    saveCurrentEditorStyle(style, 'shape');
    expect(loadCurrentEditorStyle('shape')).toMatchObject(style);
    expect(loadCurrentEditorStyle('text').fill).toBe('#333333');
  });

  it('captures and applies object appearance', () => {
    const source = new fabric.Rect({ fill: '#ff0000', stroke: '#0000ff', strokeWidth: 5, opacity: 0.5 });
    const target = new fabric.Rect({ fill: '#ffffff' });
    const style = captureEditorStyle(source);
    applyEditorStyle(target, style);
    expect(target.fill).toBe('#ff0000');
    expect(target.stroke).toBe('#0000ff');
    expect(target.strokeWidth).toBe(5);
    expect(target.opacity).toBe(0.5);
  });

  it('captures and recursively applies a semantic group stroke', () => {
    const line = new fabric.Line([0, 0, 20, 0], { stroke: '#336699', strokeWidth: 6 });
    const head = new fabric.Triangle({ fill: '#336699', width: 8, height: 8 });
    const group = new fabric.Group([line, head]);
    Object.assign(group, { objectKind: 'arrow' });

    const style = captureEditorStyle(group);
    expect(style.stroke).toBe('#336699');
    expect(style.strokeWidth).toBe(6);

    applyEditorStyle(group, { ...style, stroke: '#ff0000', strokeWidth: 3 });
    expect(line.stroke).toBe('#ff0000');
    expect(line.strokeWidth).toBe(3);
    expect(head.fill).toBe('#ff0000');
  });

  it('sanitizes corrupt values loaded from storage', () => {
    localStorage.setItem('vectoreditor-current-style-v2-shape', JSON.stringify({
      fill: '#ffffff',
      stroke: '#000000',
      strokeWidth: 'wide',
      opacity: 4,
      fontFamily: 42,
      fontSize: 'large',
      fontWeight: 'extra-heavy',
      fontStyle: 'sideways',
      strokeDashArray: [4, 'bad', -2],
    }));

    expect(loadCurrentEditorStyle('shape')).toMatchObject({
      fill: '#ffffff',
      stroke: '#000000',
      strokeWidth: 2,
      opacity: 1,
      fontFamily: 'sans-serif',
      fontSize: 24,
      fontWeight: 'normal',
      fontStyle: 'normal',
      strokeDashArray: [4, 0],
    });
  });
});
