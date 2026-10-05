import os from 'node:os';
import { createGameServer } from './app';
import { loadConfig, loadEnvFile } from './config';

loadEnvFile();
const config = loadConfig();
const { httpServer, close } = createGameServer(config);

httpServer.listen(config.port, config.host, () => {
  console.log('\n  ♟  Xiangqi server ready\n');
  console.log(`  Local:    http://localhost:${config.port}`);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  Network:  http://${a.address}:${config.port}`);
    }
  }
  console.log(`\n  Expose it with:  ngrok http ${config.port}\n`);
});

const shutdown = () => {
  console.log('\nShutting down…');
  void close().then(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
