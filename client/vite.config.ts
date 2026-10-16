import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // In dev, the browser talks to the Vite server and Vite forwards /socket.io (and /api) to the game server.
  // That keeps everything on ONE origin, so `ngrok http 5173` also works, and there are no CORS surprises.
  const proxy = {
    '/socket.io': {
      target: env.DEV_PROXY_TARGET || 'http://localhost:3001',
      ws: true,
      changeOrigin: true,
    },
    '/api': {
      target: env.DEV_PROXY_TARGET || 'http://localhost:3001',
      changeOrigin: true,
    },
  };

  const extraHosts = (env.DEV_ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);

  return {
    plugins: [react()],
    server: {
      host: true, // listen on the LAN as well as localhost
      port: 5173,
      // Vite blocks unknown Host headers by default — allow ngrok tunnels.
      allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.io', ...extraHosts],
      proxy,
    },
    preview: {
      host: true,
      port: 4173,
      allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.io', ...extraHosts],
      proxy,
    },
  };
});
