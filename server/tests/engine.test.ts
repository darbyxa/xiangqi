import { describe, expect, it } from 'vitest';
import type { Board, Color, PieceType } from '../../shared/protocol';
import {
  allLegalMoves,
  createInitialBoard,
  generalsFacing,
  hasAnyLegalMove,
  idx,
  isInCheck,
  legalMovesFrom,
  perft,
} from '../src/game/engine';

/** Build a board from a list like ['red K 9,4', 'black K 0,3', ...] */
function boardWith(...pieces: string[]): Board {
  const b: Board = new Array(90).fill(null);
  const T: Record<string, PieceType> = { K: 'K', A: 'A', E: 'E', H: 'H', R: 'R', C: 'C', P: 'P' };
  for (const spec of pieces) {
    const [color, type, pos] = spec.split(' ');
    const [r, c] = pos.split(',').map(Number);
    b[idx(r, c)] = { color: color as Color, type: T[type] };
  }
  return b;
}
const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
const sq = (r: number, c: number) => idx(r, c);

describe('perft (reference node counts for the Xiangqi start position)', () => {
  it('matches the known values', () => {
    const board = createInitialBoard();
    expect(perft(board, 'red', 1)).toBe(44);
    expect(perft(board, 'red', 2)).toBe(1920);
    expect(perft(board, 'red', 3)).toBe(79666);
  });

  it('depth 4 = 3,290,240', () => {
    expect(perft(createInitialBoard(), 'red', 4)).toBe(3290240);
  }, 60_000);
});

describe('movement', () => {
  it('general stays inside the palace', () => {
    const b = boardWith('red K 7,3', 'black K 0,5');
    // from the palace corner: up (6,3) is outside; left (7,2) is outside → only right and down
    expect(sorted(legalMovesFrom(b, sq(7, 3)))).toEqual(sorted([sq(7, 4), sq(8, 3)]));
  });

  it('advisor moves one step diagonally inside the palace only', () => {
    const b = boardWith('red K 9,3', 'red A 8,4', 'black K 0,4');
    expect(sorted(legalMovesFrom(b, sq(8, 4)))).toEqual(sorted([sq(7, 3), sq(7, 5), sq(9, 5)]));
  });

  it('elephant cannot cross the river and is blocked at the eye', () => {
    const b = boardWith('red K 9,4', 'black K 0,3', 'red E 5,2');
    expect(sorted(legalMovesFrom(b, sq(5, 2)))).toEqual(sorted([sq(7, 0), sq(7, 4)]));
    // block the eye toward (7,4)
    b[sq(6, 3)] = { type: 'P', color: 'red' };
    expect(sorted(legalMovesFrom(b, sq(5, 2)))).toEqual([sq(7, 0)]);
  });

  it('horse leg blocking', () => {
    const b = boardWith('red K 9,4', 'black K 0,3', 'red H 5,4');
    expect(legalMovesFrom(b, sq(5, 4))).toHaveLength(8);
    b[sq(4, 4)] = { type: 'P', color: 'black' }; // blocks the two "up" jumps (capturable but leg blocked)
    const moves = legalMovesFrom(b, sq(5, 4));
    expect(moves).not.toContain(sq(3, 3));
    expect(moves).not.toContain(sq(3, 5));
    expect(moves).toHaveLength(6);
  });

  it('rook slides and captures the first enemy piece only', () => {
    const b = boardWith('red K 9,4', 'black K 0,3', 'red R 5,0', 'black P 5,3', 'black P 5,5');
    const m = legalMovesFrom(b, sq(5, 0));
    expect(m).toContain(sq(5, 3));
    expect(m).not.toContain(sq(5, 4));
  });

  it('cannon moves like a rook but captures only over exactly one screen', () => {
    const b = boardWith(
      'red K 9,4',
      'black K 0,3',
      'red C 5,0',
      'red P 5,2', // screen
      'black P 5,4', // capturable over the screen
      'black P 5,6',
    );
    const m = legalMovesFrom(b, sq(5, 0));
    expect(m).toContain(sq(5, 1));
    expect(m).not.toContain(sq(5, 2)); // cannot capture own piece
    expect(m).toContain(sq(5, 4));
    expect(m).not.toContain(sq(5, 6)); // two pieces in the way
    expect(m).not.toContain(sq(5, 3)); // cannot move onto squares behind the screen without capturing
  });

  it('soldier: forward only before the river, forward+sideways after, never backward', () => {
    const b = boardWith('red K 9,4', 'black K 0,3', 'red P 6,0', 'red P 4,4');
    expect(legalMovesFrom(b, sq(6, 0))).toEqual([sq(5, 0)]);
    expect(sorted(legalMovesFrom(b, sq(4, 4)))).toEqual(sorted([sq(3, 4), sq(4, 3), sq(4, 5)]));
  });

  it('black soldier advances downwards', () => {
    const b = boardWith('red K 9,4', 'black K 0,3', 'black P 3,2', 'black P 5,4');
    expect(legalMovesFrom(b, sq(3, 2))).toEqual([sq(4, 2)]);
    expect(sorted(legalMovesFrom(b, sq(5, 4)))).toEqual(sorted([sq(6, 4), sq(5, 3), sq(5, 5)]));
  });
});

