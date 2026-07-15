import { act, render, screen } from '@testing-library/react';
import * as fabric from 'fabric';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useI18n } from '../i18n/useI18n';
import { useEditorStore } from '../store/useEditorStore';
import ContextMenu from './ContextMenu';

let previousLanguage = useI18n.getState().lang;

type CanvasListener = (event: fabric.TPointerEventInfo) => void;

function createCanvasHarness(activeObject: fabric.FabricObject) {
  const listeners = new Map<string, Set<CanvasListener>>();
  const canvas = {
    upperCanvasEl: document.createElement('canvas'),
    getActiveObject: vi.fn(() => activeObject),
    on: vi.fn((eventName: string, listener: CanvasListener) => {
      const eventListeners = listeners.get(eventName) ?? new Set<CanvasListener>();
      eventListeners.add(listener);
      listeners.set(eventName, eventListeners);
      return () => eventListeners.delete(listener);
    }),
  } as unknown as fabric.Canvas;

  return {
    canvas,
    fireContextMenu() {
      const event = {
        e: { button: 2, clientX: 40, clientY: 60 } as MouseEvent,
      } as fabric.TPointerEventInfo;
      [...(listeners.get('mouse:up') ?? [])].forEach((listener) => listener(event));
    },
  };
}

describe('ContextMenu section operations', () => {
  beforeEach(() => {
    previousLanguage = useI18n.getState().lang;
  });

  afterEach(() => {
    useI18n.getState().setLang(previousLanguage);
    useEditorStore.setState({
      canvas: null,
      drawingMode: 'illustration',
    });
  });

  it('offers the fillet dialog for one unconverted supported CAD shape', () => {
    const harness = createCanvasHarness(new fabric.Rect({ width: 100, height: 60 }));
    useI18n.getState().setLang('ja');
    useEditorStore.setState({ canvas: harness.canvas, drawingMode: 'cad' });
    render(<ContextMenu />);

    act(() => harness.fireContextMenu());

    expect(screen.getByRole('button', { name: '凸角にRを設定…' })).toBeInTheDocument();
  });
});
