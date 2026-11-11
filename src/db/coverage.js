import { enquiryTokenHash } from './catalogue.js';

export const LIST_ENDPOINT = '/api/service-coverage';

const LIST_SQL = 'SELECT solar_app.fn_get_amc_contract_details($1::jsonb) AS response';
const ALLOWED_CODES = new Set([200, 400, 401, 403, 404, 500]);

function cleanObject(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  return body;
}

export function validateCoverageRequest(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };
  return { ok: true, request: {} };
}

export function coverageAuditPayload() {
  return {};
}

export function readCoverageResponse(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const code = Number(parsed.code);
  if (!ALLOWED_CODES.has(code) || (parsed.status !== 'SUCCESS' && parsed.status !== 'ERROR')) {
    return null;
  }
  if (typeof parsed.message !== 'string' || !Object.hasOwn(parsed, 'data')) return null;
  return { status: parsed.status, code, message: parsed.message, data: parsed.data };
}

export async function listCoverage(query, tokenHash) {
  const result = await query(LIST_SQL, [JSON.stringify({
    api_endpoint: LIST_ENDPOINT,
    jwt_token_hash: tokenHash,
  })]);
  return readCoverageResponse(result?.rows?.[0]?.response);
}

export { enquiryTokenHash };
