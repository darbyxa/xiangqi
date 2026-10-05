import type { Toast } from '../hooks/useGameSession';

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} type="button" className={`toast ${t.kind}`} onClick={() => onDismiss(t.id)}>
          {t.text}
        </button>
      ))}
    </div>
  );
}
