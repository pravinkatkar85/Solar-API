import { enquiryTokenHash } from './catalogue.js';

export const LIST_ENDPOINT = '/api/payments';
export const CREATE_ENDPOINT = '/api/admin/payments/create';
export const UPDATE_ENDPOINT = '/api/admin/payments/update';

const LIST_SQL = 'SELECT solar_app.fn_get_payment_details($1::jsonb) AS response';
const CREATE_SQL = 'SELECT solar_app.fn_create_payment_details($1::jsonb) AS response';
const UPDATE_SQL = 'SELECT solar_app.fn_update_payment_details($1::jsonb) AS response';

const ID_PATTERN = /^[0-9]{1,18}$/;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const AMOUNT_PATTERN = /^[0-9]+(\.[0-9]{1,2})?$/;
const METHOD_CODES = new Set([
  'PAY_CASH',
  'PAY_CHEQUE',
  'PAY_NEFT',
  'PAY_UPI_OFFLINE',
  'PAY_OTHER',
]);
const PAYMENT_STATUS_CODES = new Set(['PAY_RECORDED', 'PAY_CANCELLED']);
const ALLOWED_CODES = new Set([200, 400, 401, 403, 404, 409, 500]);

function cleanObject(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  return body;
}

function optionalId(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: undefined };
  const text = String(value).trim();
  if (!ID_PATTERN.test(text)) return { ok: false };
  return { ok: true, value: text };
}

function requiredId(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!ID_PATTERN.test(text)) return null;
  return text;
}

function optionalText(value, maxLength) {
  if (value === undefined || value === null) return { ok: true, value: undefined, clear: false };
  if (typeof value !== 'string') return { ok: false };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: undefined, clear: true };
  if (trimmed.length > maxLength) return { ok: false };
  return { ok: true, value: trimmed, clear: false };
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

export function validatePaymentList(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };

  const request = {};
  const paymentId = optionalId(record.payment_id);
  if (!paymentId.ok) return { ok: false, message: 'payment_id is not valid' };
  if (paymentId.value) request.paymentId = paymentId.value;

  const invoiceId = optionalId(record.invoice_id);
  if (!invoiceId.ok) return { ok: false, message: 'invoice_id is not valid' };
  if (invoiceId.value) request.invoiceId = invoiceId.value;

  const customerId = optionalId(record.customer_id);
  if (!customerId.ok) return { ok: false, message: 'customer_id is not valid' };
  if (customerId.value) request.customerId = customerId.value;

  if (Object.hasOwn(record, 'payment_status_code')) {
    if (typeof record.payment_status_code !== 'string') {
      return { ok: false, message: 'payment_status_code is not valid' };
    }
    const code = record.payment_status_code.trim().toUpperCase();
    if (!PAYMENT_STATUS_CODES.has(code)) {
      return { ok: false, message: 'payment_status_code is not valid' };
    }
    request.paymentStatusCode = code;
  }

  if (Object.hasOwn(record, 'active_ind')) {
    const active = optionalBoolean(record.active_ind);
    if (!active.ok || active.value === undefined) {
      return { ok: false, message: 'active_ind is not valid' };
    }
    request.activeInd = active.value;
  }

  return { ok: true, request };
}

