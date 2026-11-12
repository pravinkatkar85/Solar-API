import { enquiryTokenHash } from './catalogue.js';

export const LIST_ENDPOINT = '/api/admin/technicians';
export const CREATE_ENDPOINT = '/api/admin/technicians/create';
export const UPDATE_ENDPOINT = '/api/admin/technicians/update';
export const ASSIGN_ENDPOINT = '/api/admin/technicians/assign';

const LIST_SQL = 'SELECT solar_app.fn_get_technician_details($1::jsonb) AS response';
const CREATE_SQL = 'SELECT solar_app.fn_create_technician_details($1::jsonb) AS response';
const UPDATE_SQL = 'SELECT solar_app.fn_update_technician_details($1::jsonb) AS response';
const ASSIGN_SQL = 'SELECT solar_app.fn_create_job_assignment_details($1::jsonb) AS response';

const ID_PATTERN = /^[0-9]{1,18}$/;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const RADIUS_PATTERN = /^[0-9]+(\.[0-9]{1,2})?$/;
const JOB_TYPES = new Set(['SERVICE_REQUEST', 'SITE_VISIT']);
const ALLOWED_CODES = new Set([200, 400, 401, 403, 404, 409, 500]);

function cleanObject(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  return body;
}

function requiredText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function optionalText(value, maxLength) {
  if (value === undefined || value === null || value === '') return { ok: true, value: undefined };
  if (typeof value !== 'string') return { ok: false };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: undefined };
  if (trimmed.length > maxLength) return { ok: false };
  return { ok: true, value: trimmed };
}

function optionalBoolean(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: undefined };
  if (typeof value === 'boolean') return { ok: true, value };
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (lowered === 'true') return { ok: true, value: true };
    if (lowered === 'false') return { ok: true, value: false };
  }
  return { ok: false };
}

function readResponse(value) {
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

export function validateTechnicianList(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };
  const request = {};
  if (Object.hasOwn(record, 'active_ind')) {
    const active = optionalBoolean(record.active_ind);
    if (!active.ok || active.value === undefined) {
      return { ok: false, message: 'active_ind is not valid' };
    }
    request.activeInd = active.value;
  }
  if (Object.hasOwn(record, 'is_available')) {
    const available = optionalBoolean(record.is_available);
    if (!available.ok || available.value === undefined) {
      return { ok: false, message: 'is_available is not valid' };
    }
    request.isAvailable = available.value;
  }
  return { ok: true, request };
}

export function validateTechnicianCreate(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };
  if (typeof record.country_id !== 'string' || !ID_PATTERN.test(record.country_id)) {
    return { ok: false, message: 'country_id is not valid' };
  }
  const national = requiredText(record.national_number, 20);
  if (!national || !/^[0-9]+$/.test(national)) {
    return { ok: false, message: 'Enter a valid mobile number' };
  }
  const fullName = requiredText(record.full_name, 150);
  if (!fullName) return { ok: false, message: 'Enter the technician name' };
  const employeeCode = requiredText(record.employee_code, 30);
  if (!employeeCode) return { ok: false, message: 'Enter an employee code' };
  if (record.pin !== undefined && record.pin !== null && String(record.pin).trim() !== '') {
    return { ok: false, message: 'PIN is not accepted for technician registration' };
  }
  if (record.pin_hash !== undefined && record.pin_hash !== null && String(record.pin_hash).trim() !== '') {
    return { ok: false, message: 'PIN is not accepted for technician registration' };
  }
  const email = optionalText(record.email, 150);
  if (!email.ok) return { ok: false, message: 'email must be 150 characters or fewer' };
  const radius = optionalText(record.service_radius_km, 20);
  if (!radius.ok || (radius.value && !RADIUS_PATTERN.test(radius.value))) {
    return { ok: false, message: 'service_radius_km is not valid' };
  }
  const available = optionalBoolean(record.is_available);
  if (!available.ok) return { ok: false, message: 'is_available is not valid' };
  const request = {
    countryId: record.country_id,
    nationalNumber: national,
    fullName,
    employeeCode,
  };
  if (email.value) request.email = email.value;
  if (radius.value) request.serviceRadiusKm = radius.value;
  if (available.value !== undefined) request.isAvailable = available.value;
  return { ok: true, request };
}

