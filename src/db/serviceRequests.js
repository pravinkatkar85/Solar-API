import { enquiryTokenHash } from './catalogue.js';

export const LIST_ENDPOINT = '/api/service-requests';
export const CREATE_ENDPOINT = '/api/service-requests/create';
export const UPDATE_ENDPOINT = '/api/service-requests/update';
export const COMPLETE_ENDPOINT = '/api/service-requests/complete';

const LIST_SQL = 'SELECT solar_app.fn_get_service_request_details($1::jsonb) AS response';
const CREATE_SQL = 'SELECT solar_app.fn_create_service_request_details($1::jsonb) AS response';
const UPDATE_SQL = 'SELECT solar_app.fn_update_service_request_details($1::jsonb) AS response';
const COMPLETE_SQL = 'SELECT solar_app.fn_update_site_visit_details($1::jsonb) AS response';
const ID_PATTERN = /^[0-9]{1,18}$/;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const AMOUNT_PATTERN = /^[0-9]+(\.[0-9]{1,2})?$/;
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;
const ACTIONS = new Set(['CANCEL', 'LAPSE', 'RESCHEDULE']);
const ALLOWED_CODES = new Set([200, 400, 401, 403, 404, 500]);

function cleanObject(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  return body;
}

function blank(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function optionalId(record, key, message) {
  if (record[key] === undefined || record[key] === null || record[key] === '') return { ok: true };
  if (typeof record[key] !== 'string' || !ID_PATTERN.test(record[key])) {
    return { ok: false, message };
  }
  return { ok: true, value: record[key] };
}

export function validateServiceRequestList(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };
  const id = optionalId(record, 'service_request_id', 'Choose a service request');
  if (!id.ok) return id;
  return { ok: true, request: { serviceRequestId: id.value } };
}

export function validateServiceRequestCreate(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };
  const site = optionalId(record, 'site_id', 'Choose an installation');
  if (!site.ok || !site.value) return { ok: false, message: 'Choose an installation' };
  const type = optionalId(record, 'service_type_ref_data_id', 'Choose a service type');
  if (!type.ok || !type.value) return { ok: false, message: 'Choose a service type' };
  const slot = optionalId(record, 'slot_window_ref_data_id', 'Choose a time window');
  if (!slot.ok || !slot.value) return { ok: false, message: 'Choose a time window' };
  if (typeof record.preferred_on !== 'string' || !DATE_PATTERN.test(record.preferred_on)) {
    return { ok: false, message: 'Choose a preferred date' };
  }
  const milestone = optionalId(record, 'milestone_id', 'Choose a service visit');
  if (!milestone.ok) return milestone;
  return {
    ok: true,
    request: {
      siteId: site.value,
      serviceTypeId: type.value,
      slotId: slot.value,
      preferredOn: record.preferred_on,
      milestoneId: milestone.value,
    },
  };
}

export function validateServiceRequestUpdate(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };
  const action = typeof record.action === 'string' ? record.action.trim().toUpperCase() : '';
  if (!ACTIONS.has(action)) return { ok: false, message: 'Choose cancel, lapse, or reschedule' };
  const id = optionalId(record, 'service_request_id', 'Choose a service request');
  if (!id.ok || !id.value) return { ok: false, message: 'Choose a service request' };
  const request = { serviceRequestId: id.value, action };
  if (action !== 'RESCHEDULE') return { ok: true, request };
  if (typeof record.preferred_on !== 'string' || !DATE_PATTERN.test(record.preferred_on)) {
    return { ok: false, message: 'Choose a preferred date' };
  }
  request.preferredOn = record.preferred_on;
  const amountPresent = !blank(record.confirmed_charge_amount);
  const currencyPresent = !blank(record.confirmed_currency_code);
  const slabPresent = !blank(record.confirmed_visit_charge_slab_id);
  const presentCount = Number(amountPresent) + Number(currencyPresent) + Number(slabPresent);
  if (presentCount === 0) return { ok: true, request };
  if (presentCount !== 3) return { ok: false, message: 'Confirm the new visit fee' };
  if (typeof record.confirmed_charge_amount !== 'string'
      || typeof record.confirmed_currency_code !== 'string'
      || typeof record.confirmed_visit_charge_slab_id !== 'string') {
    return { ok: false, message: 'Confirm the new visit fee' };
  }
  const amount = record.confirmed_charge_amount.trim();
  const currency = record.confirmed_currency_code.trim();
  const slab = record.confirmed_visit_charge_slab_id.trim();
  if (!AMOUNT_PATTERN.test(amount) || !CURRENCY_PATTERN.test(currency) || !ID_PATTERN.test(slab)) {
    return { ok: false, message: 'Confirm the new visit fee' };
  }
  request.confirmedChargeAmount = amount;
  request.confirmedCurrencyCode = currency;
  request.confirmedVisitChargeSlabId = slab;
  return { ok: true, request };
}

