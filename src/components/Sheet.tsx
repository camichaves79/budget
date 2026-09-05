import { useEffect, type ReactNode } from 'react';

/** Bottom sheet modal for forms and detail views. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Keep the sheet above the on-screen keyboard. iOS overlays the keyboard on
  // top of fixed layouts instead of resizing them, so we lift the sheet by the
  // keyboard's height (the visualViewport delta) while it animates in.
  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    const update = () => {
      const inset = vv ? Math.max(0, window.innerHeight - vv.height) : 0;
      document.documentElement.style.setProperty('--kb-inset', `${inset}px`);
    };
    update();
    vv?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    return () => {
      vv?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
      document.documentElement.style.setProperty('--kb-inset', '0px');
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className={className ? `sheet ${className}` : 'sheet'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grabber" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
