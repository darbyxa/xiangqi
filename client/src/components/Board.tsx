import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Color, RoomView } from '../../../shared/protocol';
import { usePieceIds } from '../hooks/usePieceIds';
import { BOARD_H, BOARD_W, CELLS_INSET, pctX, pctY, pointX, pointY } from '../lib/geometry';
import { PIECE_LABEL, colorName } from '../lib/pieces';
import { PieceIcon } from './PieceIcon';

const RED_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const BLACK_NUM = ['', '１', '２', '３', '４', '５', '６', '７', '８', '９'];

/** Cannon and soldier points get little corner marks, as on a real board. */
const MARKED: ReadonlyArray<readonly [number, number]> = [
  [2, 1], [2, 7], [7, 1], [7, 7],
  [3, 0], [3, 2], [3, 4], [3, 6], [3, 8],
  [6, 0], [6, 2], [6, 4], [6, 6], [6, 8],
];

/** The printed board: parchment, ink lines, palaces, river, file numbers (see lib/geometry.ts). */
const BoardArt = memo(function BoardArt({ flipped, viewer }: { flipped: boolean; viewer: Color }) {
  const X = pointX;
  const Y = pointY;
  const lines: ReactNode[] = [];

  for (let r = 0; r < 10; r++) lines.push(<line key={`h${r}`} x1={X(0)} y1={Y(r)} x2={X(8)} y2={Y(r)} />);
  for (let c = 0; c < 9; c++) {
    if (c === 0 || c === 8) {
      lines.push(<line key={`v${c}`} x1={X(c)} y1={Y(0)} x2={X(c)} y2={Y(9)} />);
    } else {
      lines.push(<line key={`va${c}`} x1={X(c)} y1={Y(0)} x2={X(c)} y2={Y(4)} />);
      lines.push(<line key={`vb${c}`} x1={X(c)} y1={Y(5)} x2={X(c)} y2={Y(9)} />);
    }
  }
  // palace diagonals
  lines.push(
    <line key="p1" x1={X(3)} y1={Y(0)} x2={X(5)} y2={Y(2)} />,
    <line key="p2" x1={X(5)} y1={Y(0)} x2={X(3)} y2={Y(2)} />,
    <line key="p3" x1={X(3)} y1={Y(7)} x2={X(5)} y2={Y(9)} />,
    <line key="p4" x1={X(5)} y1={Y(7)} x2={X(3)} y2={Y(9)} />,
  );

  const marks: ReactNode[] = [];
  const gap = 0.09;
  const len = 0.24;
  for (const [r, c] of MARKED) {
    for (const sx of [-1, 1]) {
      if ((c === 0 && sx === -1) || (c === 8 && sx === 1)) continue;
      for (const sy of [-1, 1]) {
        const x = X(c);
        const y = Y(r);
        marks.push(
          <polyline
            key={`m${r}-${c}-${sx}${sy}`}
            points={`${x + sx * len},${y + sy * gap} ${x + sx * gap},${y + sy * gap} ${x + sx * gap},${y + sy * len}`}
          />,
        );
      }
    }
  }

  const viewerNums = viewer === 'red' ? RED_NUM : BLACK_NUM;
  const opponentNums = viewer === 'red' ? BLACK_NUM : RED_NUM;
  const files: ReactNode[] = [];
  for (let dc = 0; dc < 9; dc++) {
    files.push(
      <text key={`fb${dc}`} transform={`translate(${X(dc)} ${BOARD_H - 0.3}) scale(0.01)`} className="file-label">
        {viewerNums[9 - dc]}
      </text>,
      <text key={`ft${dc}`} transform={`translate(${X(dc)} 0.3) scale(0.01)`} className="file-label">
        {opponentNums[dc + 1]}
      </text>,
    );
  }

  return (
    <svg className="board-art" viewBox={`0 0 ${BOARD_W} ${BOARD_H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <radialGradient id="xq-paper" cx="50%" cy="45%" r="75%">
          <stop offset="0%" stopColor="#f1e1b7" />
          <stop offset="70%" stopColor="#e6d09c" />
          <stop offset="100%" stopColor="#d3b77a" />
        </radialGradient>
        <filter id="xq-grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.22  0 0 0 0 0.1  0 0 0 0.9 -0.28" />
        </filter>
      </defs>
      <rect width={BOARD_W} height={BOARD_H} fill="url(#xq-paper)" />
      <rect width={BOARD_W} height={BOARD_H} filter="url(#xq-grain)" opacity="0.55" />
      <rect x={X(0)} y={Y(4)} width="8" height="1" className="river-tint" />
      <g className="ink">
        {lines}
        {marks}
        <rect className="frame-outer" x={X(0)} y={Y(0)} width="8" height="9" />
        <rect className="frame-inner" x="0.12" y="0.12" width={BOARD_W - 0.24} height={BOARD_H - 0.24} />
      </g>
      <text transform={`translate(${X(2)} ${Y(4.5)}) scale(0.01)`} className="river-label">{flipped ? '漢界' : '楚河'}</text>
      <text transform={`translate(${X(6)} ${Y(4.5)}) scale(0.01)`} className="river-label">{flipped ? '楚河' : '漢界'}</text>
      {files}
    </svg>
  );
});

interface Props {
  view: RoomView;
  onMove: (from: number, to: number) => Promise<boolean>;
  /** e.g. while the connection is down */
  locked?: boolean;
}

export function Board({ view, onMove, locked = false }: Props) {
  const flipped = view.you === 'black'; // every player sees their own side at the bottom
  const ids = usePieceIds(view);
  const [selected, setSelected] = useState<number | null>(null);
  const [pending, setPending] = useState(false);

  // A new position (or a restart) clears any half-made move.
  useEffect(() => {
    setSelected(null);
    setPending(false);
  }, [view.history.length, view.status, view.you, view.code]);

  const myTurn = view.status === 'playing' && view.turn === view.you && !locked && !pending;
  const targets = useMemo(
    () => new Set<number>(selected !== null ? (view.legalMoves[selected] ?? []) : []),
    [selected, view.legalMoves],
  );

  const place = (sq: number) => {
    const r = Math.floor(sq / 9);
    const c = sq % 9;
    const dr = flipped ? 9 - r : r;
    const dc = flipped ? 8 - c : c;
    return { left: `${pctX(dc)}%`, top: `${pctY(dr)}%` };
  };

  const click = async (sq: number) => {
    if (!myTurn) return;
    if (selected !== null && targets.has(sq)) {
      const from = selected;
      setSelected(null);
      setPending(true);
      const ok = await onMove(from, sq); // only a REQUEST — the server decides and pushes the new state
      if (!ok) setPending(false);
      return;
    }
    // Legal moves are supplied by the server, so a piece without any can't be picked up.
    setSelected(view.legalMoves[sq] && selected !== sq ? sq : null);
  };

  // Render pieces in a stable (id) order so React never re-parents a node mid-slide.
  const pieces = view.board
    .map((p, sq) => ({ p, sq, id: ids[sq] }))
    .filter((x): x is { p: NonNullable<typeof x.p>; sq: number; id: number } => x.p !== null)
    .sort((a, b) => a.id - b.id);

  const cells: ReactNode[] = [];
  for (let dr = 0; dr < 10; dr++) {
    for (let dc = 0; dc < 9; dc++) {
      const r = flipped ? 9 - dr : dr;
      const c = flipped ? 8 - dc : dc;
      const sq = r * 9 + c;
      const piece = view.board[sq];
      const isTarget = targets.has(sq);
      const movable = myTurn && !!view.legalMoves[sq];
      const interactive = movable || (myTurn && isTarget);
      const cls = [
        'cell',
        interactive && 'interactive',
        selected === sq && 'selected',
        isTarget && (piece ? 'capture' : 'target'),
        view.lastMove?.from === sq && 'last-from',
        view.lastMove?.to === sq && 'last-to',
      ]
        .filter(Boolean)
        .join(' ');

      if (interactive) {
        const label = piece
          ? `${colorName(piece.color)} ${PIECE_LABEL[piece.type]}${isTarget ? ', capture' : ''}`
          : 'Move here';
        cells.push(
          <button
            key={sq}
            type="button"
            className={cls}
            aria-label={label}
            aria-pressed={movable ? selected === sq : undefined}
            onClick={() => void click(sq)}
          />,
        );
      } else {
        cells.push(<div key={sq} className={cls} onClick={() => void click(sq)} />);
      }
    }
  }

  return (
    <div className="board-frame">
      <div className={`board${myTurn ? ' my-turn' : ''}`} role="group" aria-label="Xiangqi board">
        <BoardArt flipped={flipped} viewer={view.you} />
        <div className="pieces">
          {pieces.map(({ p, sq, id }) => (
            <PieceIcon
              key={id}
              color={p.color}
              type={p.type}
              className={`piece${view.inCheck === p.color && p.type === 'K' ? ' in-check' : ''}`}
              style={place(sq)}
              label={`${colorName(p.color)} ${PIECE_LABEL[p.type]}`}
            />
          ))}
        </div>
        <div className="cells" style={{ inset: CELLS_INSET }}>{cells}</div>
      </div>
    </div>
  );
}
