import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localFlutterWebCors } from './middleware/cors.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createAuthRouter } from './routes/auth.js';
import { createCatalogueRouter } from './routes/catalogue.js';
import { createDropdownRouter } from './routes/dropdowns.js';
import { createHealthRouter } from './routes/health.js';

export function createApp({ pool, query, checkDatabaseConnection } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(localFlutterWebCors);
  app.use(express.json({ limit: '16kb', strict: true }));
  app.use(
    '/media/catalogue',
    express.static(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../media/catalogue',
      ),
      { index: false, dotfiles: 'deny' },
    ),
  );

  app.use('/health', createHealthRouter({ pool, checkDatabaseConnection }));

  const databaseQuery = query ?? ((text, params) => pool.query(text, params));
  app.use('/api/dropdowns', createDropdownRouter({ query: databaseQuery }));
  app.use('/api/auth', createAuthRouter({ query: databaseQuery }));
  app.use('/api/catalogue', createCatalogueRouter({ query: databaseQuery }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
