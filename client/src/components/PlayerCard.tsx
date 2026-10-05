import type { Color, PieceType, PlayerView } from '../../../shared/protocol';
import { useNow } from '../hooks/useNow';
import { colorName, other } from '../lib/pieces';
import { CapturedRow } from './CapturedRow';
import { PieceIcon } from './PieceIcon';

interface Props {
  color: Color;
  player: PlayerView | null;
  isYou: boolean;
  isTurn: boolean;
  /** pieces this player has captured (they belong to the opposite colour) */
  captured: PieceType[];
  /** when the view carrying `reconnectMsLeft` arrived */
  receivedAt: number;
}

const clock = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function PlayerCard({ color, player, isYou, isTurn, captured, receivedAt }: Props) {
  const counting = !!player && player.reconnectMsLeft !== null;
  const now = useNow(counting);
  const left = counting ? Math.max(0, (player!.reconnectMsLeft ?? 0) - (now - receivedAt)) : 0;

  let status: string;
  if (!player) status = 'Waiting for an opponent…';
  else if (!player.connected) status = counting ? `Offline — forfeits in ${clock(left)}` : 'Offline';
  else status = isTurn ? (isYou ? 'Your turn' : 'Thinking…') : 'Online';

  return (
    <section className={`panel player ${isTurn ? 'on-turn' : ''} ${player && !player.connected ? 'offline' : ''}`}>
      <header className="player-head">
        <PieceIcon color={color} type="K" size={46} label={`${colorName(color)} general`} />
        <div className="player-id">
          <h3>
            {player ? player.name : 'Empty seat'}
            {isYou && <span className="you-tag">you</span>}
          </h3>
          <p className={`player-status ${player?.connected ? 'online' : ''}`}>
            <span className="dot" aria-hidden="true" />
            {colorName(color)} · {status}
          </p>
        </div>
        {player && player.wins > 0 && (
          <span className="wins" title={`${player.wins} win${player.wins === 1 ? '' : 's'} in this room`}>
            {player.wins} <span aria-hidden="true">勝</span>
            <span className="sr-only"> wins</span>
          </span>
        )}
      </header>
      <div className="player-captured">
        <p className="mini-title">Captured</p>
        <CapturedRow pieces={captured} color={other(color)} />
      </div>
    </section>
  );
}
