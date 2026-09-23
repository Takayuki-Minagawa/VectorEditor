import { useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import * as fabric from 'fabric';
import Dialog from './Dialog';
import { applyImageCrop, currentImageCrop, imageSourceSize, type ImageCrop } from '../utils/imageCrop';
import { useEditorStore } from '../store/useEditorStore';
import { useI18n } from '../i18n/useI18n';

type Corner = 'nw' | 'ne' | 'sw' | 'se';

export default function ImageCropDialog({ image, onClose }: { image: fabric.Image; onClose: () => void }) {
  const source = imageSourceSize(image);
  const [crop, setCrop] = useState<ImageCrop>(() => currentImageCrop(image));
  const previewRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<Corner | null>(null);
  const t = useI18n((s) => s.t);
  const pushHistory = useEditorStore((s) => s.pushHistory);

  const updateFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !previewRef.current) return;
    const bounds = previewRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(source.width, (event.clientX - bounds.left) * source.width / bounds.width));
    const y = Math.max(0, Math.min(source.height, (event.clientY - bounds.top) * source.height / bounds.height));
    setCrop((previous) => {
      const right = previous.x + previous.width;
      const bottom = previous.y + previous.height;
      const left = dragging.current?.includes('w') ? Math.min(x, right - 1) : previous.x;
      const top = dragging.current?.includes('n') ? Math.min(y, bottom - 1) : previous.y;
      const nextRight = dragging.current?.includes('e') ? Math.max(x, left + 1) : right;
      const nextBottom = dragging.current?.includes('s') ? Math.max(y, top + 1) : bottom;
      return { x: left, y: top, width: nextRight - left, height: nextBottom - top };
    });
  };

  const finish = () => {
    try {
      // The source rectangle is defined in untransformed image pixels. Fabric
      // keeps the original source, so rotation, flip and zoom do not alter it.
      applyImageCrop(image, crop);
      pushHistory();
      onClose();
    } catch {
      useEditorStore.getState().showToast(t('cropInvalid'), 'error');
    }
  };

  const left = crop.x / source.width * 100;
  const top = crop.y / source.height * 100;
  const width = crop.width / source.width * 100;
  const height = crop.height / source.height * 100;
  return (
    <Dialog title={t('cropImage')} onClose={onClose} maxWidth={700}>
      <div className="modal-body">
        <p>{t('cropHint')}</p>
        <div
          ref={previewRef}
          className="image-crop-preview"
          style={{ aspectRatio: `${source.width} / ${source.height}`, width: Math.min(600, source.width * Math.min(1, 480 / source.height)) }}
          onPointerMove={updateFromPointer}
          onPointerUp={() => { dragging.current = null; }}
          onPointerCancel={() => { dragging.current = null; }}
        >
          <img src={image.getSrc()} alt="" draggable={false} />
          <div className="image-crop-region" style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}>
            {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
              <button
                key={corner}
                type="button"
                className={`image-crop-handle ${corner}`}
                aria-label={`${t('cropImage')} ${corner}`}
                onPointerDown={(event) => {
                  event.preventDefault();
                  dragging.current = corner;
                  previewRef.current?.setPointerCapture(event.pointerId);
                }}
              />
            ))}
          </div>
        </div>
        <div className="image-crop-size">{Math.round(crop.width)} × {Math.round(crop.height)} px</div>
      </div>
      <div className="nm-actions">
        <button className="toolbar-btn nm-btn" onClick={finish}>{t('cropApply')}</button>
        <button className="toolbar-btn nm-btn nm-cancel" onClick={onClose}>{t('cancel')}</button>
      </div>
    </Dialog>
  );
}
