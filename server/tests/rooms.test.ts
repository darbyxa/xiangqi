import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ack, JoinData, Notice, RoomView } from '../../shared/protocol';
import { idx } from '../src/game/engine';
import { RoomService, type Notifier } from '../src/rooms/RoomService';

class FakeNotifier implements Notifier {
  views = new Map<string, RoomView>();
  notices = new Map<string, Notice[]>();
  replacedIds: string[] = [];
  update(id: string, v: RoomView) { this.views.set(id, v); }
  notice(id: string, n: Notice) { this.notices.set(id, [...(this.notices.get(id) ?? []), n]); }
  replaced(id: string) { this.replacedIds.push(id); }
  lastNotice(id: string) { return this.notices.get(id)?.at(-1); }
}

const joined = (r: Ack<JoinData>): JoinData => {
  if (!r.ok) throw new Error(`expected success, got ${r.error}`);
  return r;
};

describe('RoomService', () => {
  let n: FakeNotifier;
  let svc: RoomService;
  const cfg = { reconnectGraceMs: 30_000, roomTtlMs: 60_000, randomColors: false };

  beforeEach(() => {
    vi.useFakeTimers();
    n = new FakeNotifier();
    svc = new RoomService(cfg, n);
  });
  afterEach(() => {
    svc.dispose();
    vi.useRealTimers();
  });

  /** helper: A creates, B joins */
  function twoPlayers() {
    const a = joined(svc.createRoom('A', 'Alice'));
    const b = joined(svc.joinRoom('B', a.code, 'Bob'));
    return { a, b };
  }

  it('creates a 6-character code and seats the host', () => {
    const a = joined(svc.createRoom('A', 'Alice'));
    expect(a.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(a.color).toBe('red'); // randomColors=false
    expect(n.views.get('A')).toMatchObject({ status: 'waiting', you: 'red' });
  });

  it('assigns the other colour to the joiner and starts the game', () => {
    const { a, b } = twoPlayers();
    expect(b.color).toBe('black');
    expect(n.views.get('A')).toMatchObject({ status: 'playing', players: { black: { name: 'Bob' } } });
    expect(n.views.get('B')).toMatchObject({ you: 'black', status: 'playing' });
    expect(n.lastNotice('A')?.kind).toBe('opponent_joined');
    expect(a.code).toBe(b.code);
  });

  it('is case-insensitive, rejects bad / unknown codes, and enforces exactly two players', () => {
    const a = joined(svc.createRoom('A', 'Alice'));
    expect(svc.joinRoom('X', 'abc', 'x')).toMatchObject({ ok: false, error: 'INVALID_CODE' });
    expect(svc.joinRoom('X', 'ZZZZZZ', 'x')).toMatchObject({ ok: false, error: 'ROOM_NOT_FOUND' });
    joined(svc.joinRoom('B', a.code.toLowerCase(), 'Bob'));
    expect(svc.joinRoom('C', a.code, 'Carol')).toMatchObject({ ok: false, error: 'ROOM_FULL' });
  });

  it('only exposes legal moves to the player whose turn it is', () => {
    twoPlayers();
    expect(Object.keys(n.views.get('A')!.legalMoves).length).toBeGreaterThan(0);
    expect(n.views.get('B')!.legalMoves).toEqual({});
  });

  it('server-side authority: wrong turn, illegal move, outsiders, bad payloads', () => {
    twoPlayers();
    expect(svc.move('B', idx(3, 0), idx(4, 0))).toMatchObject({ ok: false, error: 'NOT_YOUR_TURN' });
    expect(svc.move('A', idx(6, 0), idx(3, 0))).toMatchObject({ ok: false, error: 'ILLEGAL_MOVE' });
    expect(svc.move('nobody', idx(6, 0), idx(5, 0))).toMatchObject({ ok: false, error: 'NOT_IN_ROOM' });
    expect(svc.move('A', 'x', 5)).toMatchObject({ ok: false, error: 'INVALID_PAYLOAD' });
    expect(svc.move('A', 1.5, 5)).toMatchObject({ ok: false, error: 'INVALID_PAYLOAD' });
    expect(svc.move('A', 0, 999)).toMatchObject({ ok: false, error: 'INVALID_PAYLOAD' });
    expect(svc.move('A', idx(6, 0), idx(5, 0))).toEqual({ ok: true });
    expect(n.views.get('B')!.history).toHaveLength(1);
    expect(n.views.get('B')!.turn).toBe('black');
    expect(Object.keys(n.views.get('B')!.legalMoves).length).toBeGreaterThan(0);
  });

  it('cannot move before an opponent has joined', () => {
    joined(svc.createRoom('A', 'Alice'));
    expect(svc.move('A', idx(6, 0), idx(5, 0))).toMatchObject({ ok: false, error: 'GAME_NOT_ACTIVE' });
  });

  it('resigning ends the game and updates the scoreboard once', () => {
    twoPlayers();
    expect(svc.resign('A')).toEqual({ ok: true });
    const v = n.views.get('B')!;
    expect(v.status).toBe('finished');
    expect(v.result).toEqual({ winner: 'black', reason: 'resignation' });
    expect(v.players.black?.wins).toBe(1);
    expect(svc.resign('A')).toMatchObject({ ok: false, error: 'GAME_NOT_ACTIVE' });
    expect(n.views.get('B')!.players.black?.wins).toBe(1);
  });

  it('restart needs the opponent to accept, then swaps colours', () => {
    twoPlayers();
    svc.resign('A');
    expect(svc.respondRestart('B', true)).toMatchObject({ ok: false, error: 'NO_PENDING_REQUEST' });
    svc.requestRestart('A');
    expect(n.views.get('B')!.restartRequestedBy).toBe('red');
    expect(svc.respondRestart('A', true)).toMatchObject({ ok: false, error: 'NO_PENDING_REQUEST' }); // can't self-accept
    svc.respondRestart('B', true);
    expect(n.views.get('A')).toMatchObject({ you: 'black', status: 'playing', restartRequestedBy: null });
    expect(n.views.get('B')).toMatchObject({ you: 'red' });
    expect(n.views.get('B')!.history).toHaveLength(0);
    expect(n.views.get('B')!.players.red?.wins).toBe(1); // Bob's win carried over to his new colour
    // and the swapped seats can actually play
    expect(svc.move('B', idx(6, 0), idx(5, 0))).toEqual({ ok: true });
  });

  it('a declined restart is reported; playing on lapses a pending request', () => {
    twoPlayers();
    svc.requestRestart('A');
    svc.respondRestart('B', false);
    expect(n.lastNotice('A')?.kind).toBe('restart_declined');
    expect(n.views.get('A')!.restartRequestedBy).toBeNull();

    svc.requestRestart('B');
    expect(n.views.get('A')!.restartRequestedBy).toBe('black');
    svc.move('A', idx(6, 0), idx(5, 0));
    expect(n.views.get('A')!.restartRequestedBy).toBeNull();
  });

  describe('disconnect & reconnect', () => {
    it('keeps the seat, lets the player rejoin with their token, and tells the opponent', () => {
      const { a } = twoPlayers();
      svc.move('A', idx(6, 0), idx(5, 0));
      svc.handleDisconnect('A');
      expect(n.views.get('B')!.players.red).toMatchObject({ connected: false });
      expect(n.views.get('B')!.players.red!.reconnectMsLeft).toBe(30_000);
      expect(n.lastNotice('B')?.kind).toBe('opponent_disconnected');

      const r = joined(svc.rejoin('A2', a.code, a.token));
      expect(r.color).toBe('red');
      const v = n.views.get('A2')!;
      expect(v.history).toHaveLength(1); // the game is exactly where it was
      expect(n.views.get('B')!.players.red).toMatchObject({ connected: true, reconnectMsLeft: null });
      expect(n.lastNotice('B')?.kind).toBe('opponent_reconnected');

      // the old socket is dead, the new one can play
      expect(svc.move('A', idx(6, 2), idx(5, 2))).toMatchObject({ ok: false });
      expect(svc.move('B', idx(3, 0), idx(4, 0))).toEqual({ ok: true });
      expect(svc.move('A2', idx(6, 2), idx(5, 2))).toEqual({ ok: true });
    });

    it('rejects a wrong token or a deleted room', () => {
      const { a } = twoPlayers();
      expect(svc.rejoin('X', a.code, 'not-the-token')).toMatchObject({ ok: false, error: 'SESSION_INVALID' });
      expect(svc.rejoin('X', 'ZZZZZZ', a.token)).toMatchObject({ ok: false, error: 'ROOM_NOT_FOUND' });
    });

    it('forfeits after the grace period, but not if they come back in time', () => {
      const { a, b } = twoPlayers();
      svc.handleDisconnect('A');
      vi.advanceTimersByTime(29_000);
      expect(n.views.get('B')!.status).toBe('playing');
      svc.rejoin('A2', a.code, a.token);
      vi.advanceTimersByTime(60_000);
      expect(n.views.get('B')!.status).toBe('playing'); // timer was cancelled

      svc.handleDisconnect('B');
      vi.advanceTimersByTime(30_001);
      const v = n.views.get('A2')!;
      expect(v.status).toBe('finished');
      expect(v.result).toEqual({ winner: 'red', reason: 'disconnect' });
      expect(b.color).toBe('black');
    });

    it('opening the game in a second tab takes over the seat', () => {
      const { a } = twoPlayers();
      svc.rejoin('A-tab2', a.code, a.token);
      expect(n.replacedIds).toContain('A');
      expect(svc.move('A-tab2', idx(6, 0), idx(5, 0))).toEqual({ ok: true });
    });

    it('a host who disconnects while waiting can come back', () => {
      const a = joined(svc.createRoom('A', 'Alice'));
      svc.handleDisconnect('A');
      vi.advanceTimersByTime(120_000); // no forfeit in a waiting room
      expect(svc.rejoin('A2', a.code, a.token)).toMatchObject({ ok: true });
    });
  });

  describe('leaving & cleanup', () => {
    it('leaving a game in progress resigns; the room reopens for a new opponent', () => {
      const { a } = twoPlayers();
      svc.leave('B');
      expect(n.lastNotice('A')?.kind).toBe('opponent_left');
      expect(n.views.get('A')).toMatchObject({ status: 'waiting', players: { black: null } });
      const c = joined(svc.joinRoom('C', a.code, 'Carol'));
      expect(c.color).toBe('black');
    });

    it('the room disappears when everyone has left', () => {
      const a = joined(svc.createRoom('A', 'Alice'));
      svc.leave('A');
      expect(svc.roomCount).toBe(0);
      expect(svc.joinRoom('B', a.code, 'Bob')).toMatchObject({ ok: false, error: 'ROOM_NOT_FOUND' });
    });

    it('sweeps abandoned rooms after the TTL', () => {
      twoPlayers();
      svc.handleDisconnect('A');
      svc.handleDisconnect('B');
      vi.advanceTimersByTime(30_001); // forfeit timers fire, game over
      expect(svc.sweep()).toBe(0); // too early
      vi.advanceTimersByTime(61_000);
      expect(svc.sweep()).toBe(1);
      expect(svc.roomCount).toBe(0);
    });
  });
});
