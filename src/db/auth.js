import { createHash, createHmac, randomBytes } from 'node:crypto';

export const REGISTER_ENDPOINT = '/api/auth/register';
export const LOGIN_ENDPOINT = '/api/auth/login';

const REGISTER_SQL = 'SELECT solar_app.fn_create_pin_user($1::jsonb) AS response';
const LOGIN_SQL = 'SELECT solar_app.fn_create_pin_session($1::jsonb) AS response';

const PIN_PATTERN = /^[0-9]{4}$/;
const COUNTRY_ID_PATTERN = /^[0-9]{1,18}$/;
const ALLOWED_CODES = new Set([200, 400, 401, 409, 500]);

function cleanObject(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }
  return body;
}

function readNationalNumber(body) {
  if (typeof body.national_number !== 'string') {
    return { ok: false, message: 'Enter a valid mobile number' };
  }
  const nationalNumber = body.national_number.replace(/\s/g, '');
  if (!/^[0-9]{1,15}$/.test(nationalNumber)) {
    return { ok: false, message: 'Enter a valid mobile number' };
  }
  return { ok: true, nationalNumber };
}

function readCountryId(body) {
  if (typeof body.country_id !== 'string' || !COUNTRY_ID_PATTERN.test(body.country_id)) {
    return { ok: false, message: 'Choose a country' };
  }
  return { ok: true, countryId: body.country_id };
}

function readPin(body) {
  if (typeof body.pin !== 'string' || !PIN_PATTERN.test(body.pin)) {
    return { ok: false, message: 'PIN must be 4 digits' };
  }
  return { ok: true, pin: body.pin };
}

export function validateRegisterRequest(body) {
  const record = cleanObject(body);
  if (!record) {
    return { ok: false, message: 'Request body must be a JSON object' };
  }
  const country = readCountryId(record);
  if (!country.ok) return country;
  const national = readNationalNumber(record);
  if (!national.ok) return national;
  const pin = readPin(record);
  if (!pin.ok) return pin;
  if (typeof record.full_name !== 'string' || record.full_name.trim() === '') {
    return { ok: false, message: 'Enter your name' };
  }
  if (record.full_name.trim().length > 150) {
    return { ok: false, message: 'Enter your name' };
  }
  return {
    ok: true,
    request: {
      countryId: country.countryId,
      nationalNumber: national.nationalNumber,
      fullName: record.full_name.trim(),
      pin: pin.pin,
    },
  };
}

export function validateLoginRequest(body) {
  const record = cleanObject(body);
  if (!record) {
    return { ok: false, message: 'Request body must be a JSON object' };
  }
  const country = readCountryId(record);
  if (!country.ok) return country;
  const national = readNationalNumber(record);
  if (!national.ok) return national;
  const pin = readPin(record);
  if (!pin.ok) return pin;
  return {
    ok: true,
    request: {
      countryId: country.countryId,
      nationalNumber: national.nationalNumber,
      pin: pin.pin,
    },
  };
}

export function readJwtSecret(env = process.env) {
  const secret = env.JWT_SECRET;
  if (typeof secret !== 'string' || secret.trim().length < 32) {
    return null;
  }
  return secret;
}

export function createSessionToken(userId, sessionId, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    sub: userId,
    sid: sessionId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (12 * 60 * 60),
    jti: randomBytes(16).toString('hex'),
  })).toString('base64url');
  const unsigned = `${header}.${body}`;
  const signature = createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

export function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function placeholderTokenHash() {
  return hashSessionToken(randomBytes(32).toString('hex'));
}

export function readFunctionResponse(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const code = Number(parsed.code);
  if (!ALLOWED_CODES.has(code) || (parsed.status !== 'SUCCESS' && parsed.status !== 'ERROR')) {
    return null;
  }
  if (typeof parsed.message !== 'string' || !Object.hasOwn(parsed, 'data')) {
    return null;
  }
  return {
    status: parsed.status,
    code,
    message: parsed.message,
    data: parsed.data,
  };
}

export function auditAuthPayload(body) {
  const record = cleanObject(body);
  if (!record) return {};
  const payload = {};
  if (typeof record.country_id === 'string') payload.country_id = record.country_id;
  if (typeof record.national_number === 'string') {
    payload.national_number = record.national_number.replace(/\s/g, '').slice(0, 15);
  }
  if (typeof record.full_name === 'string') payload.full_name = record.full_name.trim().slice(0, 150);
  return payload;
}

export function auditAuthResponse(response) {
  if (!response || typeof response !== 'object') return response;
  const data = response.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return response;
  const safeData = { ...data };
  delete safeData.access_token;
  return { ...response, data: safeData };
}

async function callFunction(query, sql, payload) {
  const result = await query(sql, [JSON.stringify(payload)]);
  return readFunctionResponse(result?.rows?.[0]?.response);
}

export async function registerPinUser(query, request) {
  return callFunction(query, REGISTER_SQL, {
    api_endpoint: REGISTER_ENDPOINT,
    country_id: request.countryId,
    national_number: request.nationalNumber,
    full_name: request.fullName,
    pin: request.pin,
  });
}

export async function loginWithPin(query, request, secret) {
  const provisionalHash = placeholderTokenHash();
  const verified = await callFunction(query, LOGIN_SQL, {
    api_endpoint: LOGIN_ENDPOINT,
    country_id: request.countryId,
    national_number: request.nationalNumber,
    pin: request.pin,
    jwt_token_hash: provisionalHash,
  });
  if (!verified || verified.status !== 'SUCCESS' || !verified.data?.user_id || !verified.data?.session_id) {
    return verified;
  }

  const accessToken = createSessionToken(verified.data.user_id, verified.data.session_id, secret);
  const finalHash = hashSessionToken(accessToken);
  const updated = await query(
    `UPDATE solar_app.log_user_sessions
        SET jwt_token_hash = $1,
            updated_on = CURRENT_TIMESTAMP
      WHERE session_id = $2::bigint
        AND jwt_token_hash = $3`,
    [finalHash, verified.data.session_id, provisionalHash],
  );
  if (updated?.rowCount !== 1) {
    return {
      status: 'ERROR',
      code: 500,
      message: 'Sign-in could not be completed',
      data: null,
    };
  }

  return {
    ...verified,
    data: {
      ...verified.data,
      access_token: accessToken,
    },
  };
}