export function validateSiteVisitComplete(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };
  const id = optionalId(record, 'service_request_id', 'Choose a service request');
  if (!id.ok || !id.value) return { ok: false, message: 'Choose a service request' };
  return { ok: true, request: { serviceRequestId: id.value } };
}

export function isServiceRequestConfirmationPreview(response) {
  return response?.status === 'SUCCESS'
    && response?.code === 200
    && response?.data?.confirmation_required === true;
}

export function serviceRequestAuditPayload(body) {
  const record = cleanObject(body) ?? {};
  const payload = {};
  for (const key of [
    'site_id',
    'service_request_id',
    'service_type_ref_data_id',
    'slot_window_ref_data_id',
    'milestone_id',
  ]) {
    if (typeof record[key] === 'string') payload[key] = record[key].slice(0, 18);
  }
  if (typeof record.action === 'string' && ACTIONS.has(record.action.trim().toUpperCase())) {
    payload.action = record.action.trim().toUpperCase();
  }
  if (typeof record.preferred_on === 'string') payload.preferred_on = record.preferred_on.slice(0, 10);
  if (typeof record.confirmed_visit_charge_slab_id === 'string' && ID_PATTERN.test(record.confirmed_visit_charge_slab_id.trim())) {
    payload.confirmed_visit_charge_slab_id = record.confirmed_visit_charge_slab_id.trim();
  }
  return payload;
}

export function readServiceRequestResponse(value) {
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

async function callFunction(query, sql, endpoint, request, tokenHash) {
  const payload = { api_endpoint: endpoint, jwt_token_hash: tokenHash };
  if (request.serviceRequestId) payload.service_request_id = request.serviceRequestId;
  if (request.siteId) payload.site_id = request.siteId;
  if (request.serviceTypeId) payload.service_type_ref_data_id = request.serviceTypeId;
  if (request.slotId) payload.slot_window_ref_data_id = request.slotId;
  if (request.preferredOn) payload.preferred_on = request.preferredOn;
  if (request.milestoneId) payload.milestone_id = request.milestoneId;
  if (request.action) payload.action = request.action;
  if (request.confirmedChargeAmount) payload.confirmed_charge_amount = request.confirmedChargeAmount;
  if (request.confirmedCurrencyCode) payload.confirmed_currency_code = request.confirmedCurrencyCode;
  if (request.confirmedVisitChargeSlabId) {
    payload.confirmed_visit_charge_slab_id = request.confirmedVisitChargeSlabId;
  }
  const result = await query(sql, [JSON.stringify(payload)]);
  return readServiceRequestResponse(result?.rows?.[0]?.response);
}

export function listServiceRequests(query, request, tokenHash) {
  return callFunction(query, LIST_SQL, LIST_ENDPOINT, request, tokenHash);
}

export function createServiceRequest(query, request, tokenHash) {
  return callFunction(query, CREATE_SQL, CREATE_ENDPOINT, request, tokenHash);
}

export function updateServiceRequest(query, request, tokenHash) {
  return callFunction(query, UPDATE_SQL, UPDATE_ENDPOINT, request, tokenHash);
}

export function completeSiteVisit(query, request, tokenHash) {
  return callFunction(query, COMPLETE_SQL, COMPLETE_ENDPOINT, request, tokenHash);
}

export { enquiryTokenHash };
