/**
 * Board geometry, in "board units" (1 unit = distance between neighbouring points).
 * The grid of 9 × 10 points sits inside a margin that leaves room for the file numbers,
 * which would otherwise be hidden behind the back-rank pieces.
 *
 * Everything that has to line up — the SVG art, the pieces, the click layer — reads from here.
 */
export const BOARD_W = 9.2;
export const BOARD_H = 11;
/** position of file 0 / rank 0 */
export const MX = 0.6;
export const MY = 1.0;

export const pointX = (col: number) => col + MX;
export const pointY = (row: number) => row + MY;

/** centre of display column / row as a percentage of the board */
export const pctX = (displayCol: number) => (pointX(displayCol) / BOARD_W) * 100;
export const pctY = (displayRow: number) => (pointY(displayRow) / BOARD_H) * 100;

/** inset of the 9 × 10 click grid inside the board, as CSS percentages */
export const CELLS_INSET = `${(((MY - 0.5) / BOARD_H) * 100).toFixed(4)}% ${(((MX - 0.5) / BOARD_W) * 100).toFixed(4)}%`;
