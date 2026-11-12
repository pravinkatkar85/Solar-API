import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enquiryTokenHash } from './catalogue.js';

export const LIST_ENDPOINT = '/api/technician/jobs';
export const UPDATE_ENDPOINT = '/api/technician/jobs/update';

const LIST_SQL = 'SELECT solar_app.fn_get_job_assignment_details($1::jsonb) AS response';
const UPDATE_SQL = 'SELECT solar_app.fn_update_job_assignment_details($1::jsonb) AS response';

const ID_PATTERN = /^[0-9]{1,18}$/;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const ACTIONS = new Set(['ACCEPT', 'RESCHEDULE', 'START', 'COMPLETE']);
const MEDIA_PURPOSES = new Set(['BEFORE', 'AFTER', 'INVERTER_STATUS', 'OTHER']);
const ALLOWED_CODES = new Set([200, 400, 401, 403, 404, 409, 500]);
const BRD_MAX_BYTES = 2097152;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MEDIA_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../media/jobs',
);

function cleanObject(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  return body;
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

function normalizeMime(value) {
  if (typeof value !== 'string') return '';
  const mime = value.trim().toLowerCase();
  return mime === 'image/jpg' ? 'image/jpeg' : mime;
}

function extensionForMime(mime) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

function detectMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (
    buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12
    && buffer[0] === 0x52
    && buffer[1] === 0x49
    && buffer[2] === 0x46
    && buffer[3] === 0x46
    && buffer[8] === 0x57
    && buffer[9] === 0x45
    && buffer[10] === 0x42
    && buffer[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

async function persistImage(base64, declaredMime) {
  let buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    return { ok: false, message: 'Invalid image data' };
  }
  if (!buffer.length || buffer.length > BRD_MAX_BYTES) {
    return { ok: false, message: 'Image must be 2 MB or smaller' };
  }
  const detected = detectMime(buffer);
  const mime = detected || normalizeMime(declaredMime);
  if (!mime || !ALLOWED_MIME.has(mime)) {
    return { ok: false, message: 'Unsupported image format' };
  }
  if (detected && declaredMime && normalizeMime(declaredMime) !== detected) {
    return { ok: false, message: 'Unsupported image format' };
  }
  await mkdir(MEDIA_ROOT, { recursive: true });
  const fileName = `${randomUUID()}.${extensionForMime(mime)}`;
  await writeFile(path.join(MEDIA_ROOT, fileName), buffer);
  return { ok: true, fileUrl: `/media/jobs/${fileName}` };
}

export function validateJobList(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };
  const request = {};
  if (record.job_id !== undefined && record.job_id !== null && record.job_id !== '') {
    if (typeof record.job_id !== 'string' || !ID_PATTERN.test(record.job_id)) {
      return { ok: false, message: 'job_id is not valid' };
    }
    request.jobId = record.job_id;
  }
  return { ok: true, request };
}

function validateChecklist(array) {
  if (!Array.isArray(array)) return { ok: false, message: 'checklist_responses must be a JSON array' };
  const responses = [];
  for (let i = 0; i < array.length; i += 1) {
    const item = cleanObject(array[i]);
    if (!item) return { ok: false, message: 'Each checklist response must be an object' };
    if (typeof item.checklist_item_id !== 'string' || !ID_PATTERN.test(item.checklist_item_id)) {
      return { ok: false, message: 'checklist_item_id is required' };
    }
    const response = { checklist_item_id: item.checklist_item_id };
    if (item.is_pass !== undefined && item.is_pass !== null && item.is_pass !== '') {
      if (typeof item.is_pass === 'boolean') response.is_pass = item.is_pass;
      else if (typeof item.is_pass === 'string' && ['true', 'false'].includes(item.is_pass.trim().toLowerCase())) {
        response.is_pass = item.is_pass.trim().toLowerCase() === 'true';
      } else {
        return { ok: false, message: 'is_pass is not valid' };
      }
    }
    if (item.measured_value !== undefined && item.measured_value !== null && item.measured_value !== '') {
      if (typeof item.measured_value !== 'string' || item.measured_value.trim().length > 100) {
        return { ok: false, message: 'measured_value must be 100 characters or fewer' };
      }
      response.measured_value = item.measured_value.trim();
    }
    if (item.remarks !== undefined && item.remarks !== null && item.remarks !== '') {
      if (typeof item.remarks !== 'string' || item.remarks.trim().length > 500) {
        return { ok: false, message: 'remarks must be 500 characters or fewer' };
      }
      response.remarks = item.remarks.trim();
    }
    responses.push(response);
  }
  return { ok: true, responses };
}

async function validateMedia(array) {
  if (!Array.isArray(array)) return { ok: false, message: 'media must be a JSON array' };
  const media = [];
  for (let i = 0; i < array.length; i += 1) {
    const item = cleanObject(array[i]);
    if (!item) return { ok: false, message: 'Each media item must be an object' };
    const purpose = typeof item.media_purpose === 'string'
      ? item.media_purpose.trim().toUpperCase()
      : '';
    if (!MEDIA_PURPOSES.has(purpose)) {
      return { ok: false, message: 'media_purpose is not valid' };
    }
    let fileUrl;
    if (typeof item.file_base64 === 'string' && item.file_base64.trim()) {
      const saved = await persistImage(item.file_base64.trim(), item.mime_type);
      if (!saved.ok) return saved;
      fileUrl = saved.fileUrl;
    } else if (typeof item.file_url === 'string' && item.file_url.trim()) {
      if (item.file_url.trim().length > 500) return { ok: false, message: 'file_url is required' };
      fileUrl = item.file_url.trim();
    } else {
      return { ok: false, message: 'file_url is required' };
    }
    const entry = { media_purpose: purpose, file_url: fileUrl };
    if (typeof item.captured_on === 'string' && item.captured_on.trim()) {
      entry.captured_on = item.captured_on.trim();
    }
    media.push(entry);
  }
  return { ok: true, media };
}

async function validateSignature(value) {
  const record = cleanObject(value);
  if (!record) return { ok: false, message: 'signature is required' };
  let signatureUrl;
  if (typeof record.signature_base64 === 'string' && record.signature_base64.trim()) {
    const saved = await persistImage(record.signature_base64.trim(), record.mime_type || 'image/png');
    if (!saved.ok) return saved;
    signatureUrl = saved.fileUrl;
  } else if (typeof record.signature_url === 'string' && record.signature_url.trim()) {
    if (record.signature_url.trim().length > 500) {
      return { ok: false, message: 'signature_url is required' };
    }
    signatureUrl = record.signature_url.trim();
  } else {
    return { ok: false, message: 'signature_url is required' };
  }
  const signature = { signature_url: signatureUrl };
  if (typeof record.signer_name === 'string' && record.signer_name.trim()) {
    if (record.signer_name.trim().length > 150) {
      return { ok: false, message: 'signer_name must be 150 characters or fewer' };
    }
    signature.signer_name = record.signer_name.trim();
  }
  if (typeof record.signed_on === 'string' && record.signed_on.trim()) {
    signature.signed_on = record.signed_on.trim();
  }
  return { ok: true, signature };
}

export async function validateJobUpdate(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };
  const action = typeof record.action === 'string' ? record.action.trim().toUpperCase() : '';
  if (!ACTIONS.has(action)) {
    return { ok: false, message: 'action must be ACCEPT, RESCHEDULE, START, or COMPLETE' };
  }
  if (typeof record.job_id !== 'string' || !ID_PATTERN.test(record.job_id)) {
    return { ok: false, message: 'job_id is required' };
  }
  const request = { action, jobId: record.job_id };
  if (action === 'RESCHEDULE') {
    const reason = typeof record.accept_reject_reason === 'string'
      ? record.accept_reject_reason.trim()
      : (typeof record.reason === 'string' ? record.reason.trim() : '');
    if (!reason || reason.length > 500) {
      return { ok: false, message: 'Enter a reschedule reason' };
    }
    if (typeof record.scheduled_on !== 'string' || !DATE_PATTERN.test(record.scheduled_on)) {
      return { ok: false, message: 'scheduled_on is required to reschedule' };
    }
    request.acceptRejectReason = reason;
    request.scheduledOn = record.scheduled_on;
  }
  if (action === 'COMPLETE') {
    const checklist = validateChecklist(record.checklist_responses);
    if (!checklist.ok) return checklist;
    const media = await validateMedia(record.media);
    if (!media.ok) return media;
    const signature = await validateSignature(record.signature);
    if (!signature.ok) return signature;
    request.checklistResponses = checklist.responses;
    request.media = media.media;
    request.signature = signature.signature;
  }
  return { ok: true, request };
}

