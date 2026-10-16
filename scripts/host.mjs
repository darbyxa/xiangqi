#!/usr/bin/env node
/**
 * Hosts a game for two devices anywhere: starts the game server, opens an ngrok tunnel to it,
 * prints the public link (and a QR code for phones) and opens it in this device's browser.
 *
 * Called by play_windows.bat and play_android.sh after they've installed everything, but it
 * also works on its own:   node scripts/host.mjs   (after `npm install` and `npm run build`).
 *
 * Environment (all optional; also read from server/.env):
 *   PORT            game server port (default 3001)
 *   NGROK_DOMAIN    your reserved ngrok domain, e.g. my-name.ngrok-free.app
 *   NGROK_BIN       path to the ngrok executable (default: ngrok on PATH)
 *   NGROK_CONFIG    ngrok config file to use (default: ngrok's own)
 *   NGROK_WRAPPER   command to run ngrok through (Termux: termux-chroot, so ngrok finds DNS + certificates)
 *   TUNNEL=none     don't start ngrok (same-Wi-Fi play only)
 *   OPEN_BROWSER=0  don't open the browser
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, 'server', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const PORT = Number(process.env.PORT) || 3001;
const LOCAL = `http://localhost:${PORT}`;
const NGROK_API = 'http://127.0.0.1:4040/api/tunnels';
const isTermux = !!process.env.PREFIX?.includes('com.termux');
const dataDir = path.resolve(root, 'server', process.env.DATA_DIR || 'data');
const urlFile = path.join(dataDir, 'public-url.txt');

const children = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg = '') => console.log(msg);

async function getJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- game server

async function startServer() {
  const health = await getJson(`${LOCAL}/health`);
  if (health?.ok) {
    log(`Game server is already running on port ${PORT} — using it.`);
    return;
  }
  if (!fs.existsSync(path.join(root, 'client', 'dist', 'index.html'))) {
    throw new Error('The web app has not been built yet. Run `npm run build` first.');
  }
  const tsx = createRequire(import.meta.url).resolve('tsx/cli');
  const server = spawn(process.execPath, [tsx, 'server/src/index.ts'], { cwd: root, stdio: 'inherit' });
  children.push(server);
  server.on('exit', (code) => {
    log(`\nThe game server stopped${code ? ` (exit code ${code})` : ''}.`);
    shutdown(code ?? 0);
  });

  for (let i = 0; i < 60; i++) {
    await sleep(500);
    if ((await getJson(`${LOCAL}/health`))?.ok) return;
  }
  throw new Error(`The game server didn't start on port ${PORT}. See the messages above.`);
}

// ---------------------------------------------------------------------- ngrok

async function findTunnel() {
  const data = await getJson(NGROK_API);
  const tunnel = data?.tunnels?.find(
    (t) => t.public_url?.startsWith('https://') && String(t.config?.addr ?? '').endsWith(`:${PORT}`),
  );
  return tunnel?.public_url ?? null;
}

async function startTunnel() {
  const existing = await findTunnel();
  if (existing) {
    log('An ngrok tunnel to the game is already running — using it.');
    return existing;
  }

  const args = ['http', String(PORT), '--log', 'stdout'];
  const domain = process.env.NGROK_DOMAIN?.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (domain) args.push('--url', `https://${domain}`);
  if (process.env.NGROK_CONFIG) args.push('--config', process.env.NGROK_CONFIG);
  const bin = process.env.NGROK_BIN || 'ngrok';
  const wrapper = process.env.NGROK_WRAPPER?.trim();
  const [cmd, cmdArgs] = wrapper ? [wrapper, [bin, ...args]] : [bin, args];

  const recent = [];
  const ngrok = spawn(cmd, cmdArgs, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(ngrok);
  const keep = (chunk) => {
    for (const line of String(chunk).split('\n').filter(Boolean)) recent.push(line);
    recent.splice(0, Math.max(0, recent.length - 15));
  };
  ngrok.stdout.on('data', keep);
  ngrok.stderr.on('data', keep);
  let exited = false;
  ngrok.on('error', (err) => {
    exited = true;
    recent.push(String(err.message));
  });
  ngrok.on('exit', () => {
    exited = true;
  });

  for (let i = 0; i < 60 && !exited; i++) {
    await sleep(500);
    const url = await findTunnel();
    if (url) {
      ngrok.on('exit', () => log('\n⚠ The ngrok tunnel stopped — your opponent can no longer reach the game. Run this again to restart it.'));
      return url;
    }
  }
  const errLine = recent.map(ngrokError).find(Boolean);
  throw new Error(
    `ngrok didn't start.${errLine ? `\n  ${errLine}` : ''}\n  Last output:\n    ${recent.slice(-6).join('\n    ') || '(none)'}`,
  );
}

/** Pull a readable message out of ngrok's log lines. */
function ngrokError(line) {
  const m = line.match(/err="([^"]+)"/) ?? line.match(/(ERR_NGROK_\d+.*)/);
  if (!m) return null;
  if (/ERR_NGROK_108/.test(line)) return 'ngrok is already running elsewhere with this account (free accounts get one at a time). Close it there first.';
  if (/authtoken|ERR_NGROK_4018|ERR_NGROK_105/.test(line)) return 'ngrok rejected the authtoken. Copy it again from https://dashboard.ngrok.com/get-started/your-authtoken';
  return m[1];
}

