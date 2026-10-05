import type { Color, PieceType } from '../../../shared/protocol';
import { PIECE_LABEL, colorName, sortCaptured } from '../lib/pieces';
import { PieceIcon } from './PieceIcon';

/** Pieces of `color` that have been taken off the board. */
export function CapturedRow({ pieces, color }: { pieces: PieceType[]; color: Color }) {
  if (pieces.length === 0) return <p className="captured-empty">No captures yet</p>;
  return (
    <ul className="captured" aria-label={`Captured ${colorName(color)} pieces`}>
      {sortCaptured(pieces).map((t, i) => (
        <li key={`${t}${i}`}>
          <PieceIcon color={color} type={t} className="captured-piece" label={`${colorName(color)} ${PIECE_LABEL[t]}`} />
        </li>
      ))}
    </ul>
  );
}