describe('check, flying general and pins', () => {
  it('detects check by rook, cannon, horse and soldier', () => {
    expect(isInCheck(boardWith('red K 9,4', 'black K 0,3', 'black R 5,4'), 'red')).toBe(true);
    expect(isInCheck(boardWith('red K 9,4', 'black K 0,3', 'black C 5,4', 'red P 7,4'), 'red')).toBe(true);
    expect(isInCheck(boardWith('red K 9,4', 'black K 0,3', 'black C 5,4'), 'red')).toBe(false);
    expect(isInCheck(boardWith('red K 9,4', 'black K 0,3', 'black H 7,3'), 'red')).toBe(true);
    // horse leg blocked → no check
    expect(isInCheck(boardWith('red K 9,4', 'black K 0,3', 'black H 7,3', 'red A 8,3'), 'red')).toBe(false);
    expect(isInCheck(boardWith('red K 9,4', 'black K 0,3', 'black P 8,4'), 'red')).toBe(true);
    // a soldier that has crossed the river may also attack sideways
    expect(isInCheck(boardWith('red K 9,4', 'black K 0,3', 'black P 9,3'), 'red')).toBe(true);
  });

  it('flying general: generals may not face each other on an open file', () => {
    const b = boardWith('red K 9,4', 'black K 0,4');
    expect(generalsFacing(b)).toBe(true);
    b[sq(5, 4)] = { type: 'P', color: 'red' };
    expect(generalsFacing(b)).toBe(false);
  });

  it('a piece shielding the generals is pinned along the file', () => {
    // red rook is the only thing between the generals; it may slide along the file but not leave it
    const b = boardWith('red K 9,4', 'black K 0,4', 'red R 5,4');
    const moves = legalMovesFrom(b, sq(5, 4));
    expect(moves).not.toContain(sq(5, 0));
    expect(moves).not.toContain(sq(5, 8));
    expect(moves).toContain(sq(1, 4));
    expect(moves).toContain(sq(8, 4));
  });

  it('a general may not step onto a file where it would face the other general', () => {
    const b = boardWith('red K 9,4', 'black K 0,3');
    expect(legalMovesFrom(b, sq(9, 4))).not.toContain(sq(9, 3));
    expect(legalMovesFrom(b, sq(9, 4))).toContain(sq(8, 4));
  });

  it('must resolve check: only moves that remove the check are legal', () => {
    const b = boardWith('red K 9,4', 'black K 0,3', 'black R 5,4', 'red R 5,0');
    const moves = allLegalMoves(b, 'red');
    // the only ways out: capture the rook (5,0 → 5,4), or step the general off the file.
    // (9,3) would put the generals face to face on column 3, so only (9,5) is left.
    expect(moves[sq(5, 0)]).toEqual([sq(5, 4)]);
    expect(moves[sq(9, 4)]).toEqual([sq(9, 5)]);
  });

  it('detects checkmate and stalemate (no legal moves)', () => {
    // Red general boxed in by its own pieces, double rook mate from black
    const mate = boardWith(
      'red K 9,4',
      'black K 0,3',
      'black R 9,0',
      'black R 8,0',
    );
    expect(isInCheck(mate, 'red')).toBe(true);
    expect(hasAnyLegalMove(mate, 'red')).toBe(false);

    // stalemate: not in check, but nothing can move
    // red general on (9,3): (9,4) is covered by the rook on column 4, (8,3) by the rook on row 8
    const stale = boardWith('red K 9,3', 'black K 0,5', 'black R 5,4', 'black R 8,0');
    expect(isInCheck(stale, 'red')).toBe(false);
    expect(hasAnyLegalMove(stale, 'red')).toBe(false);
  });
});
