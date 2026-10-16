import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Load server/.env if it exists (Node's built-in loader — no dotenv dependency needed). */
export function loadEnvFile(): void {
  const file = path.join(serverDir, '.env');
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

export interface Config {
  port: number;
  host: string;
  /** exact origins, or patterns like https://*.ngrok-free.app */
  clientOrigins: string[];
  /** let Express serve the built React app (client/dist) on the same port */
  serveClient: boolean;
  clientDistDir: string;
  /** how long a disconnected player has to come back before forfeiting (0 = never forfeit) */
  reconnectGraceMs: number;
  /** abandoned rooms are deleted after this long with nobody connected */
  roomTtlMs: number;
  /** pick the host's colour at random (otherwise the host is always Red) */
  randomColors: boolean;
  /** where games and push keys are saved; null = keep everything in memory only */
  dataDir: string | null;
  /** send Web Push notifications ("your move") — needs dataDir for its keys */
  push: boolean;
  /** contact address the push services see for this server (mailto: or https:) */
  vapidSubject: string;
}

const bool = (v: string | undefined, fallback: boolean) =>
  v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
};

const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://*.ngrok-free.app',
  'https://*.ngrok-free.dev',
  'https://*.ngrok.app',
  'https://*.ngrok.io',
];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const origins = (env.CLIENT_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    port: num(env.PORT, 3001),
    host: env.HOST?.trim() || '0.0.0.0',
    clientOrigins: origins.length ? origins : DEFAULT_ORIGINS,
    serveClient: bool(env.SERVE_CLIENT, true),
    clientDistDir: path.resolve(serverDir, env.CLIENT_DIST_DIR || '../client/dist'),
    // Defaults suit correspondence play: a player who closes the app never forfeits, and an
    // unfinished game is kept for 30 days since the last move.
    reconnectGraceMs: Math.round(num(env.RECONNECT_GRACE_SECONDS, 0) * 1000),
    roomTtlMs: Math.round(num(env.ROOM_TTL_MINUTES, 30 * 24 * 60) * 60_000),
    randomColors: bool(env.RANDOM_COLORS, true),
    dataDir: bool(env.SAVE_GAMES, true) ? path.resolve(serverDir, env.DATA_DIR || 'data') : null,
    push: bool(env.PUSH_NOTIFICATIONS, true),
    vapidSubject: env.VAPID_SUBJECT?.trim() || 'mailto:xiangqi@example.com',
  };
}

/** Build an origin checker supporting "*" (allow all) and "https://*.example.com" wildcards. */
export function makeOriginMatcher(patterns: string[]): (origin: string) => boolean {
  if (patterns.includes('*')) return () => true;
  const regexes = patterns.map((p) => {
    const escaped = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^./]+');
    return new RegExp(`^${escaped}$`, 'i');
  });
  return (origin) => regexes.some((r) => r.test(origin));
}