export function validatePaymentCreate(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };

  const invoiceId = requiredId(record.invoice_id);
  if (!invoiceId) return { ok: false, message: 'invoice_id is required' };

  if (record.amount === undefined || record.amount === null) {
    return { ok: false, message: 'amount is required' };
  }
  const amountText = String(record.amount).trim();
  if (!AMOUNT_PATTERN.test(amountText) || Number(amountText) <= 0) {
    return { ok: false, message: 'amount must be greater than zero' };
  }

  if (typeof record.payment_method_code !== 'string') {
    return { ok: false, message: 'payment_method_code is not valid' };
  }
  const method = record.payment_method_code.trim().toUpperCase();
  if (!METHOD_CODES.has(method)) {
    return { ok: false, message: 'payment_method_code is not valid' };
  }

  if (typeof record.paid_on !== 'string' || !DATE_PATTERN.test(record.paid_on.trim())) {
    return { ok: false, message: 'paid_on is required' };
  }

  const instrument = optionalText(record.instrument_ref, 100);
  if (!instrument.ok) return { ok: false, message: 'instrument_ref must be 100 characters or fewer' };
  const remarks = optionalText(record.remarks, 500);
  if (!remarks.ok) return { ok: false, message: 'remarks must be 500 characters or fewer' };

  const customerId = optionalId(record.customer_id);
  if (!customerId.ok) return { ok: false, message: 'customer_id is not valid' };

  let currencyCode;
  if (Object.hasOwn(record, 'currency_code')
      && record.currency_code !== null
      && record.currency_code !== '') {
    if (typeof record.currency_code !== 'string'
        || !/^[A-Za-z]{3}$/.test(record.currency_code.trim())) {
      return { ok: false, message: 'currency_code is not valid' };
    }
    currencyCode = record.currency_code.trim().toUpperCase();
  }

  if (Object.hasOwn(record, 'payment_status_code')
      && record.payment_status_code !== null
      && String(record.payment_status_code).trim() !== '') {
    if (typeof record.payment_status_code !== 'string'
        || record.payment_status_code.trim().toUpperCase() !== 'PAY_RECORDED') {
      return { ok: false, message: 'payment_status_code must be PAY_RECORDED on create' };
    }
  }

  return {
    ok: true,
    request: {
      invoiceId,
      amount: amountText,
      paymentMethodCode: method,
      paidOn: record.paid_on.trim(),
      instrumentRef: instrument.value,
      remarks: remarks.value,
      customerId: customerId.value,
      currencyCode,
    },
  };
}

export function validatePaymentUpdate(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };

  const paymentId = requiredId(record.payment_id);
  if (!paymentId) return { ok: false, message: 'payment_id is required' };

  const request = { paymentId };

  if (Object.hasOwn(record, 'amount')) {
    if (record.amount === null || record.amount === '') {
      return { ok: false, message: 'amount must be greater than zero' };
    }
    const amountText = String(record.amount).trim();
    if (!AMOUNT_PATTERN.test(amountText) || Number(amountText) <= 0) {
      return { ok: false, message: 'amount must be greater than zero' };
    }
    request.amount = amountText;
  }

  if (Object.hasOwn(record, 'payment_method_code')) {
    if (typeof record.payment_method_code !== 'string') {
      return { ok: false, message: 'payment_method_code is not valid' };
    }
    const method = record.payment_method_code.trim().toUpperCase();
    if (!METHOD_CODES.has(method)) {
      return { ok: false, message: 'payment_method_code is not valid' };
    }
    request.paymentMethodCode = method;
  }

  if (Object.hasOwn(record, 'paid_on')) {
    if (typeof record.paid_on !== 'string' || !DATE_PATTERN.test(record.paid_on.trim())) {
      return { ok: false, message: 'paid_on is not valid' };
    }
    request.paidOn = record.paid_on.trim();
  }

  if (Object.hasOwn(record, 'instrument_ref')) {
    const instrument = optionalText(record.instrument_ref, 100);
    if (!instrument.ok) return { ok: false, message: 'instrument_ref must be 100 characters or fewer' };
    request.instrumentRef = instrument.value;
    request.clearInstrument = instrument.clear;
  }

  if (Object.hasOwn(record, 'remarks')) {
    const remarks = optionalText(record.remarks, 500);
    if (!remarks.ok) return { ok: false, message: 'remarks must be 500 characters or fewer' };
    request.remarks = remarks.value;
    request.clearRemarks = remarks.clear;
  }

  if (Object.hasOwn(record, 'payment_status_code')) {
    if (typeof record.payment_status_code !== 'string') {
      return { ok: false, message: 'payment_status_code is not valid' };
    }
    const code = record.payment_status_code.trim().toUpperCase();
    if (!PAYMENT_STATUS_CODES.has(code)) {
      return { ok: false, message: 'payment_status_code is not valid' };
    }
    request.paymentStatusCode = code;
  }

  if (Object.hasOwn(record, 'currency_code')) {
    if (typeof record.currency_code !== 'string'
        || !/^[A-Za-z]{3}$/.test(record.currency_code.trim())) {
      return { ok: false, message: 'currency_code is not valid' };
    }
    request.currencyCode = record.currency_code.trim().toUpperCase();
  }

  if (Object.hasOwn(record, 'active_ind')) {
    const active = optionalBoolean(record.active_ind);
    if (!active.ok || active.value === undefined) {
      return { ok: false, message: 'active_ind is not valid' };
    }
    request.activeInd = active.value;
  }

  return { ok: true, request };
}

