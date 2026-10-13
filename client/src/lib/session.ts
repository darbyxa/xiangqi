/**
 * Where we remember which seats are ours.
 *
 *  - sessionStorage (per TAB, survives refresh): the seat this tab is playing. Restored automatically.
 *    Being per-tab means two tabs of one browser are two independent players — handy for local testing.
 *  - localStorage (shared, permanent): every game this browser has a seat in, listed in the lobby as
 *    "Your games" so you can close the app and pick any of them up again days later. A game listed
 *    there is only taken over when you press Resume (or tap its notification), so it can't steal a
 *    seat from another open tab.
 */
import type { Color, RoomView } from '../../../shared/protocol';

const TAB_KEY = 'xiangqi.session.v1';
const GAMES_KEY = 'xiangqi.games.v1';
const OLD_LAST_KEY = 'xiangqi.lastGame.v1';
const NAME_KEY = 'xiangqi.name';
/** the server forgets an idle game after 30 days by default; keep the list tidy to match */
const FORGET_AFTER_MS = 31 * 24 * 3600_000;

export interface SavedSession {
  code: string;
  token: string;
}

/** A game in the "Your games" list, with enough detail to show it without asking the server. */
export interface SavedGame extends SavedSession {
  savedAt: number;
  color?: Color;
  opponent?: string | null;
  myTurn?: boolean;
  finished?: boolean;
}

const parse = (raw: string | null): SavedSession | null => {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<SavedSession>;
    return typeof s.code === 'string' && typeof s.token === 'string' ? { code: s.code, token: s.token } : null;
  } catch {
    return null;
  }
};

const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback; // storage can be unavailable (private mode, blocked cookies)
  }
};

// ---- this tab's seat ------------------------------------------------------------

export const loadSession = (): SavedSession | null => safe(() => parse(sessionStorage.getItem(TAB_KEY)), null);

export function saveSession(s: SavedSession): void {
  safe(() => sessionStorage.setItem(TAB_KEY, JSON.stringify({ code: s.code, token: s.token })), undefined);
  upsertGame(s.code, { token: s.token });
}

/** This tab stops showing its game (the game stays in "Your games"). */
export const clearSession = (): void => safe(() => sessionStorage.removeItem(TAB_KEY), undefined);

// ---- every game this browser plays ---------------------------------------------

function readGames(): SavedGame[] {
  return safe(() => {
    const stored: unknown = JSON.parse(localStorage.getItem(GAMES_KEY) ?? '[]');
    const list = (Array.isArray(stored) ? stored : []).filter(
      (g): g is SavedGame => typeof g?.code === 'string' && typeof g.token === 'string' && typeof g.savedAt === 'number',
    );
    const old = parse(localStorage.getItem(OLD_LAST_KEY)); // from before the games list existed
    if (old && !list.some((g) => g.code === old.code)) list.push({ ...old, savedAt: Date.now() });
    return list;
  }, []);
}

function writeGames(list: SavedGame[]): void {
  safe(() => {
    localStorage.setItem(GAMES_KEY, JSON.stringify(list));
    localStorage.removeItem(OLD_LAST_KEY);
  }, undefined);
}

/** Most recently played first; long-idle games are dropped. */
export function listGames(): SavedGame[] {
  const cutoff = Date.now() - FORGET_AFTER_MS;
  return readGames()
    .filter((g) => g.savedAt > cutoff)
    .sort((a, b) => b.savedAt - a.savedAt);
}

export const findGame = (code: string): SavedGame | undefined => readGames().find((g) => g.code === code);

function upsertGame(code: string, patch: Partial<SavedGame>): void {
  const list = readGames();
  const i = list.findIndex((g) => g.code === code);
  if (i >= 0) list[i] = { ...list[i], ...patch, savedAt: Date.now() };
  else if (patch.token) list.push({ code, token: patch.token, ...patch, savedAt: Date.now() });
  writeGames(list);
}

/** Keep the lobby's summary of a game up to date with what the server last told us. */
export function rememberView(view: RoomView): void {
  const saved = findGame(view.code);
  const summary = {
    color: view.you,
    opponent: view.players[view.you === 'red' ? 'black' : 'red']?.name ?? null,
    myTurn: view.status === 'playing' && view.turn === view.you,
    finished: view.status === 'finished',
  };
  if (saved && Object.entries(summary).every(([k, v]) => saved[k as keyof SavedGame] === v)) return;
  upsertGame(view.code, summary);
}

export const forgetGame = (code: string): void => writeGames(readGames().filter((g) => g.code !== code));

/**
 * Opened from a notification (/?resume=CODE)? Make that game this tab's game, so the restore on
 * connect drops straight into it. Removes the parameter from the address bar either way.
 */
export function adoptResumeLink(): void {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('resume');
  if (!code) return;
  const game = findGame(code.toUpperCase());
  if (game) safe(() => sessionStorage.setItem(TAB_KEY, JSON.stringify({ code: game.code, token: game.token })), undefined);
  params.delete('resume');
  const rest = params.toString();
  window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
}

export const loadName = (): string => safe(() => localStorage.getItem(NAME_KEY) ?? '', '');
export const saveName = (name: string): void => safe(() => localStorage.setItem(NAME_KEY, name), undefined);
