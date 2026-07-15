import { useState, useEffect, useRef, useCallback, useId } from 'react';
import 'katex/dist/katex.min.css';
import { useI18n } from '../i18n/useI18n';
import { useEditorStore } from '../store/useEditorStore';
import { createAsyncCanvasMutationGuard } from '../utils/canvasCommands';
import Dialog from './Dialog';

interface Props {
  onPlace: (dataUrl: string, latex: string, fontSize: number) => void;
  onCancel: () => void;
}

interface KatexApi {
  renderToString: (
    latex: string,
    options: { throwOnError: boolean; displayMode: boolean },
  ) => string;
}

export default function LatexDialog({ onPlace, onCancel }: Props) {
  const t = useI18n((s) => s.t);
  const [latex, setLatex] = useState('E = mc^2');
  const [fontSizeDraft, setFontSizeDraft] = useState('24');
  const [previewHtml, setPreviewHtml] = useState('');
  const [ready, setReady] = useState(false);
  const [placing, setPlacing] = useState(false);
  const katexRef = useRef<KatexApi | null>(null);
  const renderRef = useRef<HTMLDivElement>(null);
  const formulaId = useId();
  const fontSizeId = useId();
  const previewId = useId();
  const fontSize = Number(fontSizeDraft);
  const validFontSize = Number.isFinite(fontSize) && fontSize >= 10 && fontSize <= 120;

  // Load KaTeX on mount
  useEffect(() => {
    let cancelled = false;
    import('katex')
      .then((mod) => {
        if (!cancelled) {
          katexRef.current = mod.default;
          setReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) useEditorStore.getState().showToast(t('latexRenderError'), 'error');
      });
    return () => { cancelled = true; };
  }, [t]);

  // Update preview
  useEffect(() => {
    if (!katexRef.current) return;
    try {
      const html = katexRef.current.renderToString(latex, {
        throwOnError: false,
        displayMode: true,
      });
      setPreviewHtml(html);
    } catch {
      setPreviewHtml('<span style="color:red">Error</span>');
    }
  }, [latex, ready]);

  const handlePlace = useCallback(async () => {
    if (!renderRef.current || !katexRef.current || placing || !validFontSize) return;
    const activeCanvas = useEditorStore.getState().canvas;
    if (!activeCanvas) return;
    const canCommit = createAsyncCanvasMutationGuard(activeCanvas);
    setPlacing(true);
    let container: HTMLDivElement | null = null;

    try {
      // Create off-screen render container with exact styling
      container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.left = '-9999px';
      container.style.top = '0';
      container.style.padding = '4px 8px';
      container.style.fontSize = `${fontSize}px`;
      container.style.background = 'white';
      container.style.display = 'inline-block';
      container.style.lineHeight = '1';
      container.innerHTML = katexRef.current.renderToString(latex, {
        throwOnError: false,
        displayMode: true,
      });
      document.body.appendChild(container);

      // Wait for fonts/rendering to settle
      await new Promise((r) => setTimeout(r, 200));

      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(container, {
        backgroundColor: null,
        scale: 3,
        logging: false,
      });

      const dataUrl = canvas.toDataURL('image/png');
      if (!canCommit()) return;
      onPlace(dataUrl, latex, fontSize);
    } catch (err) {
      console.error('LaTeX render error:', err);
      useEditorStore.getState().showToast(t('latexRenderError'), 'error');
    } finally {
      container?.remove();
      setPlacing(false);
    }
  }, [latex, fontSize, onPlace, placing, t, validFontSize]);

  return (
    <Dialog title={t('latexInput')} onClose={onCancel} closeLabel={t('measureClose')} className="latex-dialog">
        <div className="modal-body">
          <div className="prop-row">
            <label htmlFor={formulaId}>{t('latexFormula')}</label>
          </div>
          <textarea
            id={formulaId}
            className="latex-textarea"
            value={latex}
            onChange={(e) => setLatex(e.target.value)}
            rows={3}
            placeholder="E = mc^2"
            spellCheck={false}
            data-autofocus
          />
          <div className="prop-row">
            <label htmlFor={fontSizeId}>{t('fontSize')}</label>
            <input
              id={fontSizeId}
              type="number"
              value={fontSizeDraft}
              onChange={(e) => setFontSizeDraft(e.target.value)}
              min={10}
              max={120}
              aria-invalid={!validFontSize}
            />
          </div>
          <div id={previewId} className="latex-preview-label">{t('latexPreview')}</div>
          <div className="latex-preview-area" aria-labelledby={previewId}>
            <div
              ref={renderRef}
              className="latex-render"
              style={{ fontSize }}
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        </div>
        <div className="measure-popup-actions">
          <button
            className="toolbar-btn"
            onClick={handlePlace}
            disabled={!ready || placing || latex.trim() === '' || !validFontSize}
          >
            {placing ? '...' : t('latexPlace')}
          </button>
          <button className="toolbar-btn" onClick={onCancel}>
            {t('measureClose')}
          </button>
        </div>
    </Dialog>
  );
}
