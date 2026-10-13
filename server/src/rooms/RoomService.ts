/**
 * Everything about rooms and seats, with no knowledge of Socket.IO.
 * The socket layer calls these methods and supplies a Notifier to push updates back out.
 *
 * Identity model
 *   - A player's SEAT is identified by a secret `token` handed out when they create/join.
 *   - The token lives in the browser's localStorage, so a page refresh or a dropped connection
 *     can reclaim the same seat via `rejoin` — the socket id changes, the seat does not.
 *
 * Persistence
 *   - `snapshot()` / `restore()` turn every room into plain JSON (no sockets, no timers), and
 *     `onChange` fires after every state change so the caller can save it. Games therefore
 *     survive a server restart and can be continued days later.
 */
import { randomUUID } from 'node:crypto';
import type {
  Ack,
  Color,
  GameStatus,
  JoinData,
  Notice,
  PushMessage,
  PushSubscriptionData,
  RoomView,
} from '../../../shared/protocol';
import { opposite } from '../game/engine';
import { XiangqiGame, type SavedGame } from '../game/XiangqiGame';
import { generateRoomCode, normalizeRoomCode } from '../utils/roomCode';

export interface Notifier {
  update(socketId: string, view: RoomView): void;
  notice(socketId: string, notice: Notice): void;
  replaced(socketId: string): void;
  /** deliver a Web Push notification to a seat's devices (optional: tests and push-less setups omit it) */
  push?(subscriptions: PushSubscriptionData[], message: PushMessage): void;
}

export interface RoomServiceConfig {
  reconnectGraceMs: number;
  roomTtlMs: number;
  randomColors: boolean;
}

interface Seat {
  color: Color;
  token: string;
  name: string;
  socketId: string | null;
  disconnectedAt: number | null;
  wins: number;
  /** devices to notify when it's this seat's move */
  push: PushSubscriptionData[];
}

interface Room {
  code: string;
  seats: Record<Color, Seat | null>;
  game: XiangqiGame;
  /** has the result of the current game already been added to the scoreboard? */
  settled: boolean;
  restartRequestedBy: Color | null;
  lastActivity: number;
  forfeitTimers: Partial<Record<Color, ReturnType<typeof setTimeout>>>;
}

type Failure = Extract<Ack, { ok: false }>;
const fail = (error: Failure['error'], message: string): Failure => ({ ok: false, error, message });
const OK: Ack = { ok: true };
/** one player rarely has more devices than this; the oldest subscription is dropped beyond it */
const MAX_PUSH_PER_SEAT = 5;

export interface RoomsSnapshot {
  version: 1;
  rooms: {
    code: string;
    seats: Record<Color, { token: string; name: string; wins: number; push: PushSubscriptionData[] } | null>;
    game: SavedGame;
    settled: boolean;
    restartRequestedBy: Color | null;
    lastActivity: number;
  }[];
}

const cleanName = (raw: unknown): string => {
  if (typeof raw !== 'string') return 'Guest';
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 20);
  return name || 'Guest';
};

export class RoomService {
  private rooms = new Map<string, Room>();
  private bySocket = new Map<string, { code: string; color: Color }>();
  /** called after anything worth saving changes */
  onChange: (() => void) | null = null;

  constructor(
    private cfg: RoomServiceConfig,
    private notify: Notifier,
    private now: () => number = Date.now,
  ) {}

  // ------------------------------------------------------------------ lobby

  createRoom(socketId: string, rawName: unknown): Ack<JoinData> {
    this.leave(socketId); // a socket can only sit in one room
    const code = generateRoomCode((c) => this.rooms.has(c));
    const color: Color = this.cfg.randomColors && Math.random() < 0.5 ? 'black' : 'red';
    const room: Room = {
      code,
      seats: { red: null, black: null },
      game: new XiangqiGame(),
      settled: false,
      restartRequestedBy: null,
      lastActivity: this.now(),
      forfeitTimers: {},
    };
    const seat = this.newSeat(color, socketId, rawName);
    room.seats[color] = seat;
    this.rooms.set(code, room);
    this.bySocket.set(socketId, { code, color });
    this.broadcast(room);
    return { ok: true, code, token: seat.token, color };
  }

