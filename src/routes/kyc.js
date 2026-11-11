import express, { Router } from 'express';
import {
  CREATE_ENDPOINT,
  LIST_ENDPOINT,
  UPDATE_ENDPOINT,
  createKycDocument,
  enquiryTokenHash,
  kycAuditPayload,
  listKycDocuments,
  updateKycDocument,
  validateKycCreate,
  validateKycList,
  validateKycUpdate,
} from '../db/kyc.js';

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

function route(query, endpoint, validate, call, fallback) {
  return async (req, res) => {
    const started = Date.now();
    let outcome = failure(500, fallback);
    try {
      const validation = validate(req.body);
      if (!validation.ok) {
        outcome = failure(400, validation.message);
      } else {
        const token = enquiryTokenHash(req.get('authorization'));
        if (token.secretMissing) {
          outcome = failure(500, fallback);
        } else if (!token.tokenHash) {
          outcome = failure(401, 'Authentication is required');
        } else {
          const functionResponse = await call(query, validation.request, token.tokenHash);
          outcome = functionResponse
            ? { httpStatus: functionResponse.code, response: functionResponse }
            : failure(500, fallback);
        }
      }
    } catch (error) {
      console.error('KYC request failed', { code: error?.code ?? 'UNKNOWN' });
    }

    try {
      const status = outcome.response?.status === 'SUCCESS' ? 'SUCCESS' : 'ERROR';
      await query(AUDIT_SQL, [
        endpoint,
        'SYSTEM',
        clientAddress(req).slice(0, 45) || null,
        JSON.stringify(kycAuditPayload(req.body)),
        JSON.stringify(outcome.response),
        outcome.httpStatus,
        status,
        status === 'ERROR' ? String(outcome.response?.message ?? '').slice(0, 500) : null,
        Date.now() - started,
      ]);
    } catch (error) {
      console.error('API audit failed', { code: error?.code ?? 'UNKNOWN' });
    }
    res.status(outcome.httpStatus).json(outcome.response);
  };
}

export function createKycRouter({ query }) {
  const router = Router();
  // KYC create may include a base64 file under the BRD 2 MB ceiling.
  router.use(express.json({ limit: '3mb', strict: true }));
  router.post('/', route(
    query,
    LIST_ENDPOINT,
    validateKycList,
    listKycDocuments,
    'KYC documents could not be loaded',
  ));
  router.post('/create', route(
    query,
    CREATE_ENDPOINT,
    validateKycCreate,
    createKycDocument,
    'KYC document could not be uploaded',
  ));
  router.post('/update', route(
    query,
    UPDATE_ENDPOINT,
    validateKycUpdate,
    updateKycDocument,
    'KYC document could not be updated',
  ));
  return router;
}
