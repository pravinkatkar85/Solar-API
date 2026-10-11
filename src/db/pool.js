import pg from 'pg';
import { readDatabaseConfig } from '../config.js';

const { Pool } = pg;

export function createPool(config = readDatabaseConfig()) {
  const pool = new Pool(config);
  pool.on('error', (error) => {
    console.error('PostgreSQL pool error', { code: error.code ?? 'UNKNOWN' });
  });
  return pool;
}

export async function checkDatabase(pool) {
  if (!pool) {
    return false;
  }
  try {
    await pool.query('SELECT 1 AS ok');
    return true;
  } catch (error) {
    console.error('Database health check failed', { code: error.code ?? 'UNKNOWN' });
    return false;
  }
}
