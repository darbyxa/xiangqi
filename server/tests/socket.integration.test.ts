/**
 * End-to-end: a real HTTP + Socket.IO server and two real socket.io-client connections.
 */
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  Ack,
  ClientToServerEvents,
  JoinData,
  RoomView,
  ServerToClientEvents,
} from '../../shared/protocol';
import { createGameServer } from '../src/app';
import { loadConfig } from '../src/config';
import { idx } from '../src/game/engine';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: ReturnType<typeof createGameServer>;
let url: string;
const clients: Client[] = [];

function client(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const s: Client = connect(url, { transports: ['websocket'], forceNew: true });
    clients.push(s);
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}
const ask = <T extends Ack<any>>(fn: (cb: (r: T) => void) => void) => new Promise<T>((res) => fn(res));
const nextView = (s: Client, pred: (v: RoomView) => boolean = () => true) =>
  new Promise<RoomView>((resolve) => {
    const handler = (v: RoomView) => {
      if (pred(v)) {
        s.off('room:update', handler);
        resolve(v);
      }
    };
    s.on('room:update', handler);
  });

beforeAll(async () => {
  server = createGameServer({ ...loadConfig({}), port: 0, serveClient: false, randomColors: false, reconnectGraceMs: 5000, dataDir: null });
  await new Promise<void>((r) => server.httpServer.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
});
afterAll(async () => {
  clients.forEach((c) => c.disconnect());
  await server.close();
});

describe('two players over real sockets', () => {
  it('create → join → synchronised moves → illegal move rejected → reconnect', async () => {
    const red = await client();
    const black = await client();

    const created = await ask<Ack<JoinData>>((cb) => red.emit('room:create', { name: 'Alice' }, cb));
    if (!created.ok) throw new Error('create failed');
    expect(created.code).toHaveLength(6);

    const redSeesStart = nextView(red, (v) => v.status === 'playing');
    const joinedRes = await ask<Ack<JoinData>>((cb) => black.emit('room:join', { code: created.code, name: 'Bob' }, cb));
    if (!joinedRes.ok) throw new Error('join failed');
    expect(joinedRes.color).toBe('black');
    expect((await redSeesStart).players.black?.name).toBe('Bob');

    // a third player is turned away
    const carol = await client();
    const full = await ask<Ack<JoinData>>((cb) => carol.emit('room:join', { code: created.code }, cb));
    expect(full).toMatchObject({ ok: false, error: 'ROOM_FULL' });

    // illegal move and out-of-turn move are rejected by the server
    expect(await ask<Ack>((cb) => red.emit('game:move', { from: idx(6, 0), to: idx(2, 0) }, cb))).toMatchObject({ ok: false, error: 'ILLEGAL_MOVE' });
    expect(await ask<Ack>((cb) => black.emit('game:move', { from: idx(3, 0), to: idx(4, 0) }, cb))).toMatchObject({ ok: false, error: 'NOT_YOUR_TURN' });

    // legal move is broadcast to both
    const blackSees = nextView(black, (v) => v.history.length === 1);
    expect(await ask<Ack>((cb) => red.emit('game:move', { from: idx(7, 7), to: idx(7, 4) }, cb))).toEqual({ ok: true });
    const v = await blackSees;
    expect(v.history[0].notation).toBe('炮二平五');
    expect(v.turn).toBe('black');
    expect(v.board[idx(7, 4)]).toEqual({ type: 'C', color: 'red' });
    expect(v.legalMoves[idx(0, 1)]).toBeDefined();

    // red drops off and returns on a brand-new socket with the saved token
    const blackNotified = nextView(black, (x) => x.players.red?.connected === false);
    red.disconnect();
    expect((await blackNotified).players.red?.reconnectMsLeft).toBeGreaterThan(0);

    const red2 = await client();
    const back = nextView(red2);
    const rejoined = await ask<Ack<JoinData>>((cb) => red2.emit('room:rejoin', { code: created.code, token: created.token }, cb));
    expect(rejoined).toMatchObject({ ok: true, color: 'red' });
    const restored = await back;
    expect(restored.history).toHaveLength(1);
    expect(restored.players.red?.connected).toBe(true);
  });

  it('ignores garbage payloads without crashing', async () => {
    const s = await client();
    expect(await ask<Ack>((cb) => (s as any).emit('game:move', null, cb))).toMatchObject({ ok: false });
    expect(await ask<Ack>((cb) => (s as any).emit('room:join', 42, cb))).toMatchObject({ ok: false, error: 'INVALID_CODE' });
    const health = (await fetch(`${url}/health`).then((r) => r.json())) as { ok: boolean };
    expect(health.ok).toBe(true);
  });
});
