import { useEffect, useState } from 'react';
import type { RoomView } from '../../../shared/protocol';
import type { Connection } from '../hooks/useGameSession';
import { copyText } from '../lib/clipboard';
import type { PushState } from '../lib/push';
import { colorName, other } from '../lib/pieces';
import { statusLine } from '../lib/result';
import { Board } from './Board';
import { ConfirmDialog } from './ConfirmDialog';
import { MoveHistory } from './MoveHistory';
import { PieceIcon } from './PieceIcon';
import { PlayerCard } from './PlayerCard';
import { ResultBanner } from './ResultBanner';

interface Props {
  view: RoomView;
  receivedAt: number;
  connection: Connection;
  onMove: (from: number, to: number) => Promise<boolean>;
  onResign: () => void;
  onRestart: () => void;
  onRespond: (accept: boolean) => void;
  onLeave: () => void;
  /** back to the lobby without resigning */
  onPark: () => void;
  notifications: PushState;
  onToggleNotifications: () => void;
  notify: (text: string) => void;
}

const NOTIFY_LABEL: Record<PushState, string> = {
  on: '🔔 Notifications on',
  off: "🔕 Notify me when it's my move",
  denied: '🔕 Notifications blocked',
  unsupported: '🔕 Notifications unavailable',
};
const NOTIFY_HINT: Record<PushState, string> = {
  on: 'This device gets a notification when your opponent moves. Tap to turn off.',
  off: 'Get a notification on this device when your opponent moves, even if the game is closed.',
  denied: "Notifications are blocked for this site — allow them in the browser's site settings.",
  unsupported: 'Notifications need the https (ngrok) address and a recent browser.',
};

