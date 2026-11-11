import { enquiryTokenHash } from './catalogue.js';

export const LIST_ENDPOINT = '/api/notifications';
export const UPDATE_ENDPOINT = '/api/notifications/update';

const LIST_SQL = 'SELECT solar_app.fn_get_notification_details($1::jsonb) AS response';
const UPDATE_SQL = 'SELECT solar_app.fn_update_notification_details($1::jsonb) AS response';
const ID_PATTERN = /^[0-9]{1,18}$/;
const ALLOWED_CODES = new Set([200, 400, 401, 403, 404, 500]);
const ALLOWED_ACTIONS = new Set(['MARK_READ', 'MARK_ALL_READ']);

function cleanObject(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  return body;
}

export function validateNotificationUpdate(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };

  if (typeof record.action !== 'string') {
    return { ok: false, message: 'Choose mark read or mark all read' };
  }
  const action = record.action.trim().toUpperCase();
  if (!ALLOWED_ACTIONS.has(action)) {
    return { ok: false, message: 'Choose mark read or mark all read' };
  }

  let notificationId;
  if (action === 'MARK_READ') {
    if (typeof record.notification_id !== 'string' && typeof record.notification_id !== 'number') {
      return { ok: false, message: 'Choose a notification' };
    }
    const idText = String(record.notification_id).trim();
    if (!ID_PATTERN.test(idText)) {
      return { ok: false, message: 'Choose a notification' };
    }
    notificationId = idText;
  }

  return {
    ok: true,
    request: {
      action,
      notificationId,
    },
  };
}

export function notificationAuditPayload(body) {
  const record = cleanObject(body) ?? {};
  const audit = {};
  if (typeof record.action === 'string') {
    audit.action = record.action.trim().toUpperCase().slice(0, 32);
  }
  if (record.notification_id !== undefined && record.notification_id !== null) {
    audit.notification_id = String(record.notification_id).slice(0, 32);
  }
  return audit;
}

export function readNotificationResponse(value) {
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

export async function listNotifications(query, tokenHash) {
  const result = await query(LIST_SQL, [JSON.stringify({
    api_endpoint: LIST_ENDPOINT,
    jwt_token_hash: tokenHash,
  })]);
  return readNotificationResponse(result?.rows?.[0]?.response);
}

export async function updateNotification(query, request, tokenHash) {
  const payload = {
    api_endpoint: UPDATE_ENDPOINT,
    jwt_token_hash: tokenHash,
    action: request.action,
  };
  if (request.notificationId) {
    payload.notification_id = request.notificationId;
  }
  const result = await query(UPDATE_SQL, [JSON.stringify(payload)]);
  return readNotificationResponse(result?.rows?.[0]?.response);
}

export { enquiryTokenHash };
