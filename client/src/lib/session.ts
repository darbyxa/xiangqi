/**
 * Where we remember which seat is ours.
 *
 *  - sessionStorage (per TAB, survives refresh): the seat this tab is playing. Restored automatically.
 *    Being per-tab means two tabs of one browser are two independent players — handy for local testing.
 *  - localStorage (shared): the most recent seat, offered as an opt-in "Resume game" button when a
 *    tab was closed by accident. It is never restored automatically, so it can't steal a seat from
 *    another tab.
 */
const TAB_KEY = 'xiangqi.session.v1';
const LAST_KEY = 'xiangqi.lastGame.v1';
const NAME_KEY = 'xiangqi.name';
/** matches the server's default ROOM_TTL_MINUTES */
const RESUME_WINDOW_MS = 60 * 60_000;

export interface SavedSession {
  code: string;
  token: string;
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

export const loadSession = (): SavedSession | null => safe(() => parse(sessionStorage.getItem(TAB_KEY)), null);

export function saveSession(s: SavedSession): void {
  safe(() => sessionStorage.setItem(TAB_KEY, JSON.stringify(s)), undefined);
  safe(() => localStorage.setItem(LAST_KEY, JSON.stringify({ ...s, savedAt: Date.now() })), undefined);
}

export function clearSession(): void {
  const current = loadSession();
  safe(() => sessionStorage.removeItem(TAB_KEY), undefined);
  // Only forget the shared resume record if it is OUR seat (another tab may own the latest one).
  const last = loadResumable();
  if (current && last && last.token === current.token) clearResumable();
}

/** A recent seat from a tab that is no longer open, if any. */
export function loadResumable(): SavedSession | null {
  return safe(() => {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const s = parse(raw);
    const savedAt = (JSON.parse(raw) as { savedAt?: number }).savedAt ?? 0;
    return s && Date.now() - savedAt < RESUME_WINDOW_MS ? s : null;
  }, null);
}

export const clearResumable = (): void => safe(() => localStorage.removeItem(LAST_KEY), undefined);

export const loadName = (): string => safe(() => localStorage.getItem(NAME_KEY) ?? '', '');
export const saveName = (name: string): void => safe(() => localStorage.setItem(NAME_KEY, name), undefined);
