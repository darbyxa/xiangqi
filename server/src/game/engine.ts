/**
 * Pure Xiangqi rules engine. No I/O, no sockets — just board maths.
 *
 * Everything the server needs to decide "is this move legal?" lives here:
 *  - piece movement (incl. horse-leg and elephant-eye blocking, cannon screens)
 *  - river boundary (elephants stay home, soldiers gain sideways steps after crossing)
 *  - palace confinement (general, advisors)
 *  - check detection and the flying-general rule
 *  - filtering out any move that leaves your own general attacked
 */
import type { Board, Color, Piece, PieceType, Square } from '../../../shared/protocol';

export const ROWS = 10;
export const COLS = 9;

export const idx = (r: number, c: number): Square => r * COLS + c;
export const rowOf = (sq: Square): number => Math.floor(sq / COLS);
export const colOf = (sq: Square): number => sq % COLS;
export const opposite = (c: Color): Color => (c === 'red' ? 'black' : 'red');

const BACK_RANK: PieceType[] = ['R', 'H', 'E', 'A', 'K', 'A', 'E', 'H', 'R'];

export function createInitialBoard(): Board {
  const board: Board = new Array<Piece | null>(ROWS * COLS).fill(null);
  const put = (r: number, c: number, type: PieceType, color: Color) => {
    board[idx(r, c)] = { type, color };
  };
  BACK_RANK.forEach((type, c) => {
    put(0, c, type, 'black');
    put(9, c, type, 'red');
  });
  for (const c of [1, 7]) {
    put(2, c, 'C', 'black');
    put(7, c, 'C', 'red');
  }
  for (const c of [0, 2, 4, 6, 8]) {
    put(3, c, 'P', 'black');
    put(6, c, 'P', 'red');
  }
  return board;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
const DIAG: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];
/** [dRow, dCol, legDRow, legDCol] — the "leg" is the orthogonal step that must be empty */
const HORSE: ReadonlyArray<readonly [number, number, number, number]> = [
  [-2, -1, -1, 0],
  [-2, 1, -1, 0],
  [2, -1, 1, 0],
  [2, 1, 1, 0],
  [-1, -2, 0, -1],
  [1, -2, 0, -1],
  [-1, 2, 0, 1],
  [1, 2, 0, 1],
];

const inBoard = (r: number, c: number) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
const inPalace = (color: Color, r: number, c: number) =>
  c >= 3 && c <= 5 && (color === 'red' ? r >= 7 && r <= 9 : r >= 0 && r <= 2);
/** Elephants may never cross the river. */
const onOwnSide = (color: Color, r: number) => (color === 'red' ? r >= 5 : r <= 4);
/** Soldiers that have crossed the river may also step sideways. */
const hasCrossedRiver = (color: Color, r: number) => (color === 'red' ? r <= 4 : r >= 5);

// ---------------------------------------------------------------------------
// Pseudo-legal moves (ignores whether your own general ends up in check)
// ---------------------------------------------------------------------------

