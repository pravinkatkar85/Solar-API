import { enquiryTokenHash } from './catalogue.js';

export const LIST_ENDPOINT = '/api/installations';
export const UPDATE_ENDPOINT = '/api/installations/update';

const LIST_SQL = 'SELECT solar_app.fn_get_site_details($1::jsonb) AS response';
const UPDATE_SQL = 'SELECT solar_app.fn_update_site_details($1::jsonb) AS response';
const ID_PATTERN = /^[0-9]{1,18}$/;
const ALLOWED_CODES = new Set([200, 400, 401, 403, 404, 500]);

function cleanObject(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  return body;
}

export function validateInstallationRequest(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };
  const request = {};
  if (record.site_id !== undefined && record.site_id !== null && record.site_id !== '') {
    if (typeof record.site_id !== 'string' || !ID_PATTERN.test(record.site_id)) {
      return { ok: false, message: 'Choose an installation' };
    }
    request.siteId = record.site_id;
  }
  return { ok: true, request };
}

export function validateInstallationUpdate(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };
  if (typeof record.site_id !== 'string' || !ID_PATTERN.test(record.site_id)) {
    return { ok: false, message: 'Choose a site' };
  }
  if (typeof record.address_line1 !== 'string' || record.address_line1.trim() === ''
    || record.address_line1.trim().length > 255) {
    return { ok: false, message: 'Enter the site address' };
  }
  const request = {
    siteId: record.site_id,
    addressLine1: record.address_line1.trim(),
  };
  if (record.address_line2 !== undefined && record.address_line2 !== null && record.address_line2 !== '') {
    if (typeof record.address_line2 !== 'string' || record.address_line2.trim().length > 255) {
      return { ok: false, message: 'Enter a shorter address line' };
    }
    request.addressLine2 = record.address_line2.trim();
  }
  const hasLat = record.latitude !== undefined && record.latitude !== null && record.latitude !== '';
  const hasLon = record.longitude !== undefined && record.longitude !== null && record.longitude !== '';
  if (hasLat !== hasLon) {
    return { ok: false, message: 'Provide both latitude and longitude' };
  }
  if (hasLat) {
    if (typeof record.latitude !== 'string' || typeof record.longitude !== 'string') {
      return { ok: false, message: 'Enter valid GPS coordinates' };
    }
    request.latitude = record.latitude.trim();
    request.longitude = record.longitude.trim();
  }
  if (record.discom_id !== undefined && record.discom_id !== null && record.discom_id !== '') {
    if (typeof record.discom_id !== 'string' || !ID_PATTERN.test(record.discom_id)) {
      return { ok: false, message: 'Choose an electricity provider' };
    }
    request.discomId = record.discom_id;
  }
  if (record.consumer_number !== undefined && record.consumer_number !== null
    && record.consumer_number !== '') {
    if (typeof record.consumer_number !== 'string' || record.consumer_number.trim().length > 50) {
      return { ok: false, message: 'Enter a shorter consumer number' };
    }
    request.consumerNumber = record.consumer_number.trim();
  }
  if (record.meter_number !== undefined && record.meter_number !== null && record.meter_number !== '') {
    if (typeof record.meter_number !== 'string' || record.meter_number.trim().length > 50) {
      return { ok: false, message: 'Enter a shorter meter number' };
    }
    request.meterNumber = record.meter_number.trim();
  }
  if (record.sanctioned_load_kw !== undefined && record.sanctioned_load_kw !== null
    && record.sanctioned_load_kw !== '') {
    if (typeof record.sanctioned_load_kw !== 'string'
      || !/^[0-9]+(\.[0-9]{1,3})?$/.test(record.sanctioned_load_kw.trim())) {
      return { ok: false, message: 'Enter a valid sanctioned load' };
    }
    request.sanctionedLoadKw = record.sanctioned_load_kw.trim();
  }
  if (record.connection_type_ref_data_id !== undefined
    && record.connection_type_ref_data_id !== null
    && record.connection_type_ref_data_id !== '') {
    if (typeof record.connection_type_ref_data_id !== 'string'
      || !ID_PATTERN.test(record.connection_type_ref_data_id)) {
      return { ok: false, message: 'Choose a connection type' };
    }
    request.connectionTypeId = record.connection_type_ref_data_id;
  }
  return { ok: true, request };
}

export function installationAuditPayload(body) {
  const record = cleanObject(body) ?? {};
  const payload = {};
  if (typeof record.site_id === 'string') payload.site_id = record.site_id.slice(0, 18);
  if (typeof record.discom_id === 'string') payload.discom_id = record.discom_id.slice(0, 18);
  if (typeof record.consumer_number === 'string') {
    payload.consumer_number = record.consumer_number.slice(0, 50);
  }
  if (typeof record.meter_number === 'string') payload.meter_number = record.meter_number.slice(0, 50);
  if (typeof record.sanctioned_load_kw === 'string') {
    payload.sanctioned_load_kw = record.sanctioned_load_kw.slice(0, 20);
  }
  return payload;
}

export function readInstallationResponse(value) {
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

export async function listInstallations(query, request, tokenHash) {
  const payload = {
    api_endpoint: LIST_ENDPOINT,
    jwt_token_hash: tokenHash,
  };
  if (request.siteId) payload.site_id = request.siteId;
  const result = await query(LIST_SQL, [JSON.stringify(payload)]);
  return readInstallationResponse(result?.rows?.[0]?.response);
}

export async function updateInstallation(query, request, tokenHash) {
  const payload = {
    api_endpoint: UPDATE_ENDPOINT,
    jwt_token_hash: tokenHash,
    site_id: request.siteId,
    address_line1: request.addressLine1,
  };
  if (request.addressLine2) payload.address_line2 = request.addressLine2;
  if (request.latitude) {
    payload.latitude = request.latitude;
    payload.longitude = request.longitude;
  }
  if (request.discomId) payload.discom_id = request.discomId;
  if (request.consumerNumber) payload.consumer_number = request.consumerNumber;
  if (request.meterNumber) payload.meter_number = request.meterNumber;
  if (request.sanctionedLoadKw) payload.sanctioned_load_kw = request.sanctionedLoadKw;
  if (request.connectionTypeId) {
    payload.connection_type_ref_data_id = request.connectionTypeId;
  }
  const result = await query(UPDATE_SQL, [JSON.stringify(payload)]);
  return readInstallationResponse(result?.rows?.[0]?.response);
}

export { enquiryTokenHash };
