import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enquiryTokenHash } from './catalogue.js';

export const LIST_ENDPOINT = '/api/kyc';
export const CREATE_ENDPOINT = '/api/kyc/create';
export const UPDATE_ENDPOINT = '/api/kyc/update';

const LIST_SQL = 'SELECT solar_app.fn_get_kyc_document_details($1::jsonb) AS response';
const CREATE_SQL = 'SELECT solar_app.fn_create_kyc_document_details($1::jsonb) AS response';
const UPDATE_SQL = 'SELECT solar_app.fn_update_kyc_document_details($1::jsonb) AS response';
const ID_PATTERN = /^[0-9]{1,18}$/;
const ALLOWED_CODES = new Set([200, 400, 401, 403, 404, 500]);
const BRD_MAX_BYTES = 2097152;
export const ALLOWED_KYC_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);
const ALLOWED_MIME_SET = new Set(ALLOWED_KYC_MIME_TYPES);
const MEDIA_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../media/kyc',
);

function normalizeMimeType(value) {
  if (typeof value !== 'string') return '';
  const mime = value.trim().toLowerCase();
  if (mime === 'image/jpg') return 'image/jpeg';
  return mime;
}

/** Detect MIME from file signatures. Returns null when unrecognized. */
export function detectKycMimeFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a
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
  if (
    buffer[0] === 0x25
    && buffer[1] === 0x50
    && buffer[2] === 0x44
    && buffer[3] === 0x46
  ) {
    return 'application/pdf';
  }
  return null;
}

function readDeclaredMime(record) {
  if (record.mime_type === undefined || record.mime_type === null || record.mime_type === '') {
    return { ok: true, mimeType: null };
  }
  if (typeof record.mime_type !== 'string') {
    return { ok: false, message: 'Unsupported document format' };
  }
  const mimeType = normalizeMimeType(record.mime_type);
  if (!mimeType || mimeType.length > 100 || !ALLOWED_MIME_SET.has(mimeType)) {
    return { ok: false, message: 'Unsupported document format' };
  }
  return { ok: true, mimeType };
}

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

const ALLOWED_KYC_STATUS_CODES = new Set([
  'KYC_PENDING',
  'KYC_APPROVED',
  'ACTION_REQUIRED',
]);

export function validateKycList(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };
  const request = {};
  if (record.site_id !== undefined && record.site_id !== null && record.site_id !== '') {
    if (typeof record.site_id !== 'string' || !ID_PATTERN.test(record.site_id)) {
      return { ok: false, message: 'Choose a site' };
    }
    request.siteId = record.site_id;
  }
  if (record.status_code !== undefined && record.status_code !== null && record.status_code !== '') {
    if (typeof record.status_code !== 'string') {
      return { ok: false, message: 'Choose a document status' };
    }
    const statusCode = record.status_code.trim().toUpperCase();
    if (!ALLOWED_KYC_STATUS_CODES.has(statusCode)) {
      return { ok: false, message: 'Choose a document status' };
    }
    request.statusCode = statusCode;
  }
  return { ok: true, request };
}

function extensionForMime(mime) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'application/pdf') return 'pdf';
  return 'bin';
}

export function validateKycCreate(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };
  if (typeof record.document_type_ref_data_id !== 'string'
    || !ID_PATTERN.test(record.document_type_ref_data_id)) {
    return { ok: false, message: 'Choose a document type' };
  }

  const request = {
    documentTypeId: record.document_type_ref_data_id,
  };

  if (record.site_id !== undefined && record.site_id !== null && record.site_id !== '') {
    if (typeof record.site_id !== 'string' || !ID_PATTERN.test(record.site_id)) {
      return { ok: false, message: 'Choose a site' };
    }
    request.siteId = record.site_id;
  }

  const declared = readDeclaredMime(record);
  if (!declared.ok) return declared;

  if (typeof record.file_base64 === 'string' && record.file_base64.trim() !== '') {
    let buffer;
    try {
      buffer = Buffer.from(record.file_base64.replace(/\s/g, ''), 'base64');
    } catch {
      return { ok: false, message: 'Upload a document file' };
    }
    if (!buffer.length) return { ok: false, message: 'Upload a document file' };
    if (buffer.length > BRD_MAX_BYTES) {
      return { ok: false, message: 'Document must be 2 MB or smaller' };
    }

    const detected = detectKycMimeFromBuffer(buffer);
    if (!detected || !ALLOWED_MIME_SET.has(detected)) {
      return { ok: false, message: 'Unsupported document format' };
    }
    if (declared.mimeType && declared.mimeType !== detected) {
      return { ok: false, message: 'Document content does not match the declared format' };
    }

    request.fileBuffer = buffer;
    request.fileSizeBytes = String(buffer.length);
    request.mimeType = detected;
  } else {
    if (typeof record.file_url !== 'string' || record.file_url.trim() === ''
      || record.file_url.trim().length > 500) {
      return { ok: false, message: 'Upload a document file' };
    }
    if (typeof record.file_size_bytes !== 'string'
      || !/^[0-9]{1,9}$/.test(record.file_size_bytes)) {
      return { ok: false, message: 'Document size is required' };
    }
    const size = Number(record.file_size_bytes);
    if (size <= 0) return { ok: false, message: 'Document size is required' };
    if (size > BRD_MAX_BYTES) {
      return { ok: false, message: 'Document must be 2 MB or smaller' };
    }
    if (!declared.mimeType) {
      return { ok: false, message: 'Unsupported document format' };
    }
    request.fileUrl = record.file_url.trim();
    request.fileSizeBytes = record.file_size_bytes;
    request.mimeType = declared.mimeType;
  }

  return { ok: true, request };
}