export function GameScreen({
  view,
  receivedAt,
  connection,
  onMove,
  onResign,
  onRestart,
  onRespond,
  onLeave,
  onPark,
  notifications,
  onToggleNotifications,
  notify,
}: Props) {
  const me = view.you;
  const opp = other(me);
  const [confirm, setConfirm] = useState<'resign' | 'leave' | null>(null);
  const [bannerHidden, setBannerHidden] = useState(false);

  useEffect(() => {
    if (view.status !== 'finished') setBannerHidden(false);
  }, [view.status]);

  // Put the state of play in the tab title so you notice it's your move from another tab.
  useEffect(() => {
    const yours = view.status === 'playing' && view.turn === me;
    document.title = yours ? '● Your move · 象棋' : '象棋 · Xiangqi Online';
    return () => {
      document.title = '象棋 · Xiangqi Online';
    };
  }, [view.status, view.turn, me]);

  const { text, sub } = statusLine(view);
  const offline = connection !== 'online';
  const myTurn = view.status === 'playing' && view.turn === me;
  const opponent = view.players[opp];
  const theyAsked = view.restartRequestedBy === opp;
  const iAsked = view.restartRequestedBy === me;
  const inviteLink = `${window.location.origin}/?room=${view.code}`;

  const copy = async (what: string, value: string) =>
    notify((await copyText(value)) ? `${what} copied.` : `Couldn't copy — select it manually: ${value}`);

  return (
    <div className="game">
      <header className="topbar">
        <div className="brand" aria-label="Xiangqi">
          <span className="brand-glyph" aria-hidden="true">象棋</span>
          <span className="brand-sub">Xiangqi</span>
        </div>
        <div className="room-chip">
          <span>Room</span>
          <strong className="code" aria-label={`Room code ${view.code.split('').join(' ')}`}>{view.code}</strong>
          <button type="button" className="btn tiny" onClick={() => void copy('Room code', view.code)}>Copy code</button>
          <button type="button" className="btn tiny" onClick={() => void copy('Invite link', inviteLink)}>Copy link</button>
        </div>
        <div className="topbar-actions">
          <button type="button" className="btn ghost small" onClick={onPark} title="Back to the lobby — this game is kept and can be resumed any time">
            My games
          </button>
          <button
            type="button"
            className="btn ghost small"
            onClick={() => (view.status === 'playing' ? setConfirm('leave') : onLeave())}
          >
            Leave room
          </button>
        </div>
      </header>

      {offline && (
        <div className="conn-banner" role="alert">
          Connection lost — trying to reconnect…
        </div>
      )}

      <main className="game-grid">
        <aside className="col-players" aria-label="Players">
          <PlayerCard
            color={opp}
            player={opponent}
            isYou={false}
            isTurn={view.status === 'playing' && view.turn === opp}
            captured={view.capturedBy[opp]}
            receivedAt={receivedAt}
          />
          <PlayerCard
            color={me}
            player={view.players[me]}
            isYou
            isTurn={myTurn}
            captured={view.capturedBy[me]}
            receivedAt={receivedAt}
          />
        </aside>

        <section className="col-board" aria-label="Board">
          <div className="board-stage">
            <Board view={view} onMove={onMove} locked={offline} />
            {view.status === 'finished' && !bannerHidden && (
              <ResultBanner view={view} onRestart={onRestart} onRespond={onRespond} onDismiss={() => setBannerHidden(true)} />
            )}
            {view.status === 'waiting' && (
              <div className="result-overlay">
                <div className="scroll waiting">
                  <span className="glyph" aria-hidden="true">候</span>
                  <h2>Waiting for your opponent</h2>
                  <p>Send them this code and they can join from anywhere.</p>
                  <strong className="big-code">{view.code}</strong>
                  <div className="row center">
                    <button type="button" className="btn primary" onClick={() => void copy('Room code', view.code)}>Copy code</button>
                    <button type="button" className="btn ghost" onClick={() => void copy('Invite link', inviteLink)}>Copy invite link</button>
                  </div>
                  <p className="hint">You are {colorName(me)}{me === 'red' ? ' and move first' : ''}.</p>
                  <p className="hint">
                    You can close this page — the game is saved
                    {notifications === 'on' ? " and you'll get a notification when they join." : '. Turn on notifications to hear when they join.'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className="col-side" aria-label="Game status">
          <section className={`panel status ${view.inCheck ? 'check' : ''} ${myTurn ? 'mine' : ''}`} aria-live="polite">
            <div className="status-head">
              {view.status === 'playing' ? (
                <PieceIcon color={view.turn} type="K" size={40} />
              ) : (
                <PieceIcon color={me} type="K" size={40} />
              )}
              <div>
                <h2>{text}</h2>
                <p>{sub}</p>
              </div>
            </div>

            {theyAsked && (
              <div className="callout">
                <p>{opponent?.name ?? 'Your opponent'} asks to restart. Colours will swap.</p>
                <div className="row">
                  <button type="button" className="btn primary small" onClick={() => onRespond(true)}>Accept</button>
                  <button type="button" className="btn ghost small" onClick={() => onRespond(false)}>Decline</button>
                </div>
              </div>
            )}
            {iAsked && <p className="callout muted">Restart requested — waiting for your opponent…</p>}
          </section>

          <section className="panel history-panel">
            <h3 className="panel-title">Moves</h3>
            <MoveHistory history={view.history} />
          </section>

          <section className="panel actions">
            {view.status === 'playing' && (
              <>
                <button type="button" className="btn danger" onClick={() => setConfirm('resign')}>Resign</button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={onRestart}
                  disabled={iAsked || !opponent?.connected}
                  title={!opponent?.connected ? 'Your opponent is offline' : 'Ask your opponent to start over'}
                >
                  {iAsked ? 'Requested…' : 'Restart'}
                </button>
              </>
            )}
            {view.status === 'finished' && (
              <button
                type="button"
                className="btn primary"
                onClick={onRestart}
                disabled={iAsked || theyAsked || !opponent?.connected}
              >
                {iAsked ? 'Rematch requested…' : 'Play again'}
              </button>
            )}
            {view.status === 'waiting' && <p className="muted">Resign and restart become available once your opponent joins.</p>}
          </section>

          <section className="panel notify-panel">
            <button
              type="button"
              className={`btn wide ${notifications === 'off' ? 'primary' : 'ghost'}`}
              onClick={onToggleNotifications}
              disabled={notifications === 'unsupported'}
              aria-pressed={notifications === 'on'}
            >
              {NOTIFY_LABEL[notifications]}
            </button>
            <p className="muted">{NOTIFY_HINT[notifications]}</p>
          </section>
        </aside>
      </main>

      {confirm === 'resign' && (
        <ConfirmDialog
          title="Resign this game?"
          body={`${opponent?.name ?? 'Your opponent'} will be declared the winner.`}
          confirmLabel="Resign"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            onResign();
          }}
        />
      )}
      {confirm === 'leave' && (
        <ConfirmDialog
          title="Leave the room?"
          body="Leaving a game in progress counts as a resignation, and you won't be able to rejoin this seat. To take a break instead, use “My games” — the game stays saved."
          confirmLabel="Leave and resign"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            onLeave();
          }}
        />
      )}
    </div>
  );
}