  joinRoom(socketId: string, rawCode: unknown, rawName: unknown): Ack<JoinData> {
    const code = normalizeRoomCode(rawCode);
    if (!code) return fail('INVALID_CODE', 'Room codes are 6 characters long.');
    const room = this.rooms.get(code);
    if (!room) return fail('ROOM_NOT_FOUND', `No room with code ${code}. Check the code and try again.`);

    // Already seated here (e.g. a double click)? Hand back the same seat.
    const existing = this.bySocket.get(socketId);
    if (existing && existing.code === code) {
      const seat = room.seats[existing.color]!;
      return { ok: true, code, token: seat.token, color: seat.color };
    }

    const freeColor: Color | null = !room.seats.red ? 'red' : !room.seats.black ? 'black' : null;
    if (!freeColor) return fail('ROOM_FULL', 'That room already has two players.');

    this.leave(socketId);
    const seat = this.newSeat(freeColor, socketId, rawName);
    room.seats[freeColor] = seat;
    this.bySocket.set(socketId, { code, color: freeColor });

    // A fresh opponent means a fresh game and a fresh scoreboard.
    room.game = new XiangqiGame();
    room.settled = false;
    room.restartRequestedBy = null;
    for (const s of [room.seats.red, room.seats.black]) if (s) s.wins = 0;
    room.lastActivity = this.now();

    const opponent = room.seats[opposite(freeColor)];
    if (opponent?.socketId) {
      this.notify.notice(opponent.socketId, {
        kind: 'opponent_joined',
        message: `${seat.name} joined the game.`,
      });
    }
    if (opponent) {
      this.pushTo(room, opponent, {
        title: `${seat.name} joined your game`,
        body: opponent.color === 'red' ? 'You are Red — your move.' : `You are Black — ${seat.name} moves first.`,
      });
    }
    this.broadcast(room);
    return { ok: true, code, token: seat.token, color: freeColor };
  }

  /** Reclaim a seat after a refresh / reconnect. */
  rejoin(socketId: string, rawCode: unknown, token: unknown): Ack<JoinData> {
    const code = normalizeRoomCode(rawCode);
    if (!code || typeof token !== 'string') return fail('SESSION_INVALID', 'Your saved game could not be restored.');
    const room = this.rooms.get(code);
    if (!room) return fail('ROOM_NOT_FOUND', 'That game no longer exists.');
    const seat = room.seats.red?.token === token ? room.seats.red : room.seats.black?.token === token ? room.seats.black : null;
    if (!seat) return fail('SESSION_INVALID', 'Your seat in that game is no longer available.');

    const current = this.bySocket.get(socketId);
    // Switching to another of your games parks this one (it is NOT resigned).
    if (current && (current.code !== code || current.color !== seat.color)) this.handleDisconnect(socketId);

    const wasAway = seat.socketId === null;
    if (seat.socketId && seat.socketId !== socketId) {
      // The same player opened the game somewhere else — the newest connection wins.
      this.bySocket.delete(seat.socketId);
      this.notify.replaced(seat.socketId);
    }
    seat.socketId = socketId;
    seat.disconnectedAt = null;
    this.clearForfeitTimer(room, seat.color);
    this.bySocket.set(socketId, { code, color: seat.color });
    room.lastActivity = this.now();

    const opponent = room.seats[opposite(seat.color)];
    if (wasAway && opponent?.socketId) {
      this.notify.notice(opponent.socketId, {
        kind: 'opponent_reconnected',
        message: `${seat.name} is back.`,
      });
    }
    this.broadcast(room);
    return { ok: true, code, token: seat.token, color: seat.color };
  }

