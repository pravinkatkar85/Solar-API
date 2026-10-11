import dotenv from 'dotenv';
import { createApp } from './app.js';
import { readServerConfig } from './config.js';
import { createPool } from './db/pool.js';

dotenv.config();

const serverConfig = readServerConfig();
const pool = createPool();
const app = createApp({ pool });

const server = app.listen(serverConfig.port, serverConfig.host, () => {
  console.log(`Solar API listening on port ${serverConfig.port}`);
});

async function shutdown() {
  server.close();
  await pool.end();
}

process.on('SIGINT', () => {
  shutdown().catch((error) => {
    console.error('Shutdown failed', { code: error?.code ?? 'UNKNOWN' });
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  shutdown().catch((error) => {
    console.error('Shutdown failed', { code: error?.code ?? 'UNKNOWN' });
    process.exit(1);
  });
});
