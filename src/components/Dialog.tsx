import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

interface DialogProps {
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  closeLabel?: string;
  className?: string;
  maxWidth?: number | string;
  footer?: ReactNode;
  closeOnOverlay?: boolean;
  dismissible?: boolean;
}

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export default function Dialog({
  title,
  children,
  onClose,
  closeLabel = 'Close',
  className = '',
  maxWidth,
  footer,
  closeOnOverlay = true,
  dismissible = true,
}: DialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const initial = dialog?.querySelector<HTMLElement>('[data-autofocus]')
      ?? dialog?.querySelector<HTMLElement>(FOCUSABLE)
      ?? dialog;
    initial?.focus();

    return () => previousFocus?.focus();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (dismissible && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      .filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (dismissible && closeOnOverlay && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`modal-content ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={maxWidth ? { maxWidth } : undefined}
        onKeyDown={handleKeyDown}
      >
        <div className="modal-header">
          <span id={titleId}>{title}</span>
          {dismissible && (
            <button className="modal-close" onClick={onClose} aria-label={closeLabel} title={closeLabel}>
              &times;
            </button>
          )}
        </div>
        {children}
        {footer}
      </div>
    </div>
  );
}
