import { useState, useEffect, useRef, useCallback } from 'react';
import { useI18n } from '../i18n/useI18n';

interface Props {
  onPlace: (dataUrl: string, latex: string, fontSize: number) => void;
  onCancel: () => void;
}

let katexCssLoaded = false;
function ensureKatexCss(): void {
  if (katexCssLoaded) return;
  katexCssLoaded = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  // Vite resolves node_modules CSS via import, but for dynamic loading
  // we use a CDN link as fallback (KaTeX CSS from node_modules is also loaded via import below)
  link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css';
  link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
}

export default function LatexDialog({ onPlace, onCancel }: Props) {
  const t = useI18n((s) => s.t);
  const [latex, setLatex] = useState('E = mc^2');
  const [fontSize, setFontSize] = useState(24);
  const [previewHtml, setPreviewHtml] = useState('');
  const [ready, setReady] = useState(false);
  const [placing, setPlacing] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const katexRef = useRef<any>(null);
  const renderRef = useRef<HTMLDivElement>(null);

  // Load KaTeX on mount
  useEffect(() => {
    let cancelled = false;
    ensureKatexCss();
    import('katex').then((mod) => {
      if (!cancelled) {
        katexRef.current = mod.default;
        setReady(true);
      }
    });
    return () => { cancelled = true; };
  }, []);

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
    if (!renderRef.current || !katexRef.current || placing) return;
    setPlacing(true);

    try {
      // Create off-screen render container with exact styling
      const container = document.createElement('div');
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

      document.body.removeChild(container);

      const dataUrl = canvas.toDataURL('image/png');
      onPlace(dataUrl, latex, fontSize);
    } catch (err) {
      console.error('LaTeX render error:', err);
      setPlacing(false);
    }
  }, [latex, fontSize, onPlace, placing]);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content latex-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t('latexInput')}</span>
          <button className="modal-close" onClick={onCancel}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="prop-row">
            <label>{t('latexFormula')}</label>
          </div>
          <textarea
            className="latex-textarea"
            value={latex}
            onChange={(e) => setLatex(e.target.value)}
            rows={3}
            placeholder="E = mc^2"
            spellCheck={false}
          />
          <div className="prop-row">
            <label>{t('fontSize')}</label>
            <input
              type="number"
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              min={10}
              max={120}
            />
          </div>
          <div className="latex-preview-label">{t('latexPreview')}</div>
          <div className="latex-preview-area">
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
            disabled={!ready || placing || latex.trim() === ''}
          >
            {placing ? '...' : t('latexPlace')}
          </button>
          <button className="toolbar-btn" onClick={onCancel}>
            {t('measureClose')}
          </button>
        </div>
      </div>
    </div>
  );
}
