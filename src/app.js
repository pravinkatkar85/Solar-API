import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localFlutterWebCors } from './middleware/cors.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createAuthRouter } from './routes/auth.js';
import { createCatalogueRouter } from './routes/catalogue.js';
import { createInstallationRouter } from './routes/installations.js';
import { createCoverageRouter } from './routes/coverage.js';
import { createServiceRequestRouter } from './routes/serviceRequests.js';
import { createAccountRouter } from './routes/account.js';
import { createNotificationRouter } from './routes/notifications.js';
import { createKycRouter } from './routes/kyc.js';
import { createAdminCustomersRouter } from './routes/adminCustomers.js';
import { createTechniciansRouter } from './routes/technicians.js';
import { createJobsRouter } from './routes/jobs.js';
import {
  createAdminPaymentsRouter,
  createPaymentsRouter,
} from './routes/payments.js';
import {
  createAdminInvoicesRouter,
  createInvoicesRouter,
} from './routes/invoices.js';
import { createDropdownRouter } from './routes/dropdowns.js';
import { createHealthRouter } from './routes/health.js';

export function createApp({ pool, query, checkDatabaseConnection } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(localFlutterWebCors);
  // 3mb allows KYC create with a BRD-capped (<=2 MB) base64 file body.
  app.use(express.json({ limit: '3mb', strict: true }));
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
  app.use(
    '/media/kyc',
    express.static(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../media/kyc',
      ),
      { index: false, dotfiles: 'deny' },
    ),
  );
  app.use(
    '/media/jobs',
    express.static(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../media/jobs',
      ),
      { index: false, dotfiles: 'deny' },
    ),
  );

  app.use('/health', createHealthRouter({ pool, checkDatabaseConnection }));

  const databaseQuery = query ?? ((text, params) => pool.query(text, params));
  app.use('/api/dropdowns', createDropdownRouter({ query: databaseQuery }));
  app.use('/api/auth', createAuthRouter({ query: databaseQuery }));
  app.use('/api/catalogue', createCatalogueRouter({ query: databaseQuery }));
  app.use('/api/installations', createInstallationRouter({ query: databaseQuery }));
  app.use('/api/service-coverage', createCoverageRouter({ query: databaseQuery }));
  app.use('/api/service-requests', createServiceRequestRouter({ query: databaseQuery }));
  app.use('/api/kyc', createKycRouter({ query: databaseQuery }));
  app.use('/api/admin/customers', createAdminCustomersRouter({ query: databaseQuery }));
  app.use('/api/admin/technicians', createTechniciansRouter({ query: databaseQuery }));
  app.use('/api/technician/jobs', createJobsRouter({ query: databaseQuery }));
  app.use('/api/payments', createPaymentsRouter({ query: databaseQuery }));
  app.use('/api/admin/payments', createAdminPaymentsRouter({ query: databaseQuery }));
  app.use('/api/invoices', createInvoicesRouter({ query: databaseQuery }));
  app.use('/api/admin/invoices', createAdminInvoicesRouter({ query: databaseQuery }));
  app.use('/api/notifications', createNotificationRouter({ query: databaseQuery }));
  app.use('/api/account', createAccountRouter({ query: databaseQuery }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