  /** Leave voluntarily. Leaving a game in progress counts as a resignation. */
  leave(socketId: string): Ack {
    const entry = this.bySocket.get(socketId);
    if (!entry) return OK;
    const room = this.rooms.get(entry.code);
    this.bySocket.delete(socketId);
    if (!room) return OK;

    const seat = room.seats[entry.color];
    const opponent = room.seats[opposite(entry.color)];
    const wasPlaying = this.statusOf(room) === 'playing';

    this.clearForfeitTimer(room, entry.color);
    room.seats[entry.color] = null;

    if (!opponent) {
      this.deleteRoom(room);
      return OK;
    }

    room.game = new XiangqiGame(); // fresh board while they wait for someone new
    room.settled = false;
    room.restartRequestedBy = null;
    room.lastActivity = this.now();
    if (opponent.socketId) {
      this.notify.notice(opponent.socketId, {
        kind: 'opponent_left',
        message: wasPlaying
          ? `${seat?.name ?? 'Your opponent'} left the game — you win. Share the room code to invite someone new.`
          : `${seat?.name ?? 'Your opponent'} left the room.`,
      });
    }
    this.broadcast(room);
    return OK;
  }

  // ------------------------------------------------------------- connection

  /** Step away from the game without resigning: the seat is kept and can be reclaimed with `rejoin`. */
  park(socketId: string): Ack {
    this.handleDisconnect(socketId);
    return OK;
  }

  handleDisconnect(socketId: string): void {
    const entry = this.bySocket.get(socketId);
    if (!entry) return;
    this.bySocket.delete(socketId);
    const room = this.rooms.get(entry.code);
    const seat = room?.seats[entry.color];
    if (!room || !seat || seat.socketId !== socketId) return;

    seat.socketId = null;
    seat.disconnectedAt = this.now();
    room.lastActivity = this.now();

    if (this.statusOf(room) === 'playing' && this.cfg.reconnectGraceMs > 0) {
      this.clearForfeitTimer(room, seat.color);
      const timer = setTimeout(() => this.onForfeitTimer(room.code, seat.color), this.cfg.reconnectGraceMs);
      timer.unref?.();
      room.forfeitTimers[seat.color] = timer;
    }

    const opponent = room.seats[opposite(seat.color)];
    if (opponent?.socketId) {
      this.notify.notice(opponent.socketId, {
        kind: 'opponent_disconnected',
        message:
          this.cfg.reconnectGraceMs > 0 && this.statusOf(room) === 'playing'
            ? `${seat.name} lost connection. They have ${Math.round(this.cfg.reconnectGraceMs / 1000)}s to return.`
            : `${seat.name} has gone offline. You can still move — they'll be notified.`,
      });
    }
    this.broadcast(room);
  }

  private onForfeitTimer(code: string, color: Color): void {
    const room = this.rooms.get(code);
    if (!room) return;
    delete room.forfeitTimers[color];
    const seat = room.seats[color];
    if (!seat || seat.socketId !== null || this.statusOf(room) !== 'playing') return;
    room.game.forfeit(color);
    this.settle(room);
    room.lastActivity = this.now();
    this.broadcast(room);
  }

  // ------------------------------------------------------------------- game

  move(socketId: string, from: unknown, to: unknown): Ack {
    const ctx = this.contextFor(socketId);
    if (!ctx.ok) return ctx;
    const { room, color } = ctx;
    if (!isSquare(from) || !isSquare(to)) return fail('INVALID_PAYLOAD', 'Invalid move.');
    const status = this.statusOf(room);
    if (status === 'waiting') return fail('GAME_NOT_ACTIVE', 'Waiting for an opponent to join.');
    if (status === 'finished') return fail('GAME_NOT_ACTIVE', 'The game is over.');

    const outcome = room.game.move(color, from, to);
    if (!outcome.ok) return outcome;

    room.restartRequestedBy = null; // playing on lapses any pending restart request
    room.lastActivity = this.now();
    this.settle(room);
    const mover = room.seats[color]!;
    const waiting = room.seats[opposite(color)];
    if (waiting) {
      const { notation, check } = outcome.record;
      const result = room.game.result;
      const ending = !result
        ? ''
        : result.winner === null
          ? ' The game is a draw.'
          : result.winner === waiting.color
            ? ' You win!'
            : ` ${mover.name} wins.`;
      this.pushTo(room, waiting, {
        title: result ? 'Game over' : check ? 'Check! Your move' : 'Your move',
        body: `${mover.name} played ${notation}.${ending}`,
      });
    }
    this.broadcast(room);
    return OK;
  }

