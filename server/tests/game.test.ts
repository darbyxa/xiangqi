import { describe, expect, it } from 'vitest';
import type { Board, Color, PieceType } from '../../shared/protocol';
import { idx } from '../src/game/engine';
import { XiangqiGame } from '../src/game/XiangqiGame';

const sq = idx;
function boardWith(...pieces: string[]): Board {
  const b: Board = new Array(90).fill(null);
  for (const spec of pieces) {
    const [color, type, pos] = spec.split(' ');
    const [r, c] = pos.split(',').map(Number);
    b[idx(r, c)] = { color: color as Color, type: type as PieceType };
  }
  return b;
}

describe('turn order and move validation', () => {
  it('red moves first and turns alternate', () => {
    const g = new XiangqiGame();
    expect(g.turn).toBe('red');
    expect(g.move('black', sq(3, 0), sq(4, 0))).toMatchObject({ ok: false, error: 'NOT_YOUR_TURN' });
    expect(g.move('red', sq(6, 0), sq(5, 0)).ok).toBe(true);
    expect(g.turn).toBe('black');
    expect(g.move('red', sq(6, 2), sq(5, 2))).toMatchObject({ ok: false, error: 'NOT_YOUR_TURN' });
  });

  it("rejects moving an opponent's piece, an empty square, or an impossible geometry", () => {
    const g = new XiangqiGame();
    expect(g.move('red', sq(3, 0), sq(4, 0))).toMatchObject({ ok: false, error: 'ILLEGAL_MOVE' });
    expect(g.move('red', sq(5, 5), sq(4, 5))).toMatchObject({ ok: false, error: 'ILLEGAL_MOVE' });
    expect(g.move('red', sq(9, 0), sq(5, 0))).toMatchObject({ ok: false, error: 'ILLEGAL_MOVE' }); // rook jumping own pawn
    expect(g.move('red', sq(9, 1), sq(7, 3))).toMatchObject({ ok: false, error: 'ILLEGAL_MOVE' }); // not a horse-shaped move
    expect(g.history).toHaveLength(0);
  });

  it('tracks captures and last move', () => {
    const g = new XiangqiGame();
    // Red cannon takes the black horse across the board: (7,7) → (0,7)
    const r = g.move('red', sq(7, 7), sq(0, 7));
    expect(r).toMatchObject({ ok: true, record: { captured: 'H', piece: 'C', notation: '炮二進七' } });
    expect(g.capturedBy.red).toEqual(['H']);
    expect(g.lastMove).toEqual({ from: sq(7, 7), to: sq(0, 7) });
  });

  it('refuses a move that leaves your own general in check', () => {
    // black rook checks red along the file; red soldier tries to wander off instead of answering
    const g = XiangqiGame.fromPosition(
      boardWith('red K 9,4', 'black K 0,3', 'black R 5,4', 'red P 6,0'),
      'red',
    );
    expect(g.inCheck).toBe('red');
    expect(g.move('red', sq(6, 0), sq(5, 0))).toMatchObject({ ok: false, error: 'ILLEGAL_MOVE' });
    expect(g.move('red', sq(9, 4), sq(9, 5)).ok).toBe(true);
  });

  it('refuses a move that exposes the flying general', () => {
    const g = XiangqiGame.fromPosition(boardWith('red K 9,4', 'black K 0,4', 'red R 5,4'), 'red');
    expect(g.move('red', sq(5, 4), sq(5, 0))).toMatchObject({ ok: false, error: 'ILLEGAL_MOVE' });
    expect(g.move('red', sq(5, 4), sq(1, 4)).ok).toBe(true); // stays on the file
  });
});