export function validateKycUpdate(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };
  if (typeof record.kyc_document_id !== 'string' || !ID_PATTERN.test(record.kyc_document_id)) {
    return { ok: false, message: 'Choose a KYC document' };
  }
  if (typeof record.action !== 'string') {
    return { ok: false, message: 'Choose approve or reject' };
  }
  const action = record.action.trim().toUpperCase();
  if (action !== 'APPROVE' && action !== 'REJECT') {
    return { ok: false, message: 'Choose approve or reject' };
  }
  const request = {
    kycDocumentId: record.kyc_document_id,
    action,
  };
  if (action === 'REJECT') {
    if (typeof record.rejection_comment !== 'string'
      || record.rejection_comment.trim() === ''
      || record.rejection_comment.trim().length > 500) {
      return { ok: false, message: 'Enter a rejection comment' };
    }
    request.rejectionComment = record.rejection_comment.trim();
  }
  return { ok: true, request };
}

export function kycAuditPayload(body) {
  const record = cleanObject(body) ?? {};
  const payload = {};
  if (typeof record.site_id === 'string') payload.site_id = record.site_id.slice(0, 18);
  if (typeof record.status_code === 'string') {
    payload.status_code = record.status_code.trim().toUpperCase().slice(0, 32);
  }
  if (typeof record.document_type_ref_data_id === 'string') {
    payload.document_type_ref_data_id = record.document_type_ref_data_id.slice(0, 18);
  }
  if (typeof record.kyc_document_id === 'string') {
    payload.kyc_document_id = record.kyc_document_id.slice(0, 18);
  }
  if (typeof record.action === 'string') payload.action = record.action.slice(0, 20);
  if (typeof record.file_size_bytes === 'string') {
    payload.file_size_bytes = record.file_size_bytes.slice(0, 12);
  }
  if (typeof record.mime_type === 'string') payload.mime_type = record.mime_type.slice(0, 100);
  if (typeof record.file_base64 === 'string' && record.file_base64.length > 0) {
    payload.file_base64 = '[redacted]';
  }
  return payload;
}

async function persistUpload(request) {
  if (!request.fileBuffer) return request.fileUrl;
  // Validation already enforced the allowlist; refuse to write anything else.
  if (!request.mimeType || !ALLOWED_MIME_SET.has(request.mimeType)) return null;
  await mkdir(MEDIA_ROOT, { recursive: true });
  const fileName = `${randomUUID()}.${extensionForMime(request.mimeType)}`;
  await writeFile(path.join(MEDIA_ROOT, fileName), request.fileBuffer);
  return `/media/kyc/${fileName}`;
}

export async function listKycDocuments(query, request, tokenHash) {
  const payload = {
    api_endpoint: LIST_ENDPOINT,
    jwt_token_hash: tokenHash,
  };
  if (request.siteId) payload.site_id = request.siteId;
  if (request.statusCode) payload.status_code = request.statusCode;
  const result = await query(LIST_SQL, [JSON.stringify(payload)]);
  return readResponse(result?.rows?.[0]?.response);
}

export async function createKycDocument(query, request, tokenHash) {
  if (!request.mimeType || !ALLOWED_MIME_SET.has(request.mimeType)) {
    return {
      status: 'ERROR',
      code: 400,
      message: 'Unsupported document format',
      data: null,
    };
  }
  const fileUrl = await persistUpload(request);
  if (!fileUrl) {
    return {
      status: 'ERROR',
      code: 400,
      message: 'Unsupported document format',
      data: null,
    };
  }
  const payload = {
    api_endpoint: CREATE_ENDPOINT,
    jwt_token_hash: tokenHash,
    document_type_ref_data_id: request.documentTypeId,
    file_url: fileUrl,
    file_size_bytes: request.fileSizeBytes,
    mime_type: request.mimeType,
  };
  if (request.siteId) payload.site_id = request.siteId;
  const result = await query(CREATE_SQL, [JSON.stringify(payload)]);
  return readResponse(result?.rows?.[0]?.response);
}

export async function updateKycDocument(query, request, tokenHash) {
  const payload = {
    api_endpoint: UPDATE_ENDPOINT,
    jwt_token_hash: tokenHash,
    kyc_document_id: request.kycDocumentId,
    action: request.action,
  };
  if (request.rejectionComment) payload.rejection_comment = request.rejectionComment;
  const result = await query(UPDATE_SQL, [JSON.stringify(payload)]);
  return readResponse(result?.rows?.[0]?.response);
}

export { enquiryTokenHash };
