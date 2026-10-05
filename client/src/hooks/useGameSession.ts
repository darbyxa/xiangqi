import { useCallback, useEffect, useRef, useState } from 'react';
import type { Ack, JoinData, Notice, RoomView } from '../../../shared/protocol';
import { SERVER_URL, socket } from '../lib/socket';
import { clearResumable, clearSession, loadResumable, loadSession, saveSession, type SavedSession } from '../lib/session';

export type Connection = 'connecting' | 'online' | 'offline';

export interface Toast {
  id: number;
  kind: 'info' | 'error';
  text: string;
}

let toastId = 1;

/** Emit with an ack and a timeout, so a dead connection can never leave the UI hanging. */
async function call<T extends Ack<any>>(fn: () => Promise<T>): Promise<T | Extract<Ack, { ok: false }>> {
  try {
    return await fn();
  } catch {
    return { ok: false, error: 'INVALID_PAYLOAD', message: "Can't reach the game server. Check your connection." };
  }
}

/**
 * Owns the Socket.IO connection and everything derived from it.
 * The server is authoritative: `room` is simply the last validated state it pushed to us.
 */
export function useGameSession() {
  const [room, setRoom] = useState<{ view: RoomView; receivedAt: number } | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [connectError, setConnectError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<boolean>(() => loadSession() !== null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  // A seat from a tab that was closed — offered in the lobby, never taken automatically.
  const [resumable, setResumable] = useState<SavedSession | null>(() => (loadSession() ? null : loadResumable()));
  const roomRef = useRef(room);
  roomRef.current = room;

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = toastId++;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  useEffect(() => {
    const restore = async () => {
      const saved = loadSession();
      if (!saved) {
        setRestoring(false);
        return;
      }
      const res = await call(() => socket.timeout(8000).emitWithAck('room:rejoin', saved));
      if (!res.ok) {
        // Server restarted, room expired, or seat taken: forget it and show the lobby.
        clearSession();
        setRoom(null);
        toast(res.message || 'Your previous game is no longer available.', 'error');
      }
      setRestoring(false);
    };

    const onConnect = () => {
      setConnection('online');
      setConnectError(null);
      void restore(); // runs on every (re)connect: reclaims our seat with the saved token
    };
    const onDisconnect = () => setConnection('offline');
    const onConnectError = (err: Error) => {
      setConnection((c) => (c === 'online' ? 'offline' : 'connecting'));
      setConnectError(err.message);
      setRestoring(false);
    };
    const onUpdate = (view: RoomView) => setRoom({ view, receivedAt: Date.now() });
    const onNotice = (n: Notice) => toast(n.message);
    const onReplaced = () => {
      clearSession();
      setRoom(null);
      toast('This game was opened in another tab or window, which has taken over your seat.', 'error');
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('room:update', onUpdate);
    socket.on('room:notice', onNotice);
    socket.on('room:replaced', onReplaced);
    if (socket.connected) onConnect();
    else socket.connect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('room:update', onUpdate);
      socket.off('room:notice', onNotice);
      socket.off('room:replaced', onReplaced);
    };
  }, [toast]);

  // ---- lobby -------------------------------------------------------------

  const createRoom = useCallback(async (name: string): Promise<string | null> => {
    const res = await call(() => socket.timeout(8000).emitWithAck('room:create', { name }));
    if (!res.ok) return res.message;
    const data = res as { ok: true } & JoinData;
    saveSession({ code: data.code, token: data.token });
    return null;
  }, []);

  const joinRoom = useCallback(async (code: string, name: string): Promise<string | null> => {
    const res = await call(() => socket.timeout(8000).emitWithAck('room:join', { code, name }));
    if (!res.ok) return res.message;
    const data = res as { ok: true } & JoinData;
    saveSession({ code: data.code, token: data.token });
    return null;
  }, []);

  const leaveRoom = useCallback(async () => {
    clearSession();
    setRoom(null);
    await call(() => socket.timeout(5000).emitWithAck('room:leave'));
  }, []);

  const resumeGame = useCallback(async (): Promise<string | null> => {
    const saved = resumable;
    if (!saved) return null;
    const res = await call(() => socket.timeout(8000).emitWithAck('room:rejoin', saved));
    if (!res.ok) {
      clearResumable();
      setResumable(null);
      return res.message;
    }
    saveSession(saved);
    setResumable(null);
    return null;
  }, [resumable]);

  const dismissResumable = useCallback(() => {
    clearResumable();
    setResumable(null);
  }, []);

  // ---- game actions (all just *requests*; the server decides) ------------------

  const move = useCallback(
    async (from: number, to: number): Promise<boolean> => {
      const res = await call(() => socket.timeout(8000).emitWithAck('game:move', { from, to }));
      if (!res.ok) toast(res.message, 'error');
      return res.ok;
    },
    [toast],
  );

  const simple = useCallback(
    (run: () => Promise<Ack>) => async () => {
      const res = await call(run);
      if (!res.ok) toast(res.message, 'error');
    },
    [toast],
  );

  const resign = useCallback(
    () => simple(() => socket.timeout(8000).emitWithAck('game:resign'))(),
    [simple],
  );
  const requestRestart = useCallback(
    () => simple(() => socket.timeout(8000).emitWithAck('game:restart:request'))(),
    [simple],
  );
  const respondRestart = useCallback(
    (accept: boolean) => simple(() => socket.timeout(8000).emitWithAck('game:restart:respond', { accept }))(),
    [simple],
  );

  return {
    view: room?.view ?? null,
    receivedAt: room?.receivedAt ?? 0,
    connection,
    connectError,
    serverUrl: SERVER_URL || window.location.origin,
    restoring,
    resumable,
    resumeGame,
    dismissResumable,
    toasts,
    dismissToast,
    notify: toast,
    createRoom,
    joinRoom,
    leaveRoom,
    move,
    resign,
    requestRestart,
    respondRestart,
  };
}
