import os from 'node:os';
import { createGameServer } from './app';
import { loadConfig, loadEnvFile } from './config';

loadEnvFile();
const config = loadConfig();
const { httpServer, close, restored } = createGameServer(config);

/** Android (Termux) refuses to list network interfaces, so this is best-effort. */
function lanAddresses(): string[] {
  try {
    return Object.values(os.networkInterfaces())
      .flatMap((addrs) => addrs ?? [])
      .filter((a) => a.family === 'IPv4' && !a.internal)
      .map((a) => a.address);
  } catch {
    return [];
  }
}

httpServer.listen(config.port, config.host, () => {
  console.log('\n  ♟  Xiangqi server ready\n');
  console.log(`  Local:    http://localhost:${config.port}`);
  for (const address of lanAddresses()) console.log(`  Network:  http://${address}:${config.port}`);
  if (config.dataDir) console.log(`\n  Games are saved in ${config.dataDir} (${restored} restored)`);
  console.log(`\n  Expose it with:  ngrok http ${config.port}\n`);
});

const shutdown = () => {
  console.log('\nShutting down…');
  void close().then(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
