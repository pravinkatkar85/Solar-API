import { Router } from 'express';
import {
  LOGIN_ENDPOINT,
  REGISTER_ENDPOINT,
  auditAuthPayload,
  auditAuthResponse,
  loginWithPin,
  readJwtSecret,
  registerPinUser,
  validateLoginRequest,
  validateRegisterRequest,
} from '../db/auth.js';

const AUDIT_SQL = `
  INSERT INTO solar_app.log_api_execution (
    api_endpoint,
    http_method,
    logged_in_user_id,
    client_ip,
    request_payload,
    response_payload,
    http_status,
    execution_status,
    error_message,
    execution_time_ms,
    created_by,
    updated_by
  ) VALUES (
    $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $3, $3
  )
`;

function clientAddress(req) {
  const address = req.socket?.remoteAddress ?? '';
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

function failure(code, message) {
  return {
    httpStatus: code,
    response: { status: 'ERROR', code, message, data: null },
  };
}

async function writeAudit(query, endpoint, req, outcome, started) {
  const status = outcome.response?.status === 'SUCCESS' ? 'SUCCESS' : 'ERROR';
  const actor = outcome.response?.data?.user_id ?? 'SYSTEM';
  await query(AUDIT_SQL, [
    endpoint,
    'POST',
    String(actor).slice(0, 50),
    clientAddress(req).slice(0, 45) || null,
    JSON.stringify(auditAuthPayload(req.body)),
    JSON.stringify(auditAuthResponse(outcome.response)),
    outcome.httpStatus,
    status,
    status === 'ERROR' ? String(outcome.response?.message ?? '').slice(0, 500) : null,
    Date.now() - started,
  ]);
}

function createHandler({ query, endpoint, validate, execute }) {
  return async (req, res) => {
    const started = Date.now();
    let outcome = failure(500, 'Request could not be completed');
    try {
      const validation = validate(req.body);
      if (!validation.ok) {
        outcome = failure(400, validation.message);
      } else if (endpoint === LOGIN_ENDPOINT && !readJwtSecret()) {
        outcome = failure(500, 'Sign-in could not be completed');
      } else {
        const functionResponse = await execute(query, validation.request);
        if (!functionResponse) {
          outcome = failure(500, 'Request could not be completed');
        } else {
          outcome = { httpStatus: functionResponse.code, response: functionResponse };
        }
      }
    } catch (error) {
      console.error('Auth request failed', { code: error?.code ?? 'UNKNOWN' });
      outcome = failure(500, 'Request could not be completed');
    }

    try {
      await writeAudit(query, endpoint, req, outcome, started);
    } catch (error) {
      console.error('API audit failed', { code: error?.code ?? 'UNKNOWN' });
    }

    res.status(outcome.httpStatus).json(outcome.response);
  };
}

export function createAuthRouter({ query }) {
  const router = Router();
  router.post('/register', createHandler({
    query,
    endpoint: REGISTER_ENDPOINT,
    validate: validateRegisterRequest,
    execute: registerPinUser,
  }));
  router.post('/login', createHandler({
    query,
    endpoint: LOGIN_ENDPOINT,
    validate: validateLoginRequest,
    execute: (database, request) => loginWithPin(database, request, readJwtSecret()),
  }));
  return router;
}
