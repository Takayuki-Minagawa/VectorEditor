export function sceneToRulerPosition(
  scenePosition: number,
  zoom: number,
  pan: number,
  canvasOrigin: number,
): number {
  return scenePosition * zoom + pan + canvasOrigin;
}
export function rulerPositionToScene(
  rulerPosition: number,
  zoom: number,
  pan: number,
  canvasOrigin: number,
): number {
  return (rulerPosition - pan - canvasOrigin) / zoom;
}