  resign(socketId: string): Ack {
    const ctx = this.contextFor(socketId);
    if (!ctx.ok) return ctx;
    const { room, color } = ctx;
    if (this.statusOf(room) !== 'playing') return fail('GAME_NOT_ACTIVE', 'There is no game to resign.');
    room.game.resign(color);
    room.lastActivity = this.now();
    this.settle(room);
    const opponent = room.seats[opposite(color)];
    if (opponent) this.pushTo(room, opponent, { title: 'Game over', body: `${room.seats[color]!.name} resigned — you win!` });
    this.broadcast(room);
    return OK;
  }

  requestRestart(socketId: string): Ack {
    const ctx = this.contextFor(socketId);
    if (!ctx.ok) return ctx;
    const { room, color } = ctx;
    const opponent = room.seats[opposite(color)];
    if (!opponent) return fail('OPPONENT_ABSENT', 'Wait for an opponent to join first.');
    if (!opponent.socketId) return fail('OPPONENT_ABSENT', 'Your opponent is offline right now.');
    room.lastActivity = this.now();
    if (room.restartRequestedBy === opposite(color)) {
      this.doRestart(room); // both sides asked → just do it
      return OK;
    }
    room.restartRequestedBy = color;
    this.broadcast(room);
    return OK;
  }

  respondRestart(socketId: string, accept: unknown): Ack {
    const ctx = this.contextFor(socketId);
    if (!ctx.ok) return ctx;
    const { room, color } = ctx;
    if (typeof accept !== 'boolean') return fail('INVALID_PAYLOAD', 'Invalid response.');
    if (!room.restartRequestedBy || room.restartRequestedBy === color) {
      return fail('NO_PENDING_REQUEST', 'There is no restart request to answer.');
    }
    room.lastActivity = this.now();
    if (accept) {
      this.doRestart(room);
    } else {
      const requester = room.seats[room.restartRequestedBy];
      room.restartRequestedBy = null;
      if (requester?.socketId) {
        this.notify.notice(requester.socketId, {
          kind: 'restart_declined',
          message: 'Your opponent declined to restart.',
        });
      }
      this.broadcast(room);
    }
    return OK;
  }

  /** New game, colours swapped so nobody is always Red. */
  private doRestart(room: Room): void {
    const { red, black } = room.seats;
    if (!red || !black) return;
    room.seats = { red: black, black: red };
    room.seats.red!.color = 'red';
    room.seats.black!.color = 'black';
    for (const seat of [room.seats.red!, room.seats.black!]) {
      if (seat.socketId) this.bySocket.set(seat.socketId, { code: room.code, color: seat.color });
      this.clearForfeitTimer(room, seat.color);
    }
    room.game = new XiangqiGame();
    room.settled = false;
    room.restartRequestedBy = null;
    for (const seat of [room.seats.red!, room.seats.black!]) {
      if (seat.socketId) {
        this.notify.notice(seat.socketId, {
          kind: 'restart_accepted',
          message: `New game — you are now ${seat.color === 'red' ? 'Red' : 'Black'}.`,
        });
      }
    }
    this.broadcast(room);
  }

  // ------------------------------------------------------------------ push

