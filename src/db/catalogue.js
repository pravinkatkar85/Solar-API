import { readBearerToken, readJwtSecret, verifySessionToken } from './auth.js';

export const LIST_ENDPOINT = '/api/catalogue/products';
export const ENQUIRY_ENDPOINT = '/api/catalogue/enquiries';
export const ENQUIRY_LIST_ENDPOINT = '/api/catalogue/enquiries/list';
export const ENQUIRY_ACTION_ENDPOINT = '/api/catalogue/enquiries/action';

const LIST_SQL = 'SELECT solar_app.fn_get_product_details($1::jsonb) AS response';
const ENQUIRY_SQL = 'SELECT solar_app.fn_create_product_enquiry_details($1::jsonb) AS response';
const ENQUIRY_LIST_SQL = 'SELECT solar_app.fn_get_product_enquiry_details($1::jsonb) AS response';
const ENQUIRY_ACTION_SQL = 'SELECT solar_app.fn_update_product_enquiry_details($1::jsonb) AS response';

const ID_PATTERN = /^[0-9]{1,18}$/;
const ALLOWED_CODES = new Set([200, 400, 401, 403, 404, 500]);

function cleanObject(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  return body;
}

function readId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value) ? value : null;
}

export function validateProductRequest(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };
  const request = {};
  if (record.product_id !== undefined && record.product_id !== null && record.product_id !== '') {
    const productId = readId(record.product_id);
    if (!productId) return { ok: false, message: 'Choose a product' };
    request.productId = productId;
  }
  if (
    record.category_ref_data_id !== undefined &&
    record.category_ref_data_id !== null &&
    record.category_ref_data_id !== ''
  ) {
    const categoryId = readId(record.category_ref_data_id);
    if (!categoryId) return { ok: false, message: 'Choose a category' };
    request.categoryId = categoryId;
  }
  return { ok: true, request };
}

export function validateEnquiryRequest(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };
  const productId = readId(record.product_id);
  if (!productId) return { ok: false, message: 'Choose a product' };
  if (typeof record.message_text !== 'string' || record.message_text.trim().length === 0) {
    return { ok: false, message: 'Enter a requirement of 2000 characters or fewer' };
  }
  const messageText = record.message_text.trim();
  if (messageText.length > 2000) {
    return { ok: false, message: 'Enter a requirement of 2000 characters or fewer' };
  }
  const request = { productId, messageText };
  if (typeof record.preferred_contact_window === 'string' && record.preferred_contact_window.trim()) {
    const windowText = record.preferred_contact_window.trim();
    if (windowText.length > 50) {
      return { ok: false, message: 'Preferred contact window must be 50 characters or fewer' };
    }
    request.preferredContactWindow = windowText;
  }
  if (record.pincode_id !== undefined && record.pincode_id !== null && record.pincode_id !== '') {
    const pincodeId = readId(record.pincode_id);
    if (!pincodeId) return { ok: false, message: 'Choose a valid pincode' };
    request.pincodeId = pincodeId;
  }
  return { ok: true, request };
}

export function validateEnquiryListRequest(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };
  return { ok: true, request: {} };
}

export function validateEnquiryActionRequest(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };
  const productEnquiryId = readId(record.product_enquiry_id);
  if (!productEnquiryId) return { ok: false, message: 'Choose an enquiry' };
  if (record.action !== 'cancel' && record.action !== 'followup') {
    return { ok: false, message: 'Choose an enquiry action' };
  }
  const request = { productEnquiryId, action: record.action };
  if (typeof record.note === 'string' && record.note.trim()) {
    const note = record.note.trim();
    if (note.length > 1000) {
      return { ok: false, message: 'Note must be 1000 characters or fewer' };
    }
    request.note = note;
  }
  return { ok: true, request };
}

export function catalogueAuditPayload(body) {
  const record = cleanObject(body) ?? {};
  const payload = {};
  if (typeof record.product_id === 'string') payload.product_id = record.product_id.slice(0, 18);
  if (typeof record.product_enquiry_id === 'string') {
    payload.product_enquiry_id = record.product_enquiry_id.slice(0, 18);
  }
  if (record.action === 'cancel' || record.action === 'followup') payload.action = record.action;
  if (typeof record.category_ref_data_id === 'string') {
    payload.category_ref_data_id = record.category_ref_data_id.slice(0, 18);
  }
  return payload;
}

export function readCatalogueResponse(value) {
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

export async function listProducts(query, request) {
  const payload = { api_endpoint: LIST_ENDPOINT };
  if (request.productId) payload.product_id = request.productId;
  if (request.categoryId) payload.category_ref_data_id = request.categoryId;
  const result = await query(LIST_SQL, [JSON.stringify(payload)]);
  return readCatalogueResponse(result?.rows?.[0]?.response);
}

export async function listEnquiries(query, _request, tokenHash) {
  const payload = {
    api_endpoint: ENQUIRY_LIST_ENDPOINT,
    jwt_token_hash: tokenHash,
  };
  const result = await query(ENQUIRY_LIST_SQL, [JSON.stringify(payload)]);
  return readCatalogueResponse(result?.rows?.[0]?.response);
}

export async function updateEnquiry(query, request, tokenHash) {
  const payload = {
    api_endpoint: ENQUIRY_ACTION_ENDPOINT,
    jwt_token_hash: tokenHash,
    product_enquiry_id: request.productEnquiryId,
    action: request.action,
  };
  if (request.note) payload.note = request.note;
  const result = await query(ENQUIRY_ACTION_SQL, [JSON.stringify(payload)]);
  return readCatalogueResponse(result?.rows?.[0]?.response);
}

export async function createEnquiry(query, request, tokenHash) {
  const payload = {
    api_endpoint: ENQUIRY_ENDPOINT,
    jwt_token_hash: tokenHash,
    product_id: request.productId,
    message_text: request.messageText,
  };
  if (request.preferredContactWindow) {
    payload.preferred_contact_window = request.preferredContactWindow;
  }
  if (request.pincodeId) payload.pincode_id = request.pincodeId;
  const result = await query(ENQUIRY_SQL, [JSON.stringify(payload)]);
  return readCatalogueResponse(result?.rows?.[0]?.response);
}

export function enquiryTokenHash(authorization) {
  const secret = readJwtSecret();
  if (!secret) return { secretMissing: true, tokenHash: null };
  return {
    secretMissing: false,
    tokenHash: verifySessionToken(readBearerToken(authorization), secret),
  };
}
