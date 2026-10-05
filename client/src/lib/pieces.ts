import type { Color, PieceType } from '../../../shared/protocol';

const FILE_NAME: Record<PieceType, string> = {
  K: 'king',
  A: 'advisor',
  E: 'elephant',
  H: 'horse',
  R: 'rook',
  C: 'cannon',
  P: 'pawn',
};

const base = import.meta.env.BASE_URL;
export const glyphUrl = (color: Color, type: PieceType) => `${base}pieces/${color}-${FILE_NAME[type]}.svg`;
export const discUrl = (color: Color) => `${base}pieces/disc-${color}.png`;

export const PIECE_LABEL: Record<PieceType, string> = {
  K: 'general',
  A: 'advisor',
  E: 'elephant',
  H: 'horse',
  R: 'chariot',
  C: 'cannon',
  P: 'soldier',
};

export const colorName = (c: Color) => (c === 'red' ? 'Red' : 'Black');
export const other = (c: Color): Color => (c === 'red' ? 'black' : 'red');

/** Show captured pieces in a tidy order: most valuable first. */
const ORDER: PieceType[] = ['R', 'C', 'H', 'E', 'A', 'P', 'K'];
export const sortCaptured = (types: PieceType[]) => [...types].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
