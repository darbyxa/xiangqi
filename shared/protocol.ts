/**
 * Shared wire protocol (types only — nothing in this file exists at runtime).
 * Imported by both the server and the client so the two can never drift apart.
 *
 * Board coordinates
 *   Square = row * 9 + col   (0..89)
 *   row 0 = Black's back rank (top), row 9 = Red's back rank (bottom)
 *   col 0..8 = left → right as seen by Red
 *   The river lies between row 4 and row 5.
 *   Red palace = rows 7-9, Black palace = rows 0-2, both cols 3-5.
 */

export type Color = 'red' | 'black';

/** K general · A advisor · E elephant · H horse · R rook (chariot) · C cannon · P soldier */
export type PieceType = 'K' | 'A' | 'E' | 'H' | 'R' | 'C' | 'P';

export interface Piece {
  type: PieceType;
  color: Color;
}

export type Square = number;
export type Board = (Piece | null)[];

export type GameStatus = 'waiting' | 'playing' | 'finished';

export type GameEndReason =
  | 'checkmate'
  | 'stalemate' // in Xiangqi, having no legal move is a LOSS
  | 'resignation'
  | 'disconnect'
  | 'perpetual_check'
  | 'repetition' // draw
  | 'move_limit'; // draw: 60 full moves without a capture

export interface GameResult {
  /** null = draw */
  winner: Color | null;
  reason: GameEndReason;
}

export interface MoveRecord {
  /** 1-based half-move counter */
  ply: number;
  color: Color;
  piece: PieceType;
  from: Square;
  to: Square;
  captured: PieceType | null;
  /** true if this move put the opponent in check */
  check: boolean;
  /** traditional notation, e.g. 炮二平五 */
  notation: string;
}

export interface PlayerView {
  name: string;
  connected: boolean;
  /**
   * Milliseconds until a disconnected player forfeits (measured when this view was sent), or null.
   * A duration rather than a timestamp, so differing laptop clocks can't skew the countdown.
   */
  reconnectMsLeft: number | null;
  wins: number;
}

export interface RoomView {
  code: string;
  /** the colour of the player receiving this view */
  you: Color;
  status: GameStatus;
  board: Board;
  turn: Color;
  inCheck: Color | null;
  lastMove: { from: Square; to: Square } | null;
  history: MoveRecord[];
  /** pieces each side has captured (i.e. capturedBy.red lists black pieces) */
  capturedBy: Record<Color, PieceType[]>;
  result: GameResult | null;
  players: Record<Color, PlayerView | null>;
  /** Legal destinations for each of YOUR pieces. Empty unless it is your turn. */
  legalMoves: Record<number, Square[]>;
  restartRequestedBy: Color | null;
}

export type ErrorCode =
  | 'INVALID_PAYLOAD'
  | 'INVALID_CODE'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'SESSION_INVALID'
  | 'NOT_IN_ROOM'
  | 'NOT_YOUR_TURN'
  | 'ILLEGAL_MOVE'
  | 'GAME_NOT_ACTIVE'
  | 'OPPONENT_ABSENT'
  | 'NO_PENDING_REQUEST';

export type Ack<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; error: ErrorCode; message: string };

export interface JoinData {
  code: string;
  token: string;
  color: Color;
}

export type NoticeKind =
  | 'opponent_joined'
  | 'opponent_left'
  | 'opponent_disconnected'
  | 'opponent_reconnected'
  | 'restart_declined'
  | 'restart_accepted';

export interface Notice {
  kind: NoticeKind;
  message: string;
}

/** A browser's Web Push subscription (PushSubscription.toJSON()), used to notify a player who isn't looking. */
export interface PushSubscriptionData {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** What the service worker receives in a push and turns into a system notification. */
export interface PushMessage {
  title: string;
  body: string;
  /** notifications with the same tag replace each other (one per room) */
  tag: string;
  /** page to open when the notification is tapped */
  url: string;
}

export interface ClientToServerEvents {
  'room:create': (p: { name?: string }, ack: (r: Ack<JoinData>) => void) => void;
  'room:join': (p: { code: string; name?: string }, ack: (r: Ack<JoinData>) => void) => void;
  'room:rejoin': (p: { code: string; token: string }, ack: (r: Ack<JoinData>) => void) => void;
  'room:leave': (ack: (r: Ack) => void) => void;
  /** step away from a game WITHOUT resigning (it can be resumed later from the lobby) */
  'room:park': (ack: (r: Ack) => void) => void;
  'game:move': (p: { from: number; to: number }, ack: (r: Ack) => void) => void;
  'game:resign': (ack: (r: Ack) => void) => void;
  'game:restart:request': (ack: (r: Ack) => void) => void;
  'game:restart:respond': (p: { accept: boolean }, ack: (r: Ack) => void) => void;
  /** notify this seat (on this device) when it's their move */
  'push:subscribe': (p: { subscription: PushSubscriptionData }, ack: (r: Ack) => void) => void;
  'push:unsubscribe': (p: { endpoint: string }, ack: (r: Ack) => void) => void;
}

export interface ServerToClientEvents {
  'room:update': (view: RoomView) => void;
  'room:notice': (n: Notice) => void;
  /** the same seat was claimed from another browser tab/device */
  'room:replaced': () => void;
}
