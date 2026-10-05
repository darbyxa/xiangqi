import { useEffect, useRef } from 'react';

interface Props {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, body, confirmLabel, cancelLabel = 'Keep playing', danger, onConfirm, onCancel }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="scrim" onClick={onCancel}>
      <div
        className="panel dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dlg-title"
        aria-describedby="dlg-body"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="dlg-title">{title}</h2>
        <p id="dlg-body">{body}</p>
        <div className="row end">
          <button ref={cancelRef} type="button" className="btn ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