  subscribePush(socketId: string, raw: unknown): Ack {
    const ctx = this.contextFor(socketId);
    if (!ctx.ok) return ctx;
    const sub = cleanSubscription(raw);
    if (!sub) return fail('INVALID_PAYLOAD', 'This browser\'s push service is not supported.');
    const seat = ctx.room.seats[ctx.color]!;
    seat.push = [...seat.push.filter((s) => s.endpoint !== sub.endpoint), sub].slice(-MAX_PUSH_PER_SEAT);
    this.changed();
    return OK;
  }

  unsubscribePush(socketId: string, endpoint: unknown): Ack {
    const ctx = this.contextFor(socketId);
    if (!ctx.ok) return ctx;
    const seat = ctx.room.seats[ctx.color]!;
    seat.push = seat.push.filter((s) => s.endpoint !== endpoint);
    this.changed();
    return OK;
  }

  /** The push service says this subscription is gone (permission revoked, browser data cleared): forget it. */
  dropPushEndpoint(endpoint: string): void {
    for (const room of this.rooms.values()) {
      for (const seat of [room.seats.red, room.seats.black]) {
        if (seat) seat.push = seat.push.filter((s) => s.endpoint !== endpoint);
      }
    }
    this.changed();
  }

  private pushTo(room: Room, seat: Seat, msg: Pick<PushMessage, 'title' | 'body'>): void {
    if (!seat.push.length || !this.notify.push) return;
    // Always sent: the service worker drops it if the game is already on screen.
    this.notify.push(seat.push, { ...msg, tag: `xiangqi-${room.code}`, url: `/?resume=${room.code}` });
  }

  // ----------------------------------------------------------- persistence

  snapshot(): RoomsSnapshot {
    const seat = (s: Seat | null) => s && { token: s.token, name: s.name, wins: s.wins, push: s.push };
    return {
      version: 1,
      rooms: [...this.rooms.values()].map((room) => ({
        code: room.code,
        seats: { red: seat(room.seats.red), black: seat(room.seats.black) },
        game: room.game.toJSON(),
        settled: room.settled,
        restartRequestedBy: room.restartRequestedBy,
        lastActivity: room.lastActivity,
      })),
    };
  }

