import * as fabric from 'fabric';
import { afterEach, describe, expect, it } from 'vitest';
import { useEditorStore } from './useEditorStore';

let canvas: fabric.Canvas | null = null;
afterEach(async () => {
  useEditorStore.setState({ canvas: null, pages: [{ id: 'page_1', name: 'Page 1', canvas: { width: 800, height: 600, backgroundColor: '#FFFFFF' }, objects: { objects: [] } }], activePageId: 'page_1', history: [], historyIndex: -1, drawingMode: 'illustration' });
  await canvas?.dispose(); canvas = null;
});

describe('illustration pages', () => {
  it('switches isolated page contents and restores the active page through history', async () => {
    canvas = new fabric.Canvas(document.createElement('canvas'));
    useEditorStore.setState({ canvas, canvasWidth: 800, canvasHeight: 600, backgroundColor: '#FFFFFF', drawingMode: 'illustration', pages: [{ id: 'page_1', name: 'Page 1', canvas: { width: 800, height: 600, backgroundColor: '#FFFFFF' }, objects: { objects: [] } }], activePageId: 'page_1' });
    useEditorStore.getState().resetHistory();
    canvas.add(new fabric.Rect({ left: 10, top: 10, width: 20, height: 20 }));
    useEditorStore.getState().pushHistory();
    await useEditorStore.getState().addPage();
    const secondId = useEditorStore.getState().activePageId;
    expect(canvas.getObjects()).toHaveLength(0);
    canvas.add(new fabric.Circle({ left: 30, top: 30, radius: 10 }));
    useEditorStore.getState().pushHistory();
    await useEditorStore.getState().switchPage('page_1');
    expect(canvas.getObjects()[0]).toBeInstanceOf(fabric.Rect);
    await useEditorStore.getState().switchPage(secondId);
    expect(canvas.getObjects()[0]).toBeInstanceOf(fabric.Circle);
    await useEditorStore.getState().undo();
    expect(useEditorStore.getState().activePageId).toBe('page_1');
    expect(canvas.getObjects()[0]).toBeInstanceOf(fabric.Rect);
    await useEditorStore.getState().redo();
    expect(useEditorStore.getState().activePageId).toBe(secondId);
    expect(canvas.getObjects()[0]).toBeInstanceOf(fabric.Circle);
  });
});