// ---------------------------------------------------------------- the banner

function lanUrls() {
  try {
    return Object.values(os.networkInterfaces())
      .flat()
      .filter((a) => a && a.family === 'IPv4' && !a.internal)
      .map((a) => `http://${a.address}:${PORT}`);
  } catch {
    return []; // Android refuses to list interfaces
  }
}

async function printQr(url) {
  try {
    const { default: qrcode } = await import('qrcode-terminal');
    await new Promise((resolve) =>
      qrcode.generate(url, { small: true }, (qr) => {
        log(qr);
        resolve();
      }),
    );
  } catch {
    // QR code is a nicety; the link is printed anyway
  }
}

function rememberUrl(url) {
  let previous = null;
  try {
    previous = fs.readFileSync(urlFile, 'utf8').trim();
  } catch {
    // first run
  }
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(urlFile, url);
  } catch {
    // not important
  }
  return previous && previous !== url ? previous : null;
}

function openBrowser(url) {
  if (process.env.OPEN_BROWSER === '0') return;
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url]]
      : isTermux
        ? ['termux-open-url', [url]]
        : process.platform === 'darwin'
          ? ['open', [url]]
          : ['xdg-open', [url]];
  const p = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: process.platform === 'win32' });
  p.on('error', () => log(`(Couldn't open a browser automatically — open ${url} yourself.)`));
  p.unref();
}

// ---------------------------------------------------------------------- main

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill();
  setTimeout(() => process.exit(code), 500).unref();
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

try {
  await startServer();

  let url = LOCAL;
  if (process.env.TUNNEL !== 'none') {
    url = await startTunnel();
  }
  const changedFrom = url === LOCAL ? null : rememberUrl(url);

  log('\n' + '═'.repeat(64));
  log('  象棋  Xiangqi is ready to play\n');
  if (url !== LOCAL) {
    log(`  Game link:   ${url}`);
    log('\n  Open it on both devices — scan this on a phone:\n');
    await printQr(url);
    log('  • First visit on each device shows an ngrok notice: tap "Visit Site".');
    log('  • Create a room, send your opponent the code (or "Copy link").');
    log('  • Tap "Notify me" in the game to get a notification on each move.');
    if (changedFrom) {
      log(`\n  ⚠ The link changed since last time (was ${changedFrom}).`);
      log('    Send the new link to your opponent. Set NGROK_DOMAIN to keep it fixed (see README).');
    }
  } else {
    log('  No tunnel (TUNNEL=none). On the same Wi-Fi, open one of:');
    for (const u of [LOCAL, ...lanUrls()]) log(`     ${u}`);
    log('  (Notifications only work on the https ngrok link or on localhost.)');
  }
  log('\n  Games are saved: stop this any time and run it again to carry on.');
  log('  Keep this window open while you play. Press Ctrl+C to stop.');
  log('═'.repeat(64) + '\n');

  openBrowser(url);
} catch (err) {
  console.error(`\n✖ ${err instanceof Error ? err.message : err}\n`);
  shutdown(1);
}
