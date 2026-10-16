import { useCallback, useEffect, useRef, useState } from 'react';
import type { Ack, JoinData, Notice, RoomView } from '../../../shared/protocol';
import { currentSubscription, disablePush, enablePush, pushState, type PushState } from '../lib/push';
import { SERVER_URL, socket } from '../lib/socket';
import {
  clearSession,
  findGame,
  forgetGame,
  listGames,
  loadSession,
  rememberView,
  saveSession,
  type SavedGame,
  type SavedSession,
} from '../lib/session';

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

/** Give the server this device's push subscription for the seat we just took (no prompt; no-op if none). */
async function syncPush(): Promise<void> {
  const subscription = await currentSubscription();
  if (subscription) await call(() => socket.timeout(8000).emitWithAck('push:subscribe', { subscription }));
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
  // Every game this browser has a seat in — listed in the lobby, never taken over automatically.
  const [games, setGames] = useState<SavedGame[]>(listGames);
  const [notifications, setNotifications] = useState<PushState>('unsupported');
  const roomRef = useRef(room);
  roomRef.current = room;

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = toastId++;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const refreshGames = useCallback(() => setGames(listGames()), []);

  useEffect(() => {
    void pushState().then(setNotifications);
  }, []);

  useEffect(() => {
    const restore = async () => {
      const saved = loadSession();
      if (!saved) {
        setRestoring(false);
        return;
      }
      const res = await call(() => socket.timeout(8000).emitWithAck('room:rejoin', saved));
      if (res.ok) {
        void syncPush();
      } else if (res.error === 'ROOM_NOT_FOUND' || res.error === 'SESSION_INVALID') {
        // The game was deleted or the seat given away: forget it and show the lobby.
        clearSession();
        forgetGame(saved.code);
        refreshGames();
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
    const onUpdate = (view: RoomView) => {
      setRoom({ view, receivedAt: Date.now() });
      rememberView(view);
    };
    const onNotice = (n: Notice) => toast(n.message);
    const onReplaced = () => {
      clearSession();
      setRoom(null);
      refreshGames();
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
  }, [toast, refreshGames]);

  // ---- lobby -------------------------------------------------------------

  const seated = useCallback((data: SavedSession) => {
    saveSession({ code: data.code, token: data.token });
    void syncPush();
  }, []);

  const createRoom = useCallback(
    async (name: string): Promise<string | null> => {
      const res = await call(() => socket.timeout(8000).emitWithAck('room:create', { name }));
      if (!res.ok) return res.message;
      seated(res as { ok: true } & JoinData);
      return null;
    },
    [seated],
  );

  const joinRoom = useCallback(
    async (code: string, name: string): Promise<string | null> => {
      const res = await call(() => socket.timeout(8000).emitWithAck('room:join', { code, name }));
      if (!res.ok) return res.message;
      seated(res as { ok: true } & JoinData);
      return null;
    },
    [seated],
  );

  /** Leave for good (resigns a game in progress) and drop it from "Your games". */
  const leaveRoom = useCallback(async () => {
    const code = roomRef.current?.view.code;
    clearSession();
    if (code) forgetGame(code);
    setRoom(null);
    refreshGames();
    await call(() => socket.timeout(5000).emitWithAck('room:leave'));
  }, [refreshGames]);

  /** Back to the lobby, keeping the seat: the game stays in "Your games" and can be resumed any time. */
  const parkRoom = useCallback(async () => {
    clearSession();
    setRoom(null);
    refreshGames();
    await call(() => socket.timeout(5000).emitWithAck('room:park'));
  }, [refreshGames]);

  const resumeGame = useCallback(
    async (code: string): Promise<string | null> => {
      if (roomRef.current?.view.code === code) return null;
      const saved = findGame(code);
      if (!saved) return 'That game is no longer saved on this device.';
      const res = await call(() => socket.timeout(8000).emitWithAck('room:rejoin', saved));
      if (!res.ok) {
        if (res.error === 'ROOM_NOT_FOUND' || res.error === 'SESSION_INVALID') {
          forgetGame(code);
          refreshGames();
        }
        return res.message;
      }
      seated(saved);
      return null;
    },
    [refreshGames, seated],
  );

  const forget = useCallback(
    (code: string) => {
      forgetGame(code);
      refreshGames();
    },
    [refreshGames],
  );

  // A tapped notification while the app is already open: switch to that game.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; code?: string } | null;
      if (data?.type !== 'resume' || typeof data.code !== 'string') return;
      void resumeGame(data.code).then((err) => err && toast(err, 'error'));
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [resumeGame, toast]);

  // ---- notifications -----------------------------------------------------------

  const toggleNotifications = useCallback(async () => {
    if (notifications === 'on') {
      const endpoint = await disablePush();
      if (endpoint) await call(() => socket.timeout(8000).emitWithAck('push:unsubscribe', { endpoint }));
      setNotifications(await pushState());
      toast('Notifications turned off on this device.');
      return;
    }
    const res = await enablePush();
    if (!res.ok) {
      setNotifications(await pushState());
      toast(res.message, 'error');
      return;
    }
    const ack = await call(() => socket.timeout(8000).emitWithAck('push:subscribe', { subscription: res.subscription }));
    setNotifications('on');
    toast(ack.ok ? "Notifications on — you'll be told when it's your move." : ack.message, ack.ok ? 'info' : 'error');
  }, [notifications, toast]);

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
    games,
    resumeGame,
    forgetGame: forget,
    notifications,
    toggleNotifications,
    toasts,
    dismissToast,
    notify: toast,
    createRoom,
    joinRoom,
    leaveRoom,
    parkRoom,
    move,
    resign,
    requestRestart,
    respondRestart,
  };
}
