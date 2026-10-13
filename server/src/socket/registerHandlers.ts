import type { Server } from 'socket.io';
import type {
  Ack,
  ClientToServerEvents,
  ServerToClientEvents,
} from '../../../shared/protocol';
import type { Notifier, RoomService } from '../rooms/RoomService';

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;

/** Bridges RoomService → Socket.IO (server → client pushes). */
export function makeNotifier(io: GameServer, push?: Notifier['push']): Notifier {
  return {
    update: (socketId, view) => void io.to(socketId).emit('room:update', view),
    notice: (socketId, notice) => void io.to(socketId).emit('room:notice', notice),
    replaced: (socketId) => void io.to(socketId).emit('room:replaced'),
    push,
  };
}

type AckFn<T extends Ack<any>> = (r: T) => void;

/**
 * Wires client → server events to RoomService.
 * Clients only ever SEND INTENT (create / join / move / resign …); the service decides
 * what is legal and pushes the authoritative state back with `room:update`.
 */
export function registerHandlers(io: GameServer, service: RoomService): void {
  io.on('connection', (socket) => {
    /** Run a handler, guaranteeing the client always gets an ack and bad input never crashes the server. */
    const handle =
      <P, R extends Ack<any>>(run: (payload: P) => R) =>
      (...args: unknown[]) => {
        const ack = args[args.length - 1];
        if (typeof ack !== 'function') return; // malformed call — nothing to answer
        const payload = (args.length > 1 ? args[0] : undefined) as P;
        try {
          (ack as AckFn<R>)(run(payload));
        } catch (err) {
          console.error('[socket] handler error:', err);
          (ack as AckFn<Ack>)({ ok: false, error: 'INVALID_PAYLOAD', message: 'Something went wrong.' });
        }
      };

    const obj = (p: unknown): Record<string, unknown> =>
      p && typeof p === 'object' ? (p as Record<string, unknown>) : {};

    socket.on('room:create', handle((p) => service.createRoom(socket.id, obj(p).name)) as never);
    socket.on('room:join', handle((p) => service.joinRoom(socket.id, obj(p).code, obj(p).name)) as never);
    socket.on('room:rejoin', handle((p) => service.rejoin(socket.id, obj(p).code, obj(p).token)) as never);
    socket.on('room:leave', handle(() => service.leave(socket.id)) as never);
    socket.on('room:park', handle(() => service.park(socket.id)) as never);
    socket.on('game:move', handle((p) => service.move(socket.id, obj(p).from, obj(p).to)) as never);
    socket.on('game:resign', handle(() => service.resign(socket.id)) as never);
    socket.on('game:restart:request', handle(() => service.requestRestart(socket.id)) as never);
    socket.on('game:restart:respond', handle((p) => service.respondRestart(socket.id, obj(p).accept)) as never);
    socket.on('push:subscribe', handle((p) => service.subscribePush(socket.id, obj(p).subscription)) as never);
    socket.on('push:unsubscribe', handle((p) => service.unsubscribePush(socket.id, obj(p).endpoint)) as never);

    socket.on('disconnect', () => service.handleDisconnect(socket.id));
  });
}
