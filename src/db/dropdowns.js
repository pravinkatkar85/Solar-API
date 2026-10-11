export const DROPDOWN_ENDPOINT = '/api/dropdowns';

export const DROPDOWN_SQL =
  'SELECT solar_app.fn_get_dropdown_data($1::jsonb) AS response';

const DROPDOWN_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,49}$/;
const PARENT_VALUE_MAX_LENGTH = 200;

export function validateDropdownRequest(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'Request body must be a JSON object' };
  }

  if (typeof body.dropdown_code !== 'string' || body.dropdown_code.trim() === '') {
    return { ok: false, message: 'dropdown_code is required' };
  }

  const dropdownCode = body.dropdown_code.trim();
  if (!DROPDOWN_CODE_PATTERN.test(dropdownCode)) {
    return { ok: false, message: 'dropdown_code is not valid' };
  }

  const request = { dropdownCode };
  if (Object.hasOwn(body, 'parent_value')) {
    const parentValue = body.parent_value;
    const parentIsText = typeof parentValue === 'string';
    const parentIsNumber = typeof parentValue === 'number' && Number.isFinite(parentValue);
    if (!parentIsText && !parentIsNumber && parentValue !== null) {
      return { ok: false, message: 'parent_value must be a string or number' };
    }
    if (parentIsText && parentValue.length > PARENT_VALUE_MAX_LENGTH) {
      return { ok: false, message: 'parent_value is not valid' };
    }
    request.parentValue = parentValue;
  }

  return { ok: true, request };
}

export function buildDropdownPayload(request) {
  const payload = {
    api_endpoint: DROPDOWN_ENDPOINT,
    dropdown_code: request.dropdownCode,
  };
  if (Object.hasOwn(request, 'parentValue')) {
    payload.parent_value = request.parentValue;
  }
  return payload;
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
  const allowedCodes = new Set([200, 400, 404, 500]);
  if (!allowedCodes.has(code) || (parsed.status !== 'SUCCESS' && parsed.status !== 'ERROR')) {
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

export async function queryDropdown(query, request) {
  const payload = buildDropdownPayload(request);
  const result = await query(DROPDOWN_SQL, [JSON.stringify(payload)]);
  return readFunctionResponse(result?.rows?.[0]?.response);
}

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

export function auditRequestPayload(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }
  const payload = {};
  if (typeof body.dropdown_code === 'string') {
    payload.dropdown_code = body.dropdown_code.slice(0, 80);
  }
  if (typeof body.parent_value === 'string') {
    payload.parent_value = body.parent_value.slice(0, PARENT_VALUE_MAX_LENGTH);
  } else if (typeof body.parent_value === 'number' && Number.isFinite(body.parent_value)) {
    payload.parent_value = body.parent_value;
  }
  return payload;
}

export async function writeApiAudit(query, entry) {
  const status = entry.response?.status === 'SUCCESS' ? 'SUCCESS' : 'ERROR';
  await query(AUDIT_SQL, [
    DROPDOWN_ENDPOINT,
    'POST',
    'SYSTEM',
    entry.clientIp ? String(entry.clientIp).slice(0, 45) : null,
    JSON.stringify(auditRequestPayload(entry.body)),
    JSON.stringify(entry.response),
    entry.httpStatus,
    status,
    status === 'ERROR' ? String(entry.response?.message ?? '').slice(0, 500) : null,
    entry.elapsedMs,
  ]);
}