  /** Load saved rooms. Everyone starts offline and reclaims their seat with `rejoin`. Returns how many loaded. */
  restore(snapshot: RoomsSnapshot): number {
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.rooms)) return 0;
    let loaded = 0;
    for (const saved of snapshot.rooms) {
      try {
        const room: Room = {
          code: saved.code,
          seats: { red: null, black: null },
          game: XiangqiGame.fromJSON(saved.game),
          settled: saved.settled,
          restartRequestedBy: saved.restartRequestedBy,
          lastActivity: saved.lastActivity,
          forfeitTimers: {},
        };
        for (const color of ['red', 'black'] as const) {
          const s = saved.seats[color];
          if (!s) continue;
          room.seats[color] = {
            color,
            token: s.token,
            name: cleanName(s.name),
            wins: s.wins,
            push: (s.push ?? []).map(cleanSubscription).filter((p) => p !== null),
            socketId: null,
            disconnectedAt: null, // no forfeit countdown: nobody chose to leave, the server restarted
          };
        }
        if (!room.seats.red && !room.seats.black) continue;
        this.rooms.set(room.code, room);
        loaded++;
      } catch (err) {
        console.error(`[rooms] skipped saved room ${saved?.code}:`, err);
      }
    }
    return loaded;
  }

  // ---------------------------------------------------------------- upkeep

  /** Delete rooms that nobody has been connected to for a while. Call on an interval. */
  sweep(): number {
    let removed = 0;
    const cutoff = this.now() - this.cfg.roomTtlMs;
    for (const room of [...this.rooms.values()]) {
      const anyoneConnected = !!(room.seats.red?.socketId || room.seats.black?.socketId);
      if (!anyoneConnected && room.lastActivity < cutoff) {
        this.deleteRoom(room);
        removed++;
      }
    }
    return removed;
  }

  dispose(): void {
    for (const room of this.rooms.values()) this.clearAllTimers(room);
    this.rooms.clear();
    this.bySocket.clear();
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  // --------------------------------------------------------------- helpers

  private newSeat(color: Color, socketId: string, rawName: unknown): Seat {
    return { color, token: randomUUID(), name: cleanName(rawName), socketId, disconnectedAt: null, wins: 0, push: [] };
  }

  private contextFor(socketId: string): { ok: true; room: Room; color: Color } | Failure {
    const entry = this.bySocket.get(socketId);
    const room = entry && this.rooms.get(entry.code);
    if (!entry || !room) return fail('NOT_IN_ROOM', 'You are not in a room.');
    return { ok: true, room, color: entry.color };
  }

  private statusOf(room: Room): GameStatus {
    if (!room.seats.red || !room.seats.black) return 'waiting';
    return room.game.result ? 'finished' : 'playing';
  }

  /** Add the current game's result to the scoreboard (exactly once). */
  private settle(room: Room): void {
    const result = room.game.result;
    if (!result || room.settled) return;
    room.settled = true;
    if (result.winner) {
      const winner = room.seats[result.winner];
      if (winner) winner.wins++;
    }
    this.clearForfeitTimer(room, 'red');
    this.clearForfeitTimer(room, 'black');
  }

  private clearForfeitTimer(room: Room, color: Color): void {
    const t = room.forfeitTimers[color];
    if (t) clearTimeout(t);
    delete room.forfeitTimers[color];
  }

  private clearAllTimers(room: Room): void {
    this.clearForfeitTimer(room, 'red');
    this.clearForfeitTimer(room, 'black');
  }

  private deleteRoom(room: Room): void {
    this.clearAllTimers(room);
    for (const seat of [room.seats.red, room.seats.black]) {
      if (seat?.socketId) this.bySocket.delete(seat.socketId);
    }
    this.rooms.delete(room.code);
    this.changed();
  }

  private changed(): void {
    this.onChange?.();
  }

  /** The view a particular seat is allowed to see (includes only THEIR legal moves). */
  viewFor(room: Room, color: Color): RoomView {
    const status = this.statusOf(room);
    const game = room.game;
    const playerView = (c: Color) => {
      const s = room.seats[c];
      if (!s) return null;
      const away = s.socketId === null;
      return {
        name: s.name,
        connected: !away,
        wins: s.wins,
        reconnectMsLeft:
          away && status === 'playing' && s.disconnectedAt !== null && this.cfg.reconnectGraceMs > 0
            ? Math.max(0, s.disconnectedAt + this.cfg.reconnectGraceMs - this.now())
            : null,
      };
    };
    return {
      code: room.code,
      you: color,
      status,
      board: game.board,
      turn: game.turn,
      inCheck: game.inCheck,
      lastMove: game.lastMove,
      history: game.history,
      capturedBy: game.capturedBy,
      result: game.result,
      players: { red: playerView('red'), black: playerView('black') },
      legalMoves: status === 'playing' ? game.legalMoves(color) : {},
      restartRequestedBy: room.restartRequestedBy,
    };
  }

  private broadcast(room: Room): void {
    for (const color of ['red', 'black'] as const) {
      const seat = room.seats[color];
      if (seat?.socketId) this.notify.update(seat.socketId, this.viewFor(room, color));
    }
    this.changed();
  }
}

/** Web Push services used by Chrome/Android, Firefox, Edge and Safari. Anything else is refused, so a
 *  client can't make the server send requests to an arbitrary address. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];

function cleanSubscription(raw: unknown): PushSubscriptionData | null {
  if (!raw || typeof raw !== 'object') return null;
  const { endpoint, keys } = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return null;
  if (typeof keys?.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
  if (keys.p256dh.length > 200 || keys.auth.length > 100) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !PUSH_HOSTS.some((h) => h.test(url.hostname))) return null;
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

const isSquare = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 90;
