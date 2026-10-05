import type { RoomView } from '../../../shared/protocol';
import { other } from '../lib/pieces';
import { describeResult } from '../lib/result';

interface Props {
  view: RoomView;
  onRestart: () => void;
  onRespond: (accept: boolean) => void;
  onDismiss: () => void;
}

/** Unrolls over the board when a game ends. */
export function ResultBanner({ view, onRestart, onRespond, onDismiss }: Props) {
  const res = describeResult(view);
  if (!res) return null;
  const opponent = view.players[other(view.you)];
  const theyAsked = view.restartRequestedBy === other(view.you);
  const iAsked = view.restartRequestedBy === view.you;

  return (
    <div className="result-overlay" role="dialog" aria-modal="false" aria-label="Game result">
      <div className={`scroll ${res.tone}`}>
        <span className="glyph" aria-hidden="true">{res.glyph}</span>
        <h2>{res.headline}</h2>
        <p>{res.detail}</p>

        {theyAsked ? (
          <>
            <p className="ask">{opponent?.name ?? 'Your opponent'} would like a rematch. Colours will swap.</p>
            <div className="row center">
              <button type="button" className="btn primary" onClick={() => onRespond(true)}>Accept rematch</button>
              <button type="button" className="btn ghost" onClick={() => onRespond(false)}>Decline</button>
            </div>
          </>
        ) : (
          <div className="row center">
            <button
              type="button"
              className="btn primary"
              onClick={onRestart}
              disabled={iAsked || !opponent?.connected}
              title={!opponent?.connected ? 'Your opponent is offline' : undefined}
            >
              {iAsked ? 'Waiting for opponent…' : 'Play again'}
            </button>
            <button type="button" className="btn ghost" onClick={onDismiss}>View board</button>
          </div>
        )}
      </div>
    </div>
  );
}
