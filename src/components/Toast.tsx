import { useEffect } from 'react';

export interface ToastData {
  id: number;
  kind: 'success' | 'error';
  message: string;
}

/**
 * Transient feedback message: appears, stays long enough to read, then fades
 * out and removes itself (the CSS animation handles the fade; this component
 * schedules the removal to match).
 */
export function Toast({ toast, onDismiss }: { toast: ToastData; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4200);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div
      className={toast.kind === 'error' ? 'toast error' : 'toast'}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <span className="toast-icon" aria-hidden="true">
        {toast.kind === 'error' ? '⚠' : '✓'}
      </span>
      {toast.message}
    </div>
  );
}