export function paymentAuditPayload(body) {
  const record = cleanObject(body) ?? {};
  const audit = {};
  for (const key of [
    'payment_id',
    'invoice_id',
    'customer_id',
    'payment_method_code',
    'payment_status_code',
    'paid_on',
    'currency_code',
    'amount',
  ]) {
    if (record[key] !== undefined && record[key] !== null) {
      audit[key] = String(record[key]).slice(0, 64);
    }
  }
  if (typeof record.instrument_ref === 'string' && record.instrument_ref.trim()) {
    audit.has_instrument_ref = true;
  }
  return audit;
}

export async function listPayments(query, request, tokenHash) {
  const payload = {
    api_endpoint: LIST_ENDPOINT,
    jwt_token_hash: tokenHash,
  };
  if (request.paymentId) payload.payment_id = request.paymentId;
  if (request.invoiceId) payload.invoice_id = request.invoiceId;
  if (request.customerId) payload.customer_id = request.customerId;
  if (request.paymentStatusCode) payload.payment_status_code = request.paymentStatusCode;
  if (request.activeInd !== undefined) payload.active_ind = request.activeInd;

  const result = await query(LIST_SQL, [JSON.stringify(payload)]);
  return readResponse(result?.rows?.[0]?.response);
}

export async function createPayment(query, request, tokenHash) {
  const payload = {
    api_endpoint: CREATE_ENDPOINT,
    jwt_token_hash: tokenHash,
    invoice_id: request.invoiceId,
    amount: request.amount,
    payment_method_code: request.paymentMethodCode,
    paid_on: request.paidOn,
  };
  if (request.instrumentRef) payload.instrument_ref = request.instrumentRef;
  if (request.remarks) payload.remarks = request.remarks;
  if (request.customerId) payload.customer_id = request.customerId;
  if (request.currencyCode) payload.currency_code = request.currencyCode;

  const result = await query(CREATE_SQL, [JSON.stringify(payload)]);
  return readResponse(result?.rows?.[0]?.response);
}

export async function updatePayment(query, request, tokenHash) {
  const payload = {
    api_endpoint: UPDATE_ENDPOINT,
    jwt_token_hash: tokenHash,
    payment_id: request.paymentId,
  };
  if (request.amount !== undefined) payload.amount = request.amount;
  if (request.paymentMethodCode) payload.payment_method_code = request.paymentMethodCode;
  if (request.paidOn) payload.paid_on = request.paidOn;
  if (request.clearInstrument) payload.instrument_ref = '';
  else if (request.instrumentRef !== undefined) payload.instrument_ref = request.instrumentRef;
  if (request.clearRemarks) payload.remarks = '';
  else if (request.remarks !== undefined) payload.remarks = request.remarks;
  if (request.paymentStatusCode) payload.payment_status_code = request.paymentStatusCode;
  if (request.currencyCode) payload.currency_code = request.currencyCode;
  if (request.activeInd !== undefined) payload.active_ind = request.activeInd;

  const result = await query(UPDATE_SQL, [JSON.stringify(payload)]);
  return readResponse(result?.rows?.[0]?.response);
}

export { enquiryTokenHash };
