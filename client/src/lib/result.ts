import type { RoomView } from '../../../shared/protocol';
import { colorName, other } from './pieces';

export interface ResultText {
  /** big calligraphy glyph */
  glyph: string;
  headline: string;
  detail: string;
  tone: 'win' | 'loss' | 'draw';
}

export function describeResult(view: RoomView): ResultText | null {
  const r = view.result;
  if (!r) return null;
  const nameOf = (c: 'red' | 'black') => view.players[c]?.name ?? colorName(c);

  if (r.winner === null) {
    return {
      glyph: '和',
      headline: 'Draw',
      tone: 'draw',
      detail:
        r.reason === 'move_limit'
          ? 'Sixty moves each without a capture.'
          : 'The same position appeared three times.',
    };
  }
  const winner = r.winner;
  const loser = other(winner);
  const won = winner === view.you;
  const detail =
    r.reason === 'checkmate'
      ? `${nameOf(winner)} (${colorName(winner)}) wins by checkmate.`
      : r.reason === 'stalemate'
        ? `${nameOf(loser)} (${colorName(loser)}) has no legal move — in Xiangqi that is a loss.`
        : r.reason === 'resignation'
          ? `${nameOf(loser)} (${colorName(loser)}) resigned.`
          : r.reason === 'disconnect'
            ? `${nameOf(loser)} (${colorName(loser)}) left and didn't return in time.`
            : `${nameOf(loser)} (${colorName(loser)}) kept giving perpetual check.`;
  return { glyph: won ? '勝' : '敗', headline: won ? 'You win' : 'You lose', tone: won ? 'win' : 'loss', detail };
}

export function statusLine(view: RoomView): { text: string; sub: string } {
  if (view.status === 'waiting') return { text: 'Waiting for opponent', sub: 'Share the room code to begin.' };
  if (view.status === 'finished') {
    const r = describeResult(view);
    return { text: r?.headline ?? 'Game over', sub: r?.detail ?? '' };
  }
  const yourTurn = view.turn === view.you;
  return {
    text: yourTurn ? 'Your move' : `${view.players[view.turn]?.name ?? colorName(view.turn)}'s move`,
    sub: view.inCheck
      ? view.inCheck === view.you
        ? 'You are in check!'
        : `${colorName(view.inCheck)} is in check.`
      : `${colorName(view.turn)} to play.`,
  };
}
