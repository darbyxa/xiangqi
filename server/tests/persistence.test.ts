import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Ack, JoinData, Notice, PushMessage, PushSubscriptionData, RoomView } from '../../shared/protocol';
import { idx } from '../src/game/engine';
import { XiangqiGame } from '../src/game/XiangqiGame';
import { RoomService, type Notifier } from '../src/rooms/RoomService';
import { RoomStore } from '../src/rooms/RoomStore';

class FakeNotifier implements Notifier {
  views = new Map<string, RoomView>();
  pushes: { subs: PushSubscriptionData[]; msg: PushMessage }[] = [];
  update(id: string, v: RoomView) { this.views.set(id, v); }
  notice(_id: string, _n: Notice) {}
  replaced() {}
  push(subs: PushSubscriptionData[], msg: PushMessage) { this.pushes.push({ subs, msg }); }
}

const joined = (r: Ack<JoinData>): JoinData => {
  if (!r.ok) throw new Error(`expected success, got ${r.error}`);
  return r;
};

const cfg = { reconnectGraceMs: 0, roomTtlMs: 60_000, randomColors: false };
const SUB: PushSubscriptionData = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: { p256dh: 'BPk', auth: 'xyz' },
};

describe('saving games', () => {
  it('a game survives a JSON round trip, including a resignation', () => {
    const g = new XiangqiGame();
    g.move('red', idx(7, 1), idx(7, 4)); // 炮八平五
    g.move('black', idx(0, 1), idx(2, 2));
    const copy = XiangqiGame.fromJSON(JSON.parse(JSON.stringify(g)));
    expect(copy.board).toEqual(g.board);
    expect(copy.history.map((m) => m.notation)).toEqual(g.history.map((m) => m.notation));
    expect(copy.turn).toBe('red');

    g.resign('red');
    expect(XiangqiGame.fromJSON(g.toJSON()).result).toEqual({ winner: 'black', reason: 'resignation' });
  });

  it('refuses a save containing an illegal move', () => {
    expect(() => XiangqiGame.fromJSON({ moves: [[idx(9, 0), idx(0, 0)]], result: null })).toThrow();
  });

  it('players reclaim their seats after a server restart and carry on', () => {
    const svc = new RoomService(cfg, new FakeNotifier());
    const a = joined(svc.createRoom('A', 'Alice'));
    const b = joined(svc.joinRoom('B', a.code, 'Bob'));
    expect(svc.move('A', idx(6, 0), idx(5, 0)).ok).toBe(true);
    const snapshot = JSON.parse(JSON.stringify(svc.snapshot()));

    const n = new FakeNotifier();
    const restarted = new RoomService(cfg, n);
    expect(restarted.restore(snapshot)).toBe(1);
    expect(restarted.rejoin('B2', b.code, b.token)).toMatchObject({ ok: true, color: 'black' });
    expect(n.views.get('B2')).toMatchObject({ status: 'playing', turn: 'black', history: [{ ply: 1 }] });
    expect(n.views.get('B2')?.players.red).toMatchObject({ name: 'Alice', connected: false, reconnectMsLeft: null });
    // Bob can move while Alice is away; she rejoins later and sees it.
    expect(restarted.move('B2', idx(3, 0), idx(4, 0)).ok).toBe(true);
    expect(restarted.rejoin('A2', a.code, a.token)).toMatchObject({ ok: true, color: 'red' });
    expect(n.views.get('A2')).toMatchObject({ turn: 'red', history: [{}, {}] });
  });

  it('RoomStore writes to disk and loads it back', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiangqi-'));
    try {
      const svc = new RoomService(cfg, new FakeNotifier());
      const store = new RoomStore(dir, svc);
      expect(store.attach()).toBe(0);
      const a = joined(svc.createRoom('A', 'Alice'));
      store.close();

      const again = new RoomService(cfg, new FakeNotifier());
      expect(new RoomStore(dir, again).attach()).toBe(1);
      expect(again.rejoin('A2', a.code, a.token)).toMatchObject({ ok: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parking a game keeps the seat without resigning', () => {
    const n = new FakeNotifier();
    const svc = new RoomService(cfg, n);
    const a = joined(svc.createRoom('A', 'Alice'));
    joined(svc.joinRoom('B', a.code, 'Bob'));
    expect(svc.park('A')).toEqual({ ok: true });
    expect(n.views.get('B')).toMatchObject({ status: 'playing', players: { red: { connected: false } } });
    expect(svc.rejoin('A', a.code, a.token)).toMatchObject({ ok: true, color: 'red' });
  });
});

describe('push notifications', () => {
  it('notifies the player whose turn it is, and only them', () => {
    const n = new FakeNotifier();
    const svc = new RoomService(cfg, n);
    const a = joined(svc.createRoom('A', 'Alice'));
    joined(svc.joinRoom('B', a.code, 'Bob'));
    expect(svc.subscribePush('B', SUB)).toEqual({ ok: true });

    svc.move('A', idx(7, 1), idx(7, 4));
    expect(n.pushes).toHaveLength(1);
    expect(n.pushes[0]).toMatchObject({
      subs: [SUB],
      msg: { title: 'Your move', body: 'Alice played 炮八平五.', tag: `xiangqi-${a.code}`, url: `/?resume=${a.code}` },
    });

    svc.move('B', idx(0, 1), idx(2, 2)); // Alice has no subscription → nothing sent
    expect(n.pushes).toHaveLength(1);
  });

  it('subscriptions survive a restart and can be removed', () => {
    const svc = new RoomService(cfg, new FakeNotifier());
    const a = joined(svc.createRoom('A', 'Alice'));
    svc.subscribePush('A', SUB);
    expect(svc.snapshot().rooms[0].seats.red?.push).toEqual([SUB]);
    svc.unsubscribePush('A', SUB.endpoint);
    expect(svc.snapshot().rooms[0].seats.red?.push).toEqual([]);
    svc.subscribePush('A', SUB);
    svc.dropPushEndpoint(SUB.endpoint);
    expect(svc.snapshot().rooms[0].seats.red?.push).toEqual([]);
    expect(a.code).toBeTruthy();
  });

  it('rejects subscriptions that are not on a known push service', () => {
    const svc = new RoomService(cfg, new FakeNotifier());
    joined(svc.createRoom('A', 'Alice'));
    for (const endpoint of ['http://fcm.googleapis.com/x', 'https://169.254.169.254/latest', 'https://evil.example/fcm.googleapis.com', 'nope']) {
      expect(svc.subscribePush('A', { ...SUB, endpoint })).toMatchObject({ ok: false, error: 'INVALID_PAYLOAD' });
    }
    expect(svc.subscribePush('A', { endpoint: SUB.endpoint })).toMatchObject({ ok: false });
    expect(svc.subscribePush('nobody', SUB)).toMatchObject({ ok: false, error: 'NOT_IN_ROOM' });
    for (const endpoint of [
      'https://updates.push.services.mozilla.com/wpush/v2/x',
      'https://wns2-par02p.notify.windows.com/w/?token=x',
      'https://web.push.apple.com/x',
    ]) {
      expect(svc.subscribePush('A', { ...SUB, endpoint })).toEqual({ ok: true });
    }
  });
});