export function jobAuditPayload(body) {
  const record = cleanObject(body) ?? {};
  const payload = {};
  if (typeof record.job_id === 'string') payload.job_id = record.job_id.slice(0, 18);
  if (typeof record.action === 'string') payload.action = record.action.slice(0, 20);
  if (typeof record.scheduled_on === 'string') payload.scheduled_on = record.scheduled_on.slice(0, 10);
  if (Array.isArray(record.media)) payload.media_count = record.media.length;
  if (Array.isArray(record.checklist_responses)) {
    payload.checklist_count = record.checklist_responses.length;
  }
  if (record.signature) payload.signature = '[present]';
  return payload;
}

export async function listJobs(query, request, tokenHash) {
  const payload = {
    api_endpoint: LIST_ENDPOINT,
    jwt_token_hash: tokenHash,
  };
  if (request.jobId) payload.job_id = request.jobId;
  const result = await query(LIST_SQL, [JSON.stringify(payload)]);
  return readResponse(result?.rows?.[0]?.response);
}

export async function updateJob(query, request, tokenHash) {
  const payload = {
    api_endpoint: UPDATE_ENDPOINT,
    jwt_token_hash: tokenHash,
    action: request.action,
    job_id: request.jobId,
  };
  if (request.acceptRejectReason) payload.accept_reject_reason = request.acceptRejectReason;
  if (request.scheduledOn) payload.scheduled_on = request.scheduledOn;
  if (request.checklistResponses) payload.checklist_responses = request.checklistResponses;
  if (request.media) payload.media = request.media;
  if (request.signature) payload.signature = request.signature;
  const result = await query(UPDATE_SQL, [JSON.stringify(payload)]);
  return readResponse(result?.rows?.[0]?.response);
}

export { enquiryTokenHash };
