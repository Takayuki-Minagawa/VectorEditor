import { useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';
import { PX_PER_MM, PAPER_SIZES, parseScaleRatio } from '../types';

interface Props {
  onClose: () => void;
}

const SCALES = ['1:1', '1:10', '1:20', '1:50', '1:100', '1:200', '1:500'];

export default function CadExportDialog({ onClose }: Props) {
  const canvas = useEditorStore((s) => s.canvas);
  const t = useI18n((s) => s.t);

  const [paperIndex, setPaperIndex] = useState(4); // A4
  const [scaleStr, setScaleStr] = useState('1:100');
  const [landscape, setLandscape] = useState(true);
  const [format, setFormat] = useState<'svg' | 'png' | 'pdf'>('pdf');

  const paper = PAPER_SIZES[paperIndex];
  const paperW = landscape ? Math.max(paper.width, paper.height) : Math.min(paper.width, paper.height);
  const paperH = landscape ? Math.min(paper.width, paper.height) : Math.max(paper.width, paper.height);
  const scaleRatio = parseScaleRatio(scaleStr);

  // Viewable area of the drawing on this paper at this scale (in mm)
  const viewW = paperW * scaleRatio;
  const viewH = paperH * scaleRatio;

  // Paper size in output pixels
  const pxW = Math.round(paperW * PX_PER_MM);
  const pxH = Math.round(paperH * PX_PER_MM);

  const handleExport = async () => {
    if (!canvas) return;

    // Save original state
    const origVpt = [...canvas.viewportTransform!] as [number, number, number, number, number, number];
    const origW = canvas.width!;
    const origH = canvas.height!;

    // Set viewport to map drawing area to paper pixels
    const exportScale = pxW / viewW;
    canvas.setViewportTransform([exportScale, 0, 0, exportScale, 0, 0]);
    canvas.setDimensions({ width: pxW, height: pxH });

    const restore = () => {
      canvas.setViewportTransform(origVpt);
      canvas.setDimensions({ width: origW, height: origH });
      canvas.requestRenderAll();
    };

    try {
      if (format === 'svg') {
        const svg = canvas.toSVG();
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'cad-drawing.svg';
        a.click();
        URL.revokeObjectURL(url);
      } else if (format === 'png') {
        const dataUrl = canvas.toDataURL({ format: 'png', multiplier: 2 });
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = 'cad-drawing.png';
        a.click();
      } else if (format === 'pdf') {
        const { jsPDF } = await import('jspdf');
        await import('svg2pdf.js');

        const svgStr = canvas.toSVG();
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgStr, 'image/svg+xml');
        const svgEl = svgDoc.documentElement;

        const orientation = pxW >= pxH ? 'landscape' : 'portrait';
        const pdf = new jsPDF({
          orientation,
          unit: 'px',
          format: [pxW, pxH],
          hotfixes: ['px_scaling'],
        });

        await pdf.svg(svgEl, { x: 0, y: 0, width: pxW, height: pxH });
        pdf.save('cad-drawing.pdf');
      }
    } finally {
      restore();
    }

    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content nm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t('cadExport')}</span>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="nm-row">
            <label>{t('paperSize')}</label>
            <select value={paperIndex} onChange={(e) => setPaperIndex(Number(e.target.value))} style={{ flex: 1 }}>
              {PAPER_SIZES.map((p, i) => (
                <option key={p.label} value={i}>{p.label} ({p.width}&times;{p.height}mm)</option>
              ))}
            </select>
          </div>
          <div className="nm-row">
            <label>{t('orientation')}</label>
            <select value={landscape ? 'landscape' : 'portrait'} onChange={(e) => setLandscape(e.target.value === 'landscape')} style={{ flex: 1 }}>
              <option value="landscape">{t('landscape')}</option>
              <option value="portrait">{t('portrait')}</option>
            </select>
          </div>
          <div className="nm-row">
            <label>{t('exportScale')}</label>
            <select value={scaleStr} onChange={(e) => setScaleStr(e.target.value)} style={{ flex: 1 }}>
              {SCALES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="nm-row">
            <label>{t('exportFormat')}</label>
            <select value={format} onChange={(e) => setFormat(e.target.value as 'svg' | 'png' | 'pdf')} style={{ flex: 1 }}>
              <option value="svg">SVG</option>
              <option value="png">PNG</option>
              <option value="pdf">PDF</option>
            </select>
          </div>
          <p style={{ fontSize: 11, color: '#888', marginTop: 8 }}>
            {t('cadExportInfo')}: {Math.round(viewW)}&times;{Math.round(viewH)}mm &rarr; {paperW}&times;{paperH}mm ({pxW}&times;{pxH}px)
          </p>
        </div>
        <div className="nm-actions">
          <button className="toolbar-btn nm-btn" onClick={handleExport}>{t('cadExportBtn')}</button>
          <button className="toolbar-btn nm-btn nm-cancel" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </div>
  );
}