export function pseudoMoves(board: Board, from: Square): Square[] {
  const piece = board[from];
  if (!piece) return [];
  const { type, color } = piece;
  const r = rowOf(from);
  const c = colOf(from);
  const out: Square[] = [];
  const canLand = (nr: number, nc: number) => {
    const t = board[idx(nr, nc)];
    return !t || t.color !== color;
  };

  switch (type) {
    case 'K':
      for (const [dr, dc] of ORTHO) {
        const nr = r + dr;
        const nc = c + dc;
        if (inPalace(color, nr, nc) && canLand(nr, nc)) out.push(idx(nr, nc));
      }
      break;

    case 'A':
      for (const [dr, dc] of DIAG) {
        const nr = r + dr;
        const nc = c + dc;
        if (inPalace(color, nr, nc) && canLand(nr, nc)) out.push(idx(nr, nc));
      }
      break;

    case 'E':
      for (const [dr, dc] of DIAG) {
        const nr = r + 2 * dr;
        const nc = c + 2 * dc;
        if (!inBoard(nr, nc) || !onOwnSide(color, nr)) continue;
        if (board[idx(r + dr, c + dc)]) continue; // elephant's eye blocked
        if (canLand(nr, nc)) out.push(idx(nr, nc));
      }
      break;

    case 'H':
      for (const [dr, dc, lr, lc] of HORSE) {
        const nr = r + dr;
        const nc = c + dc;
        if (!inBoard(nr, nc)) continue;
        if (board[idx(r + lr, c + lc)]) continue; // horse's leg blocked
        if (canLand(nr, nc)) out.push(idx(nr, nc));
      }
      break;

    case 'R':
      for (const [dr, dc] of ORTHO) {
        let nr = r + dr;
        let nc = c + dc;
        while (inBoard(nr, nc)) {
          const t = board[idx(nr, nc)];
          if (!t) out.push(idx(nr, nc));
          else {
            if (t.color !== color) out.push(idx(nr, nc));
            break;
          }
          nr += dr;
          nc += dc;
        }
      }
      break;

    case 'C':
      for (const [dr, dc] of ORTHO) {
        let nr = r + dr;
        let nc = c + dc;
        let jumped = false; // have we passed the screen yet?
        while (inBoard(nr, nc)) {
          const t = board[idx(nr, nc)];
          if (!jumped) {
            if (!t) out.push(idx(nr, nc)); // plain move
            else jumped = true; // first piece becomes the screen
          } else if (t) {
            if (t.color !== color) out.push(idx(nr, nc)); // capture over the screen
            break;
          }
          nr += dr;
          nc += dc;
        }
      }
      break;

    case 'P': {
      const fwd = color === 'red' ? -1 : 1;
      if (inBoard(r + fwd, c) && canLand(r + fwd, c)) out.push(idx(r + fwd, c));
      if (hasCrossedRiver(color, r)) {
        for (const dc of [-1, 1]) {
          if (inBoard(r, c + dc) && canLand(r, c + dc)) out.push(idx(r, c + dc));
        }
      }
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Check detection
// ---------------------------------------------------------------------------

export function findGeneral(board: Board, color: Color): Square {
  const rows = color === 'red' ? [7, 8, 9] : [0, 1, 2];
  for (const r of rows) {
    for (let c = 3; c <= 5; c++) {
      const p = board[idx(r, c)];
      if (p && p.type === 'K' && p.color === color) return idx(r, c);
    }
  }
  return -1;
}

/**
 * Is `sq` attacked by any piece of colour `by`?
 * Only the attackers that can ever reach a general are considered
 * (rook, cannon, horse, soldier, and the opposing general via the flying-general rule).
 */
function isAttacked(board: Board, sq: Square, by: Color): boolean {
  const r = rowOf(sq);
  const c = colOf(sq);

  // Straight lines: rook, cannon (needs exactly one screen) and flying general.
  for (const [dr, dc] of ORTHO) {
    let nr = r + dr;
    let nc = c + dc;
    let screens = 0;
    while (inBoard(nr, nc)) {
      const t = board[idx(nr, nc)];
      if (t) {
        if (screens === 0) {
          if (t.color === by) {
            if (t.type === 'R') return true;
            if (t.type === 'K' && dc === 0) return true; // generals face each other on a file
          }
          screens = 1;
        } else {
          if (t.color === by && t.type === 'C') return true;
          break;
        }
      }
      nr += dr;
      nc += dc;
    }
  }

  // Horses (remember the leg can block).
  for (const [dr, dc] of HORSE) {
    const hr = r + dr;
    const hc = c + dc;
    if (!inBoard(hr, hc)) continue;
    const h = board[idx(hr, hc)];
    if (!h || h.color !== by || h.type !== 'H') continue;
    // The horse travels (-dr, -dc) to reach sq; its leg is the orthogonal first step of that journey.
    const legR = Math.abs(dr) === 2 ? hr - Math.sign(dr) : hr;
    const legC = Math.abs(dr) === 2 ? hc : hc - Math.sign(dc);
    if (!board[idx(legR, legC)]) return true;
  }

  // Soldiers: one step forward onto sq, or one step sideways once across the river.
  const fwd = by === 'red' ? -1 : 1;
  const behind = r - fwd;
  if (inBoard(behind, c)) {
    const p = board[idx(behind, c)];
    if (p && p.color === by && p.type === 'P') return true;
  }
  if (hasCrossedRiver(by, r)) {
    for (const dc of [-1, 1]) {
      if (!inBoard(r, c + dc)) continue;
      const p = board[idx(r, c + dc)];
      if (p && p.color === by && p.type === 'P') return true;
    }
  }

  return false;
}

/** True if `color`'s general is attacked (including by the flying-general rule). */
export function isInCheck(board: Board, color: Color): boolean {
  const g = findGeneral(board, color);
  if (g < 0) return false;
  return isAttacked(board, g, opposite(color));
}

/** True if the two generals face each other on an open file (an illegal position). */
export function generalsFacing(board: Board): boolean {
  const a = findGeneral(board, 'red');
  const b = findGeneral(board, 'black');
  if (a < 0 || b < 0 || colOf(a) !== colOf(b)) return false;
  for (let r = rowOf(b) + 1; r < rowOf(a); r++) {
    if (board[idx(r, colOf(a))]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Legal moves
// ---------------------------------------------------------------------------

/**
 * Legal destinations for the piece on `from`.
 * Briefly mutates `board` while testing each candidate; it is always restored before returning.
 */
export function legalMovesFrom(board: Board, from: Square): Square[] {
  const piece = board[from];
  if (!piece) return [];
  const out: Square[] = [];
  for (const to of pseudoMoves(board, from)) {
    const captured = board[to];
    board[to] = piece;
    board[from] = null;
    // isInCheck also covers "generals face each other", so a move that exposes
    // the flying general is rejected here too.
    const illegal = isInCheck(board, piece.color);
    board[from] = piece;
    board[to] = captured;
    if (!illegal) out.push(to);
  }
  return out;
}

/** Map of from → legal destinations for every piece of `color` that can move. */
export function allLegalMoves(board: Board, color: Color): Record<number, Square[]> {
  const result: Record<number, Square[]> = {};
  for (let sq = 0; sq < board.length; sq++) {
    const p = board[sq];
    if (!p || p.color !== color) continue;
    const moves = legalMovesFrom(board, sq);
    if (moves.length > 0) result[sq] = moves;
  }
  return result;
}

export function hasAnyLegalMove(board: Board, color: Color): boolean {
  for (let sq = 0; sq < board.length; sq++) {
    const p = board[sq];
    if (!p || p.color !== color) continue;
    if (legalMovesFrom(board, sq).length > 0) return true;
  }
  return false;
}

/** Mutates the board in place and returns whatever was captured. */
export function applyMove(board: Board, from: Square, to: Square): Piece | null {
  const captured = board[to];
  board[to] = board[from];
  board[from] = null;
  return captured;
}

/** Counts leaf nodes to `depth` plies. Used by the test-suite to validate the engine. */
export function perft(board: Board, color: Color, depth: number): number {
  if (depth === 0) return 1;
  let nodes = 0;
  for (let from = 0; from < board.length; from++) {
    const p = board[from];
    if (!p || p.color !== color) continue;
    for (const to of pseudoMoves(board, from)) {
      const captured = board[to];
      board[to] = p;
      board[from] = null;
      if (!isInCheck(board, color)) {
        nodes += depth === 1 ? 1 : perft(board, opposite(color), depth - 1);
      }
      board[from] = p;
      board[to] = captured;
    }
  }
  return nodes;
}
