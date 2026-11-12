# M8 Invoice / Payment API — Deployment Note

**Status:** Deployed to local development API against `SolarDB` (`127.0.0.1:5432`) on 2026-11-12.  
**Canonical closeout:** `../Solar-Docs/M8_CLOSEOUT.md`  
**Project tracker:** `../Solar-Docs/PROJECT_STATUS.md`

## Modules

| Files | Routes |
|---|---|
| `src/db/invoices.js`, `src/routes/invoices.js` | `POST /api/invoices`, `/api/admin/invoices/create`, `/api/admin/invoices/update` |
| `src/db/payments.js`, `src/routes/payments.js` | `POST /api/payments`, `/api/admin/payments/create`, `/api/admin/payments/update` |

Mounted from `src/app.js`. Bearer auth required; SQL functions own business rules.

## Test evidence (2026-11-12)

- `npm run check` — pass
- `npm test` — **147 passed / 0 failed**
- Live health: `GET /health` → database UP
- Live E2E (Flutter contracts): **23/23** — see `Solar-local-backups/m8_flutter_e2e_20261112/`

## Preserve / rollback

- Package: `Solar-local-backups/m8_api_deploy_20261112_164340/`
- Also: `Solar-local-backups/m8_pre_deploy_20261112_163433/rollback/03_api_rollback.md`
