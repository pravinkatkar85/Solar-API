import { Router } from 'express';
import { checkDatabase } from '../db/pool.js';

export function createHealthRouter({ pool, checkDatabaseConnection = checkDatabase } = {}) {
  const router = Router();

  router.get('/', async (_req, res) => {
    const connected = await checkDatabaseConnection(pool);
    res.status(connected ? 200 : 503).json({
      status: 'UP',
      database: connected ? 'UP' : 'DOWN',
    });
  });

  return router;
}