describe('end of game', () => {
  it('checkmate', () => {
    const g = XiangqiGame.fromPosition(
      boardWith('red K 9,3', 'black K 0,4', 'red R 1,0', 'red R 5,1'),
      'red',
    );
    const r = g.move('red', sq(5, 1), sq(0, 1));
    expect(r.ok && r.record.check).toBe(true);
    expect(g.result).toEqual({ winner: 'red', reason: 'checkmate' });
    expect(g.move('black', sq(0, 4), sq(0, 5))).toMatchObject({ ok: false, error: 'GAME_NOT_ACTIVE' });
  });

  it('stalemate is a LOSS for the player who cannot move', () => {
    const g = XiangqiGame.fromPosition(
      boardWith('red K 9,3', 'black K 0,5', 'black R 5,4', 'black R 8,1'),
      'black',
    );
    g.move('black', sq(8, 1), sq(8, 0));
    expect(g.inCheck).toBeNull();
    expect(g.result).toEqual({ winner: 'black', reason: 'stalemate' });
  });

  it('resignation and forfeit', () => {
    const a = new XiangqiGame();
    expect(a.resign('red')).toBe(true);
    expect(a.result).toEqual({ winner: 'black', reason: 'resignation' });
    expect(a.resign('black')).toBe(false); // already over

    const b = new XiangqiGame();
    b.forfeit('black');
    expect(b.result).toEqual({ winner: 'red', reason: 'disconnect' });
  });

  it('threefold repetition is a draw', () => {
    const g = XiangqiGame.fromPosition(
      boardWith('red K 9,3', 'black K 0,4', 'red R 5,8', 'black R 4,0'),
      'red',
    );
    const cycle: [Color, number, number][] = [
      ['red', sq(5, 8), sq(6, 8)],
      ['black', sq(4, 0), sq(5, 0)],
      ['red', sq(6, 8), sq(5, 8)],
      ['black', sq(5, 0), sq(4, 0)],
    ];
    for (let lap = 0; lap < 2; lap++) for (const [c, f, t] of cycle) expect(g.move(c, f, t).ok).toBe(true);
    expect(g.result).toEqual({ winner: null, reason: 'repetition' });
  });

  it('perpetual check loses for the checking side', () => {
    const g = XiangqiGame.fromPosition(boardWith('red K 9,3', 'black K 0,4', 'red R 1,8'), 'red');
    const cycle: [Color, number, number][] = [
      ['red', sq(1, 8), sq(0, 8)], // check along row 0
      ['black', sq(0, 4), sq(1, 4)],
      ['red', sq(0, 8), sq(1, 8)], // check along row 1
      ['black', sq(1, 4), sq(0, 4)],
    ];
    for (let lap = 0; lap < 2; lap++) for (const [c, f, t] of cycle) expect(g.move(c, f, t).ok).toBe(true);
    expect(g.result).toEqual({ winner: 'black', reason: 'perpetual_check' });
  });

  it('draws after 60 full moves without a capture', () => {
    const g = XiangqiGame.fromPosition(boardWith('red K 9,4', 'black K 0,3', 'red R 5,0'), 'red');
    (g as unknown as { pliesSinceCapture: number }).pliesSinceCapture = 119;
    g.move('red', sq(5, 0), sq(5, 1));
    expect(g.result).toEqual({ winner: null, reason: 'move_limit' });
  });
});

describe('notation', () => {
  const notate = (g: XiangqiGame, color: Color, from: number, to: number) => {
    const r = g.move(color, from, to);
    if (!r.ok) throw new Error(r.message);
    return r.record.notation;
  };

  it('opening moves', () => {
    const g = new XiangqiGame();
    expect(notate(g, 'red', sq(7, 7), sq(7, 4))).toBe('炮二平五'); // the classic central cannon
    expect(notate(g, 'black', sq(0, 1), sq(2, 2))).toBe('馬２進３');
    expect(notate(g, 'red', sq(9, 7), sq(7, 6))).toBe('傌二進三');
    expect(notate(g, 'black', sq(3, 4), sq(4, 4))).toBe('卒５進１');
  });

  it('retreats, and front/back for twin pieces on one file', () => {
    const g = XiangqiGame.fromPosition(
      boardWith('red K 9,4', 'black K 0,3', 'red R 5,0', 'red R 8,0'),
      'red',
    );
    expect(notate(g, 'red', sq(5, 0), sq(7, 0))).toBe('前俥退二'); // front rook retreats 2
  });
});