export function validateTechnicianUpdate(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };
  if (typeof record.technician_id !== 'string' || !ID_PATTERN.test(record.technician_id)) {
    return { ok: false, message: 'technician_id is required' };
  }
  const request = { technicianId: record.technician_id };
  let hasField = false;
  if (Object.hasOwn(record, 'full_name')) {
    const fullName = requiredText(record.full_name, 150);
    if (!fullName) return { ok: false, message: 'Enter the technician name' };
    request.fullName = fullName;
    hasField = true;
  }
  if (Object.hasOwn(record, 'email')) {
    const email = optionalText(record.email, 150);
    if (!email.ok) return { ok: false, message: 'email must be 150 characters or fewer' };
    request.email = email.value ?? '';
    hasField = true;
  }
  if (Object.hasOwn(record, 'employee_code')) {
    const employeeCode = requiredText(record.employee_code, 30);
    if (!employeeCode) return { ok: false, message: 'Enter an employee code' };
    request.employeeCode = employeeCode;
    hasField = true;
  }
  if (Object.hasOwn(record, 'service_radius_km')) {
    if (record.service_radius_km === null || record.service_radius_km === '') {
      request.serviceRadiusKm = null;
    } else if (typeof record.service_radius_km === 'string' && RADIUS_PATTERN.test(record.service_radius_km.trim())) {
      request.serviceRadiusKm = record.service_radius_km.trim();
    } else {
      return { ok: false, message: 'service_radius_km is not valid' };
    }
    hasField = true;
  }
  if (Object.hasOwn(record, 'is_available')) {
    const available = optionalBoolean(record.is_available);
    if (!available.ok || available.value === undefined) {
      return { ok: false, message: 'is_available is not valid' };
    }
    request.isAvailable = available.value;
    hasField = true;
  }
  if (Object.hasOwn(record, 'active_ind')) {
    const active = optionalBoolean(record.active_ind);
    if (!active.ok || active.value === undefined) {
      return { ok: false, message: 'active_ind is not valid' };
    }
    request.activeInd = active.value;
    hasField = true;
  }
  if (!hasField) return { ok: false, message: 'No technician fields to update' };
  return { ok: true, request };
}

export function validateJobAssign(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };
  const jobType = typeof record.job_type === 'string' ? record.job_type.trim().toUpperCase() : '';
  if (!JOB_TYPES.has(jobType)) {
    return { ok: false, message: 'job_type must be SERVICE_REQUEST or SITE_VISIT' };
  }
  if (typeof record.technician_id !== 'string' || !ID_PATTERN.test(record.technician_id)) {
    return { ok: false, message: 'technician_id is required' };
  }
  const request = { jobType, technicianId: record.technician_id };
  if (jobType === 'SERVICE_REQUEST') {
    if (typeof record.service_request_id !== 'string' || !ID_PATTERN.test(record.service_request_id)) {
      return { ok: false, message: 'service_request_id is required' };
    }
    request.serviceRequestId = record.service_request_id;
  } else {
    if (typeof record.site_visit_id !== 'string' || !ID_PATTERN.test(record.site_visit_id)) {
      return { ok: false, message: 'site_visit_id is required' };
    }
    request.siteVisitId = record.site_visit_id;
  }
  if (record.scheduled_on !== undefined && record.scheduled_on !== null && record.scheduled_on !== '') {
    if (typeof record.scheduled_on !== 'string' || !DATE_PATTERN.test(record.scheduled_on)) {
      return { ok: false, message: 'scheduled_on is not valid' };
    }
    request.scheduledOn = record.scheduled_on;
  }
  if (record.sequence_no !== undefined && record.sequence_no !== null && record.sequence_no !== '') {
    if (typeof record.sequence_no !== 'string' || !/^[0-9]{1,9}$/.test(record.sequence_no)) {
      return { ok: false, message: 'sequence_no is not valid' };
    }
    request.sequenceNo = record.sequence_no;
  }
  return { ok: true, request };
}

