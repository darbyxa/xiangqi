/**
 * One game of Xiangqi. This is the single source of truth for a match:
 * clients never mutate the board — they ask the server to play a move, and this class decides.
 */
import type {
  Board,
  Color,
  ErrorCode,
  GameEndReason,
  GameResult,
  MoveRecord,
  Piece,
  PieceType,
  Square,
} from '../../../shared/protocol';
import {
  allLegalMoves,
  applyMove,
  createInitialBoard,
  hasAnyLegalMove,
  isInCheck,
  legalMovesFrom,
  opposite,
} from './engine';
import { moveNotation } from './notation';

/** 60 full moves (120 plies) without a capture → draw (standard "natural move limit"). */
export const NO_CAPTURE_PLY_LIMIT = 120;

export type MoveOutcome =
  | { ok: true; record: MoveRecord }
  | { ok: false; error: ErrorCode; message: string };

const SYMBOL: Record<PieceType, string> = { K: 'k', A: 'a', E: 'e', H: 'h', R: 'r', C: 'c', P: 'p' };

function positionKey(board: Board, turn: Color): string {
  let s = '';
  for (const p of board) s += p ? (p.color === 'red' ? SYMBOL[p.type].toUpperCase() : SYMBOL[p.type]) : '.';
  return s + (turn === 'red' ? 'r' : 'b');
}

export class XiangqiGame {
  board: Board = createInitialBoard();
  turn: Color = 'red'; // Red always moves first
  history: MoveRecord[] = [];
  capturedBy: Record<Color, PieceType[]> = { red: [], black: [] };
  result: GameResult | null = null;
  inCheck: Color | null = null;

  /** positions[i] = position key after ply i (positions[0] = start position) */
  private positions: string[] = [positionKey(this.board, 'red')];
  private pliesSinceCapture = 0;

  /** Start from an arbitrary position (used by tests and puzzles). */
  static fromPosition(board: Board, turn: Color): XiangqiGame {
    const g = new XiangqiGame();
    g.board = board;
    g.turn = turn;
    g.positions = [positionKey(board, turn)];
    g.inCheck = isInCheck(board, turn) ? turn : null;
    return g;
  }

  get lastMove(): { from: Square; to: Square } | null {
    const m = this.history[this.history.length - 1];
    return m ? { from: m.from, to: m.to } : null;
  }

  /** Legal moves for `color`; empty if it is not their turn or the game is over. */
  legalMoves(color: Color): Record<number, Square[]> {
    if (this.result || color !== this.turn) return {};
    return allLegalMoves(this.board, color);
  }

  move(color: Color, from: Square, to: Square): MoveOutcome {
    if (this.result) return fail('GAME_NOT_ACTIVE', 'The game is already over.');
    if (color !== this.turn) return fail('NOT_YOUR_TURN', "It's not your turn.");

    const piece = this.board[from];
    if (!piece || piece.color !== color) return fail('ILLEGAL_MOVE', 'Pick one of your own pieces.');
    if (!legalMovesFrom(this.board, from).includes(to)) {
      return fail('ILLEGAL_MOVE', 'That move is not allowed.');
    }

    const notation = moveNotation(this.board, from, to);
    const captured: Piece | null = applyMove(this.board, from, to);
    const opponent = opposite(color);
    const givesCheck = isInCheck(this.board, opponent);

    const record: MoveRecord = {
      ply: this.history.length + 1,
      color,
      piece: piece.type,
      from,
      to,
      captured: captured ? captured.type : null,
      check: givesCheck,
      notation,
    };
    this.history.push(record);
    if (captured) {
      this.capturedBy[color].push(captured.type);
      this.pliesSinceCapture = 0;
    } else {
      this.pliesSinceCapture++;
    }
    this.turn = opponent;
    this.inCheck = givesCheck ? opponent : null;
    this.positions.push(positionKey(this.board, this.turn));

    this.evaluateEnd(color, givesCheck);
    return { ok: true, record };
  }

  resign(color: Color): boolean {
    return this.finish(opposite(color), 'resignation');
  }

  /** Used when a player stays disconnected past the grace period. */
  forfeit(color: Color): boolean {
    return this.finish(opposite(color), 'disconnect');
  }

  // -------------------------------------------------------------------------

  private finish(winner: Color | null, reason: GameEndReason): boolean {
    if (this.result) return false;
    this.result = { winner, reason };
    return true;
  }

  private evaluateEnd(mover: Color, givesCheck: boolean): void {
    // 1. The side to move has no legal move → they lose (checkmate, or stalemate which also loses).
    if (!hasAnyLegalMove(this.board, this.turn)) {
      this.finish(mover, givesCheck ? 'checkmate' : 'stalemate');
      return;
    }

    // 2. Repetition: the same position (same side to move) for the third time.
    const ply = this.history.length;
    const key = this.positions[ply];
    const earlier: number[] = [];
    this.positions.forEach((k, i) => {
      if (i < ply && k === key) earlier.push(i);
    });
    if (earlier.length >= 2) {
      const cycle = this.history.slice(earlier[0]); // moves that make up the repeating cycle
      const allChecks = (c: Color) => {
        const mine = cycle.filter((m) => m.color === c);
        return mine.length > 0 && mine.every((m) => m.check);
      };
      const redPerpetual = allChecks('red');
      const blackPerpetual = allChecks('black');
      if (redPerpetual && !blackPerpetual) this.finish('black', 'perpetual_check');
      else if (blackPerpetual && !redPerpetual) this.finish('red', 'perpetual_check');
      else this.finish(null, 'repetition');
      return;
    }

    // 3. Natural move limit.
    if (this.pliesSinceCapture >= NO_CAPTURE_PLY_LIMIT) this.finish(null, 'move_limit');
  }
}

function fail(error: ErrorCode, message: string): MoveOutcome {
  return { ok: false, error, message };
}
