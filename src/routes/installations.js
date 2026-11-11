import { Router } from 'express';
import {
  LIST_ENDPOINT,
  UPDATE_ENDPOINT,
  enquiryTokenHash,
  installationAuditPayload,
  listInstallations,
  updateInstallation,
  validateInstallationRequest,
  validateInstallationUpdate,
} from '../db/installations.js';

const AUDIT_SQL = `
  INSERT INTO solar_app.log_api_execution (
    api_endpoint, http_method, logged_in_user_id, client_ip,
    request_payload, response_payload, http_status, execution_status,
    error_message, execution_time_ms, created_by, updated_by
  ) VALUES (
    $1, 'POST', $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $2, $2
  )
`;

function clientAddress(req) {
  const address = req.socket?.remoteAddress ?? '';
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

function failure(code, message) {
  return { httpStatus: code, response: { status: 'ERROR', code, message, data: null } };
}

async function audit(query, req, started, endpoint, outcome) {
  try {
    const status = outcome.response?.status === 'SUCCESS' ? 'SUCCESS' : 'ERROR';
    await query(AUDIT_SQL, [
      endpoint,
      'SYSTEM',
      clientAddress(req).slice(0, 45) || null,
      JSON.stringify(installationAuditPayload(req.body)),
      JSON.stringify(outcome.response),
      outcome.httpStatus,
      status,
      status === 'ERROR' ? String(outcome.response?.message ?? '').slice(0, 500) : null,
      Date.now() - started,
    ]);
  } catch (error) {
    console.error('API audit failed', { code: error?.code ?? 'UNKNOWN' });
  }
}

export function createInstallationRouter({ query }) {
  const router = Router();

  router.post('/', async (req, res) => {
    const started = Date.now();
    let outcome = failure(500, 'Installations could not be loaded');
    try {
      const validation = validateInstallationRequest(req.body);
      if (!validation.ok) {
        outcome = failure(400, validation.message);
      } else {
        const token = enquiryTokenHash(req.get('authorization'));
        if (token.secretMissing) {
          outcome = failure(500, 'Installations could not be loaded');
        } else if (!token.tokenHash) {
          outcome = failure(401, 'Authentication is required');
        } else {
          const functionResponse = await listInstallations(
            query,
            validation.request,
            token.tokenHash,
          );
          outcome = functionResponse
            ? { httpStatus: functionResponse.code, response: functionResponse }
            : failure(500, 'Installations could not be loaded');
        }
      }
    } catch (error) {
      console.error('Installation request failed', { code: error?.code ?? 'UNKNOWN' });
    }
    await audit(query, req, started, LIST_ENDPOINT, outcome);
    res.status(outcome.httpStatus).json(outcome.response);
  });

  router.post('/update', async (req, res) => {
    const started = Date.now();
    let outcome = failure(500, 'Site profile could not be updated');
    try {
      const validation = validateInstallationUpdate(req.body);
      if (!validation.ok) {
        outcome = failure(400, validation.message);
      } else {
        const token = enquiryTokenHash(req.get('authorization'));
        if (token.secretMissing) {
          outcome = failure(500, 'Site profile could not be updated');
        } else if (!token.tokenHash) {
          outcome = failure(401, 'Authentication is required');
        } else {
          const functionResponse = await updateInstallation(
            query,
            validation.request,
            token.tokenHash,
          );
          outcome = functionResponse
            ? { httpStatus: functionResponse.code, response: functionResponse }
            : failure(500, 'Site profile could not be updated');
        }
      }
    } catch (error) {
      console.error('Site profile update failed', { code: error?.code ?? 'UNKNOWN' });
    }
    await audit(query, req, started, UPDATE_ENDPOINT, outcome);
    res.status(outcome.httpStatus).json(outcome.response);
  });

  return router;
}