export function technicianAuditPayload(body) {
  const record = cleanObject(body) ?? {};
  const payload = {};
  for (const key of ['country_id', 'technician_id', 'service_request_id', 'site_visit_id', 'sequence_no']) {
    if (typeof record[key] === 'string') payload[key] = record[key].slice(0, 18);
  }
  if (typeof record.employee_code === 'string') payload.employee_code = record.employee_code.slice(0, 30);
  if (typeof record.job_type === 'string') payload.job_type = record.job_type.slice(0, 30);
  if (typeof record.scheduled_on === 'string') payload.scheduled_on = record.scheduled_on.slice(0, 10);
  if (typeof record.is_available === 'boolean') payload.is_available = record.is_available;
  if (typeof record.active_ind === 'boolean') payload.active_ind = record.active_ind;
  return payload;
}

export async function listTechnicians(query, request, tokenHash) {
  const payload = {
    api_endpoint: LIST_ENDPOINT,
    jwt_token_hash: tokenHash,
  };
  if (request.activeInd !== undefined) payload.active_ind = request.activeInd;
  if (request.isAvailable !== undefined) payload.is_available = request.isAvailable;
  const result = await query(LIST_SQL, [JSON.stringify(payload)]);
  return readResponse(result?.rows?.[0]?.response);
}

export async function createTechnician(query, request, tokenHash) {
  const payload = {
    api_endpoint: CREATE_ENDPOINT,
    jwt_token_hash: tokenHash,
    country_id: request.countryId,
    national_number: request.nationalNumber,
    full_name: request.fullName,
    employee_code: request.employeeCode,
  };
  if (request.email) payload.email = request.email;
  if (request.serviceRadiusKm) payload.service_radius_km = request.serviceRadiusKm;
  if (request.isAvailable !== undefined) payload.is_available = request.isAvailable;
  const result = await query(CREATE_SQL, [JSON.stringify(payload)]);
  return readResponse(result?.rows?.[0]?.response);
}

export async function updateTechnician(query, request, tokenHash) {
  const payload = {
    api_endpoint: UPDATE_ENDPOINT,
    jwt_token_hash: tokenHash,
    technician_id: request.technicianId,
  };
  if (request.fullName !== undefined) payload.full_name = request.fullName;
  if (request.email !== undefined) payload.email = request.email;
  if (request.employeeCode !== undefined) payload.employee_code = request.employeeCode;
  if (request.serviceRadiusKm !== undefined) payload.service_radius_km = request.serviceRadiusKm;
  if (request.isAvailable !== undefined) payload.is_available = request.isAvailable;
  if (request.activeInd !== undefined) payload.active_ind = request.activeInd;
  const result = await query(UPDATE_SQL, [JSON.stringify(payload)]);
  return readResponse(result?.rows?.[0]?.response);
}

export async function assignJob(query, request, tokenHash) {
  const payload = {
    api_endpoint: ASSIGN_ENDPOINT,
    jwt_token_hash: tokenHash,
    job_type: request.jobType,
    technician_id: request.technicianId,
  };
  if (request.serviceRequestId) payload.service_request_id = request.serviceRequestId;
  if (request.siteVisitId) payload.site_visit_id = request.siteVisitId;
  if (request.scheduledOn) payload.scheduled_on = request.scheduledOn;
  if (request.sequenceNo) payload.sequence_no = request.sequenceNo;
  const result = await query(ASSIGN_SQL, [JSON.stringify(payload)]);
  return readResponse(result?.rows?.[0]?.response);
}

export { enquiryTokenHash };
