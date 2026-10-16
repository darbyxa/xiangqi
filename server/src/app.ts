import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/protocol';
import { makeOriginMatcher, type Config } from './config';
import { WebPush } from './push/WebPush';
import { RoomService } from './rooms/RoomService';
import { RoomStore } from './rooms/RoomStore';
import { makeNotifier, registerHandlers } from './socket/registerHandlers';

export function createGameServer(config: Config) {
  const app = express();
  const httpServer = http.createServer(app);
  const originAllowed = makeOriginMatcher(config.clientOrigins);
  const corsOrigin = (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) =>
    cb(null, !origin || originAllowed(origin)); // no Origin header = same-origin / non-browser client

  app.use(cors({ origin: corsOrigin }));
  app.get('/health', (_req, res) => {
    res.json({ ok: true, rooms: service.roomCount, uptime: Math.round(process.uptime()) });
  });

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: corsOrigin },
    // WebSocket first; fall back to long-polling if a proxy blocks upgrades.
    transports: ['websocket', 'polling'],
    pingInterval: 10_000,
    pingTimeout: 10_000,
  });

  // Push needs somewhere to keep its keys; without a data dir it is simply off.
  let webPush: WebPush | null = null;
  if (config.push && config.dataDir) {
    try {
      webPush = new WebPush(config.dataDir, config.vapidSubject, (endpoint) => service.dropPushEndpoint(endpoint));
    } catch (err) {
      console.error('[push] disabled:', err);
    }
  }
  app.get('/api/push/key', (_req, res) => {
    if (webPush) res.json({ publicKey: webPush.publicKey });
    else res.status(404).json({ error: 'Push notifications are turned off on this server.' });
  });

  const service = new RoomService(config, makeNotifier(io, webPush ? (subs, msg) => webPush.send(subs, msg) : undefined));
  const store = config.dataDir ? new RoomStore(config.dataDir, service) : null;
  const restored = store?.attach() ?? 0;
  registerHandlers(io, service);

  // Optionally serve the production build of the React app from the same port,
  // so ONE ngrok tunnel (ngrok http 3001) exposes the whole game.
  const indexHtml = path.join(config.clientDistDir, 'index.html');
  if (config.serveClient && fs.existsSync(indexHtml)) {
    app.use(express.static(config.clientDistDir));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/socket.io')) return next();
      res.sendFile(indexHtml);
    });
  } else if (config.serveClient) {
    app.get('/', (_req, res) => {
      res
        .status(200)
        .type('html')
        .send(
          '<body style="font-family:sans-serif;background:#2a0a12;color:#e8d3a2;padding:3rem">' +
            '<h1>Xiangqi server is running ✔</h1>' +
            '<p>The web client has not been built yet.</p>' +
            '<ul><li>Development: open <b>http://localhost:5173</b> (npm run dev)</li>' +
            '<li>Single-URL mode: run <code>npm run build</code> then restart the server</li></ul></body>',
        );
    });
  }

  const sweeper = setInterval(() => service.sweep(), 60_000);
  sweeper.unref();

  async function close(): Promise<void> {
    clearInterval(sweeper);
    store?.close();
    service.dispose();
    await new Promise<void>((resolve) => void io.close(() => resolve()));
  }

  return { app, httpServer, io, service, close, restored };
}
