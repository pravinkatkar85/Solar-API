import { enquiryTokenHash } from './catalogue.js';

export const GET_ENDPOINT = '/api/account';
export const UPDATE_ENDPOINT = '/api/account/update';

const GET_SQL = 'SELECT solar_app.fn_get_user_profile($1::jsonb) AS response';
const UPDATE_SQL = 'SELECT solar_app.fn_update_user_profile($1::jsonb) AS response';
const NATIONAL_PATTERN = /^[0-9]{1,15}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_CODES = new Set([200, 400, 401, 403, 500]);

function cleanObject(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  return body;
}

function optionalText(value, maxLength) {
  if (value === undefined || value === null) return { ok: true, value: '' };
  if (typeof value !== 'string') return { ok: false };
  const trimmed = value.trim();
  if (trimmed.length > maxLength) return { ok: false };
  return { ok: true, value: trimmed };
}

export function validateAccountUpdate(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };
  const email = optionalText(record.email, 150);
  if (!email.ok || (email.value && !EMAIL_PATTERN.test(email.value))) {
    return { ok: false, message: 'Enter a valid email address' };
  }
  const secondary = optionalText(record.secondary_national_number, 15);
  if (!secondary.ok || (secondary.value && !NATIONAL_PATTERN.test(secondary.value))) {
    return { ok: false, message: 'Enter a valid mobile number' };
  }
  return {
    ok: true,
    request: {
      email: email.value,
      secondaryNational: secondary.value,
    },
  };
}

export function accountAuditPayload() {
  return {};
}

export function readAccountResponse(value) {
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

export async function getUserProfile(query, tokenHash) {
  const result = await query(GET_SQL, [JSON.stringify({
    api_endpoint: GET_ENDPOINT,
    jwt_token_hash: tokenHash,
  })]);
  return readAccountResponse(result?.rows?.[0]?.response);
}

export async function updateUserProfile(query, request, tokenHash) {
  const result = await query(UPDATE_SQL, [JSON.stringify({
    api_endpoint: UPDATE_ENDPOINT,
    jwt_token_hash: tokenHash,
    email: request.email,
    secondary_national_number: request.secondaryNational,
  })]);
  return readAccountResponse(result?.rows?.[0]?.response);
}

export { enquiryTokenHash };
