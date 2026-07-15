import { describe, expect, it } from 'vitest';
import { rulerPositionToScene, sceneToRulerPosition } from '../utils/rulerGeometry';

describe('ruler coordinate conversion', () => {
  it('accounts for the canvas DOM origin, viewport pan and zoom', () => {
    const position = sceneToRulerPosition(120, 2, -30, 75);
    expect(position).toBe(285);
    expect(rulerPositionToScene(position, 2, -30, 75)).toBe(120);
  });

  it('handles the CAD ruler offset where the canvas begins under the corner', () => {
    expect(rulerPositionToScene(80, 1, 25, -20)).toBe(75);
  });
});
