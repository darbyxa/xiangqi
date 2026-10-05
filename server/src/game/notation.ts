/**
 * Traditional Xiangqi notation, e.g. 炮二平五 ("cannon on file 2 moves across to file 5").
 *
 * Files are counted from each player's own right-hand side:
 *   Red   → 一…九 (Chinese numerals), file = 9 - col
 *   Black → １…９ (full-width digits), file = col + 1
 * Direction: 進 advance, 退 retreat, 平 move sideways.
 * Straight movers (K, R, C, P) give the number of steps; diagonal movers (A, E, H) give the target file.
 * If two or more identical pieces share a file they are told apart by 前/後 (front/back) instead.
 */
import type { Board, Color, PieceType, Square } from '../../../shared/protocol';
import { colOf, idx, rowOf } from './engine';

const NAMES: Record<Color, Record<PieceType, string>> = {
  red: { K: '帥', A: '仕', E: '相', H: '傌', R: '俥', C: '炮', P: '兵' },
  black: { K: '將', A: '士', E: '象', H: '馬', R: '車', C: '砲', P: '卒' },
};

const NUMBERS: Record<Color, string[]> = {
  red: ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'],
  black: ['', '１', '２', '３', '４', '５', '６', '７', '８', '９'],
};

const fileOf = (color: Color, col: number) => (color === 'red' ? 9 - col : col + 1);

/** Call BEFORE the move is applied. */
export function moveNotation(board: Board, from: Square, to: Square): string {
  const piece = board[from];
  if (!piece) return '';
  const { color, type } = piece;
  const fr = rowOf(from);
  const fc = colOf(from);
  const tr = rowOf(to);
  const tc = colOf(to);
  const nums = NUMBERS[color];

  // Identical pieces on the same file, ordered front → back from the mover's point of view.
  const rowsOnFile: number[] = [];
  for (let r = 0; r < 10; r++) {
    const p = board[idx(r, fc)];
    if (p && p.type === type && p.color === color) rowsOnFile.push(r);
  }
  if (color === 'red') rowsOnFile.sort((a, b) => a - b); // red advances toward row 0
  else rowsOnFile.sort((a, b) => b - a);

  let head: string;
  if (rowsOnFile.length > 1) {
    const rank = rowsOnFile.indexOf(fr);
    const labels =
      rowsOnFile.length === 2
        ? ['前', '後']
        : rowsOnFile.length === 3
          ? ['前', '中', '後']
          : ['一', '二', '三', '四', '五'];
    head = `${labels[rank]}${NAMES[color][type]}`;
  } else {
    head = `${NAMES[color][type]}${nums[fileOf(color, fc)]}`;
  }

  const forward = color === 'red' ? -1 : 1;
  let direction: string;
  let amount: number;
  if (tr === fr) {
    direction = '平';
    amount = fileOf(color, tc);
  } else {
    direction = Math.sign(tr - fr) === forward ? '進' : '退';
    amount = type === 'H' || type === 'E' || type === 'A' ? fileOf(color, tc) : Math.abs(tr - fr);
  }
  return `${head}${direction}${nums[amount]}`;
}
