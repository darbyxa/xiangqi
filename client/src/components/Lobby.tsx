import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Connection } from '../hooks/useGameSession';
import { colorName } from '../lib/pieces';
import { loadName, saveName, type SavedGame } from '../lib/session';
import { PieceIcon } from './PieceIcon';

interface Props {
  connection: Connection;
  connectError: string | null;
  serverUrl: string;
  onCreate: (name: string) => Promise<string | null>;
  onJoin: (code: string, name: string) => Promise<string | null>;
  games: SavedGame[];
  onResume: (code: string) => Promise<string | null>;
  onForget: (code: string) => void;
}

function gameSummary(g: SavedGame): string {
  if (g.finished) return 'Finished';
  if (g.opponent === null) return 'Waiting for an opponent to join';
  if (g.myTurn === undefined) return 'In progress';
  return g.myTurn ? 'Your move' : `Waiting for ${g.opponent ?? 'your opponent'}`;
}

const CODE_CHARS = /[^A-HJ-NP-Z2-9]/g;

export function Lobby({ connection, connectError, serverUrl, onCreate, onJoin, games, onResume, onForget }: Props) {
  const invited = new URLSearchParams(window.location.search).get('room') ?? '';
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState(() => invited.toUpperCase().replace(CODE_CHARS, '').slice(0, 6));
  const [busy, setBusy] = useState<'create' | 'join' | 'resume' | null>(null);
  const [error, setError] = useState<{ where: 'create' | 'join' | 'resume'; text: string } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (invited) nameRef.current?.focus(); // arrived from an invite link: just ask for a name and go
  }, [invited]);

  const online = connection === 'online';

  const run = async (where: 'create' | 'join', e: FormEvent) => {
    e.preventDefault();
    if (!online || busy) return;
    saveName(name.trim());
    setBusy(where);
    setError(null);
    const err = where === 'create' ? await onCreate(name.trim()) : await onJoin(code, name.trim());
    setBusy(null);
    if (err) setError({ where, text: err });
    else if (invited) window.history.replaceState(null, '', window.location.pathname);
  };

  return (
    <main className="lobby">
      <section className="hero" aria-label="Xiangqi Online">
        <div className="hero-pieces" aria-hidden="true">
          <PieceIcon color="black" type="K" className="hero-piece b" />
          <PieceIcon color="red" type="K" className="hero-piece r" />
        </div>
        <h1>
          <span className="hero-glyph" aria-hidden="true">象棋</span>
          <span className="sr-only">Xiangqi</span>
        </h1>
        <p className="tagline">Chinese chess for two — across a table or across the world.</p>
      </section>

      <div className="lobby-forms">
        {games.length > 0 && (
          <div className="panel resume">
            <h2>Your games</h2>
            <ul className="saved-games">
              {games.map((g) => (
                <li key={g.code} className={g.myTurn && !g.finished ? 'my-turn' : ''}>
                  <div className="saved-game-info">
                    <strong className="code">{g.code}</strong>
                    <span>
                      {g.opponent ? `vs ${g.opponent}` : ''}
                      {g.color ? `${g.opponent ? ' · ' : ''}you are ${colorName(g.color)}` : ''}
                    </span>
                    <span className="saved-game-status">{gameSummary(g)}</span>
                  </div>
                  <div className="row">
                    <button
                      type="button"
                      className={`btn small ${g.myTurn && !g.finished ? 'primary' : ''}`}
                      disabled={!online || busy !== null}
                      onClick={async () => {
                        setBusy('resume');
                        setError(null);
                        const err = await onResume(g.code);
                        setBusy(null);
                        if (err) setError({ where: 'resume', text: err });
                      }}
                    >
                      {g.finished ? 'Open' : 'Resume'}
                    </button>
                    {g.finished && (
                      <button type="button" className="btn ghost small" onClick={() => onForget(g.code)}>Remove</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {error?.where === 'resume' && <p className="form-error" role="alert">{error.text}</p>}
          </div>
        )}

        <div className="panel name-panel">
          <label htmlFor="name">Your name</label>
          <input
            id="name"
            ref={nameRef}
            value={name}
            maxLength={20}
            autoComplete="nickname"
            placeholder="Guest"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <form className="panel" onSubmit={(e) => void run('create', e)}>
          <h2>Start a game</h2>
          <p>You'll get a six-character room code to send to your opponent. Colours are assigned automatically.</p>
          <button type="submit" className="btn primary wide" disabled={!online || busy !== null}>
            {busy === 'create' ? 'Creating…' : 'Create room'}
          </button>
          {error?.where === 'create' && <p className="form-error" role="alert">{error.text}</p>}
        </form>

        <form className="panel" onSubmit={(e) => void run('join', e)}>
          <h2>Join a game</h2>
          <label htmlFor="code">Room code</label>
          <input
            id="code"
            className="code-input"
            value={code}
            maxLength={6}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="K7XM2P"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(CODE_CHARS, ''))}
          />
          <button type="submit" className="btn primary wide" disabled={!online || busy !== null || code.length !== 6}>
            {busy === 'join' ? 'Joining…' : 'Join room'}
          </button>
          {error?.where === 'join' && <p className="form-error" role="alert">{error.text}</p>}
        </form>

        <p className={`conn-line ${connection}`} role="status">
          <span className="dot" aria-hidden="true" />
          {online
            ? 'Connected to the server'
            : connectError
              ? `Can't reach the server at ${serverUrl} (${connectError}). Is it running?`
              : 'Connecting to the server…'}
        </p>
      </div>
    </main>
  );
}
