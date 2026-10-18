import { Router } from 'express';
import {
  ENQUIRY_ENDPOINT,
  LIST_ENDPOINT,
  catalogueAuditPayload,
  ENQUIRY_LIST_ENDPOINT,
  ENQUIRY_ACTION_ENDPOINT,
  createEnquiry,
  enquiryTokenHash,
  listEnquiries,
  listProducts,
  updateEnquiry,
  validateEnquiryActionRequest,
  validateEnquiryListRequest,
  validateEnquiryRequest,
  validateProductRequest,
} from '../db/catalogue.js';

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

async function writeAudit(query, endpoint, req, outcome, started) {
  const status = outcome.response?.status === 'SUCCESS' ? 'SUCCESS' : 'ERROR';
  const actor = outcome.response?.data?.user_id ?? 'SYSTEM';
  await query(AUDIT_SQL, [
    endpoint,
    String(actor).slice(0, 50),
    clientAddress(req).slice(0, 45) || null,
    JSON.stringify(catalogueAuditPayload(req.body)),
    JSON.stringify(outcome.response),
    outcome.httpStatus,
    status,
    status === 'ERROR' ? String(outcome.response?.message ?? '').slice(0, 500) : null,
    Date.now() - started,
  ]);
}

function createHandler({ query, endpoint, validate, execute }) {
  return async (req, res) => {
    const started = Date.now();
    const sessionEndpoint = endpoint === ENQUIRY_ENDPOINT
      || endpoint === ENQUIRY_LIST_ENDPOINT
      || endpoint === ENQUIRY_ACTION_ENDPOINT;
    const unavailable = endpoint === ENQUIRY_LIST_ENDPOINT
      ? 'Enquiries could not be loaded'
      : endpoint === ENQUIRY_ACTION_ENDPOINT
        ? 'Enquiry could not be updated'
        : 'Enquiry could not be submitted';
    let outcome = failure(500, 'Request could not be completed');
    try {
      const validation = validate(req.body);
      if (!validation.ok) {
        outcome = failure(400, validation.message);
      } else if (sessionEndpoint) {
        const token = enquiryTokenHash(req.get('authorization'));
        if (token.secretMissing) {
          outcome = failure(500, unavailable);
        } else if (!token.tokenHash) {
          outcome = failure(401, 'Authentication is required');
        } else {
          const functionResponse = await execute(query, validation.request, token.tokenHash);
          outcome = functionResponse
            ? { httpStatus: functionResponse.code, response: functionResponse }
            : failure(500, unavailable);
        }
      } else {
        const functionResponse = await execute(query, validation.request);
        outcome = functionResponse
          ? { httpStatus: functionResponse.code, response: functionResponse }
          : failure(500, 'Products could not be loaded');
      }
    } catch (error) {
      console.error('Catalogue request failed', { code: error?.code ?? 'UNKNOWN' });
    }

    try {
      await writeAudit(query, endpoint, req, outcome, started);
    } catch (error) {
      console.error('API audit failed', { code: error?.code ?? 'UNKNOWN' });
    }
    res.status(outcome.httpStatus).json(outcome.response);
  };
}

export function createCatalogueRouter({ query }) {
  const router = Router();
  router.post('/products', createHandler({
    query,
    endpoint: LIST_ENDPOINT,
    validate: validateProductRequest,
    execute: listProducts,
  }));
  router.post('/enquiries/list', createHandler({
    query,
    endpoint: ENQUIRY_LIST_ENDPOINT,
    validate: validateEnquiryListRequest,
    execute: listEnquiries,
  }));
  router.post('/enquiries/action', createHandler({
    query,
    endpoint: ENQUIRY_ACTION_ENDPOINT,
    validate: validateEnquiryActionRequest,
    execute: updateEnquiry,
  }));
  router.post('/enquiries', createHandler({
    query,
    endpoint: ENQUIRY_ENDPOINT,
    validate: validateEnquiryRequest,
    execute: createEnquiry,
  }));
  return router;
}
