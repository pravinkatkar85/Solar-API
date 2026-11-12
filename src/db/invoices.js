import { enquiryTokenHash } from './catalogue.js';

export const LIST_ENDPOINT = '/api/invoices';
export const CREATE_ENDPOINT = '/api/admin/invoices/create';
export const UPDATE_ENDPOINT = '/api/admin/invoices/update';

const LIST_SQL = 'SELECT solar_app.fn_get_invoice_details($1::jsonb) AS response';
const CREATE_SQL = 'SELECT solar_app.fn_create_invoice_details($1::jsonb) AS response';
const UPDATE_SQL = 'SELECT solar_app.fn_update_invoice_details($1::jsonb) AS response';

const ID_PATTERN = /^[0-9]{1,18}$/;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const AMOUNT_PATTERN = /^[0-9]+(\.[0-9]{1,2})?$/;
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;
const CATEGORY_CODES = new Set([
  'INV_INSTALL',
  'INV_AMC',
  'INV_SPARE',
  'INV_CLEANING',
]);
const CREATE_STATUS_CODES = new Set(['INV_DRAFT', 'INV_UNPAID']);
const UPDATE_STATUS_CODES = new Set(['INV_DRAFT', 'INV_UNPAID', 'INV_CANCELLED']);
const CALC_METHODS = new Set(['PERCENTAGE', 'FIXED_AMOUNT']);
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

function requiredText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
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

function parseAmount(value, { required = false, allowZero = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) return { ok: false };
    return { ok: true, value: undefined };
  }
  const text = String(value).trim();
  if (!AMOUNT_PATTERN.test(text)) return { ok: false };
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || numeric < 0) return { ok: false };
  if (!allowZero && numeric <= 0) return { ok: false };
  return { ok: true, value: text };
}

function parseOptionalLinkId(record, key) {
  if (!Object.hasOwn(record, key)) return { ok: true };
  if (record[key] === null || record[key] === '') {
    return { ok: true, clear: true };
  }
  const id = optionalId(record[key]);
  if (!id.ok || !id.value) return { ok: false };
  return { ok: true, value: id.value };
}

function validateLines(value) {
  if (value === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(value)) return { ok: false, message: 'lines must be an array' };
  const lines = [];
  const seen = new Set();
  for (const row of value) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      return { ok: false, message: 'each invoice line must be an object' };
    }
    const lineNoRaw = row.line_no;
    const lineNo = Number(lineNoRaw);
    if (!Number.isInteger(lineNo) || lineNo < 1) {
      return { ok: false, message: 'line_no must be a positive integer' };
    }
    if (seen.has(lineNo)) {
      return { ok: false, message: 'line_no values must be unique' };
    }
    seen.add(lineNo);

    const lineDesc = requiredText(row.line_desc, 255);
    if (!lineDesc) return { ok: false, message: 'line_desc is required' };

    const lineAmount = parseAmount(row.line_amount, { required: true });
    if (!lineAmount.ok) return { ok: false, message: 'line_amount is not valid' };

    const line = {
      line_no: lineNo,
      line_desc: lineDesc,
      line_amount: lineAmount.value,
    };

    if (Object.hasOwn(row, 'quantity') && row.quantity !== null && row.quantity !== '') {
      const quantityText = String(row.quantity).trim();
      if (!AMOUNT_PATTERN.test(quantityText) || Number(quantityText) <= 0) {
        return { ok: false, message: 'quantity must be greater than zero' };
      }
      line.quantity = quantityText;
    }

    if (Object.hasOwn(row, 'unit_rate') && row.unit_rate !== null && row.unit_rate !== '') {
      const unitRate = parseAmount(row.unit_rate, { required: true });
      if (!unitRate.ok) return { ok: false, message: 'unit_rate is not valid' };
      line.unit_rate = unitRate.value;
    }

    if (Object.hasOwn(row, 'tax_classification_code')
        && row.tax_classification_code !== null
        && row.tax_classification_code !== '') {
      if (typeof row.tax_classification_code !== 'string'
          || row.tax_classification_code.trim().length > 30) {
        return { ok: false, message: 'tax_classification_code must be 30 characters or fewer' };
      }
      line.tax_classification_code = row.tax_classification_code.trim();
    }

    lines.push(line);
  }
  return { ok: true, value: lines };
}

function validateTaxSnapshots(value) {
  if (value === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(value)) return { ok: false, message: 'tax_snapshots must be an array' };
  const snapshots = [];
  for (const row of value) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      return { ok: false, message: 'each tax snapshot must be an object' };
    }

    const taxGroup = requiredText(row.tax_group_code, 50);
    if (!taxGroup) return { ok: false, message: 'tax_group_code is required' };
    const taxComponent = requiredText(row.tax_component_code, 50);
    if (!taxComponent) return { ok: false, message: 'tax_component_code is required' };
    const displayName = requiredText(row.tax_display_name, 150);
    if (!displayName) return { ok: false, message: 'tax_display_name is required' };

    if (typeof row.calculation_method !== 'string') {
      return { ok: false, message: 'calculation_method is not valid' };
    }
    const method = row.calculation_method.trim().toUpperCase();
    if (!CALC_METHODS.has(method)) {
      return { ok: false, message: 'calculation_method is not valid' };
    }

    const taxable = parseAmount(row.taxable_amount, { required: true });
    if (!taxable.ok) return { ok: false, message: 'taxable_amount is not valid' };
    const taxAmount = parseAmount(row.tax_amount, { required: true });
    if (!taxAmount.ok) return { ok: false, message: 'tax_amount is not valid' };

    const snapshot = {
      tax_group_code: taxGroup,
      tax_component_code: taxComponent,
      tax_display_name: displayName,
      calculation_method: method,
      taxable_amount: taxable.value,
      tax_amount: taxAmount.value,
    };

    if (method === 'PERCENTAGE') {
      if (Object.hasOwn(row, 'configured_rate_amount')
          && row.configured_rate_amount !== null
          && row.configured_rate_amount !== '') {
        return { ok: false, message: 'configured_rate_amount is not allowed for PERCENTAGE' };
      }
      const rate = parseAmount(row.rate_percent, { required: true });
      if (!rate.ok || Number(rate.value) > 100) {
        return { ok: false, message: 'rate_percent must be between 0 and 100' };
      }
      snapshot.rate_percent = rate.value;
    } else {
      if (Object.hasOwn(row, 'rate_percent')
          && row.rate_percent !== null
          && row.rate_percent !== '') {
        return { ok: false, message: 'rate_percent is not allowed for FIXED_AMOUNT' };
      }
      const fixed = parseAmount(row.configured_rate_amount, { required: true });
      if (!fixed.ok) {
        return { ok: false, message: 'configured_rate_amount is not valid' };
      }
      snapshot.configured_rate_amount = fixed.value;
    }

    if (Object.hasOwn(row, 'jurisdiction_json') && row.jurisdiction_json !== null) {
      if (typeof row.jurisdiction_json !== 'object' || Array.isArray(row.jurisdiction_json)) {
        return { ok: false, message: 'jurisdiction_json must be an object' };
      }
      snapshot.jurisdiction_json = row.jurisdiction_json;
    }

    if (Object.hasOwn(row, 'line_no') && row.line_no !== null && row.line_no !== '') {
      const lineNo = Number(row.line_no);
      if (!Number.isInteger(lineNo) || lineNo < 1) {
        return { ok: false, message: 'tax snapshot line_no must be a positive integer' };
      }
      snapshot.line_no = lineNo;
    }

    snapshots.push(snapshot);
  }
  return { ok: true, value: snapshots };
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

function applyOptionalHeaderFields(record, request, { allowCancelledStatus }) {
  if (Object.hasOwn(record, 'invoice_no')) {
    const invoiceNo = requiredText(record.invoice_no, 40);
    if (!invoiceNo) return { ok: false, message: 'invoice_no must be 1 to 40 characters' };
    request.invoiceNo = invoiceNo;
  }

  if (Object.hasOwn(record, 'customer_id')) {
    const customerId = requiredId(record.customer_id);
    if (!customerId) return { ok: false, message: 'customer_id is not valid' };
    request.customerId = customerId;
  }

  if (Object.hasOwn(record, 'invoice_date')) {
    if (typeof record.invoice_date !== 'string' || !DATE_PATTERN.test(record.invoice_date.trim())) {
      return { ok: false, message: 'invoice_date is not valid' };
    }
    request.invoiceDate = record.invoice_date.trim();
  }

  if (Object.hasOwn(record, 'currency_code')) {
    if (typeof record.currency_code !== 'string'
        || !CURRENCY_PATTERN.test(record.currency_code.trim())) {
      return { ok: false, message: 'currency_code is not valid' };
    }
    request.currencyCode = record.currency_code.trim().toUpperCase();
  }

  if (Object.hasOwn(record, 'invoice_category_code')) {
    if (typeof record.invoice_category_code !== 'string') {
      return { ok: false, message: 'invoice_category_code is not valid' };
    }
    const category = record.invoice_category_code.trim().toUpperCase();
    if (!CATEGORY_CODES.has(category)) {
      return { ok: false, message: 'invoice_category_code is not valid' };
    }
    request.invoiceCategoryCode = category;
  }

  if (Object.hasOwn(record, 'invoice_status_code')
      && record.invoice_status_code !== null
      && String(record.invoice_status_code).trim() !== '') {
    if (typeof record.invoice_status_code !== 'string') {
      return { ok: false, message: 'invoice_status_code is not valid' };
    }
    const status = record.invoice_status_code.trim().toUpperCase();
    const allowed = allowCancelledStatus ? UPDATE_STATUS_CODES : CREATE_STATUS_CODES;
    if (!allowed.has(status)) {
      return { ok: false, message: 'invoice_status_code is not valid' };
    }
    request.invoiceStatusCode = status;
  }

  if (Object.hasOwn(record, 'taxable_amount')) {
    const taxable = parseAmount(record.taxable_amount, { required: true });
    if (!taxable.ok) return { ok: false, message: 'taxable_amount is not valid' };
    request.taxableAmount = taxable.value;
  }

  if (Object.hasOwn(record, 'tax_amount')) {
    const taxAmount = parseAmount(record.tax_amount, { required: true });
    if (!taxAmount.ok) return { ok: false, message: 'tax_amount is not valid' };
    request.taxAmount = taxAmount.value;
  }

  if (Object.hasOwn(record, 'total_amount')) {
    const total = parseAmount(record.total_amount, { required: true });
    if (!total.ok) return { ok: false, message: 'total_amount is not valid' };
    request.totalAmount = total.value;
  }

  for (const key of [
    'site_id',
    'related_order_id',
    'related_amc_contract_id',
    'related_service_request_id',
    'related_spare_part_request_id',
  ]) {
    const link = parseOptionalLinkId(record, key);
    if (!link.ok) return { ok: false, message: `${key} is not valid` };
    if (link.clear) {
      request.clearFields = request.clearFields ?? {};
      request.clearFields[key] = true;
    } else if (link.value) {
      request[key] = link.value;
    }
  }

  if (Object.hasOwn(record, 'remarks')) {
    const remarks = optionalText(record.remarks, 500);
    if (!remarks.ok) return { ok: false, message: 'remarks must be 500 characters or fewer' };
    request.remarks = remarks.value;
    request.clearRemarks = remarks.clear;
  }

  if (Object.hasOwn(record, 'lines')) {
    const lines = validateLines(record.lines);
    if (!lines.ok) return { ok: false, message: lines.message };
    request.lines = lines.value;
  }

  if (Object.hasOwn(record, 'tax_snapshots')) {
    const snapshots = validateTaxSnapshots(record.tax_snapshots);
    if (!snapshots.ok) return { ok: false, message: snapshots.message };
    request.taxSnapshots = snapshots.value;
  }

  return { ok: true };
}

export function validateInvoiceList(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };

  const request = {};
  const invoiceId = optionalId(record.invoice_id);
  if (!invoiceId.ok) return { ok: false, message: 'invoice_id is not valid' };
  if (invoiceId.value) request.invoiceId = invoiceId.value;

  const customerId = optionalId(record.customer_id);
  if (!customerId.ok) return { ok: false, message: 'customer_id is not valid' };
  if (customerId.value) request.customerId = customerId.value;

  if (Object.hasOwn(record, 'active_ind')) {
    const active = optionalBoolean(record.active_ind);
    if (!active.ok || active.value === undefined) {
      return { ok: false, message: 'active_ind is not valid' };
    }
    request.activeInd = active.value;
  }

  return { ok: true, request };
}

export function validateInvoiceCreate(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };

  const invoiceNo = requiredText(record.invoice_no, 40);
  if (!invoiceNo) return { ok: false, message: 'invoice_no is required' };

  const customerId = requiredId(record.customer_id);
  if (!customerId) return { ok: false, message: 'customer_id is required' };

  if (typeof record.invoice_date !== 'string' || !DATE_PATTERN.test(record.invoice_date.trim())) {
    return { ok: false, message: 'invoice_date is required' };
  }

  if (typeof record.currency_code !== 'string'
      || !CURRENCY_PATTERN.test(record.currency_code.trim())) {
    return { ok: false, message: 'currency_code is not valid' };
  }

  if (typeof record.invoice_category_code !== 'string') {
    return { ok: false, message: 'invoice_category_code is not valid' };
  }
  const category = record.invoice_category_code.trim().toUpperCase();
  if (!CATEGORY_CODES.has(category)) {
    return { ok: false, message: 'invoice_category_code is not valid' };
  }

  const total = parseAmount(record.total_amount, { required: true });
  if (!total.ok) return { ok: false, message: 'total_amount is required' };

  const request = {
    invoiceNo,
    customerId,
    invoiceDate: record.invoice_date.trim(),
    currencyCode: record.currency_code.trim().toUpperCase(),
    invoiceCategoryCode: category,
    totalAmount: total.value,
  };

  const optional = applyOptionalHeaderFields(record, request, { allowCancelledStatus: false });
  if (!optional.ok) return optional;

  // Required create fields already set; optional helper may overwrite with same values.
  request.invoiceNo = invoiceNo;
  request.customerId = customerId;
  request.invoiceDate = record.invoice_date.trim();
  request.currencyCode = record.currency_code.trim().toUpperCase();
  request.invoiceCategoryCode = category;
  request.totalAmount = total.value;

  return { ok: true, request };
}

export function validateInvoiceUpdate(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };

  const invoiceId = requiredId(record.invoice_id);
  if (!invoiceId) return { ok: false, message: 'invoice_id is required' };

  const request = { invoiceId };
  const optional = applyOptionalHeaderFields(record, request, { allowCancelledStatus: true });
  if (!optional.ok) return optional;

  if (Object.hasOwn(record, 'active_ind')) {
    const active = optionalBoolean(record.active_ind);
    if (!active.ok || active.value === undefined) {
      return { ok: false, message: 'active_ind is not valid' };
    }
    request.activeInd = active.value;
  }

  return { ok: true, request };
}

export function invoiceAuditPayload(body) {
  const record = cleanObject(body) ?? {};
  const audit = {};
  for (const key of [
    'invoice_id',
    'invoice_no',
    'customer_id',
    'invoice_date',
    'currency_code',
    'invoice_category_code',
    'invoice_status_code',
    'taxable_amount',
    'tax_amount',
    'total_amount',
    'site_id',
    'related_order_id',
    'related_amc_contract_id',
    'related_service_request_id',
    'related_spare_part_request_id',
    'active_ind',
  ]) {
    if (record[key] !== undefined && record[key] !== null) {
      audit[key] = String(record[key]).slice(0, 64);
    }
  }
  if (Array.isArray(record.lines)) audit.line_count = record.lines.length;
  if (Array.isArray(record.tax_snapshots)) audit.tax_snapshot_count = record.tax_snapshots.length;
  if (typeof record.remarks === 'string' && record.remarks.trim()) audit.has_remarks = true;
  return audit;
}

function appendOptionalFields(payload, request) {
  if (request.invoiceNo) payload.invoice_no = request.invoiceNo;
  if (request.customerId) payload.customer_id = request.customerId;
  if (request.invoiceDate) payload.invoice_date = request.invoiceDate;
  if (request.currencyCode) payload.currency_code = request.currencyCode;
  if (request.invoiceCategoryCode) payload.invoice_category_code = request.invoiceCategoryCode;
  if (request.invoiceStatusCode) payload.invoice_status_code = request.invoiceStatusCode;
  if (request.taxableAmount !== undefined) payload.taxable_amount = request.taxableAmount;
  if (request.taxAmount !== undefined) payload.tax_amount = request.taxAmount;
  if (request.totalAmount !== undefined) payload.total_amount = request.totalAmount;
  for (const key of [
    'site_id',
    'related_order_id',
    'related_amc_contract_id',
    'related_service_request_id',
    'related_spare_part_request_id',
  ]) {
    if (request.clearFields?.[key]) payload[key] = '';
    else if (request[key]) payload[key] = request[key];
  }
  if (request.clearRemarks) payload.remarks = '';
  else if (request.remarks !== undefined) payload.remarks = request.remarks;
  if (request.lines !== undefined) payload.lines = request.lines;
  if (request.taxSnapshots !== undefined) payload.tax_snapshots = request.taxSnapshots;
  if (request.activeInd !== undefined) payload.active_ind = request.activeInd;
}

export async function listInvoices(query, request, tokenHash) {
  const payload = {
    api_endpoint: LIST_ENDPOINT,
    jwt_token_hash: tokenHash,
  };
  if (request.invoiceId) payload.invoice_id = request.invoiceId;
  if (request.customerId) payload.customer_id = request.customerId;
  if (request.activeInd !== undefined) payload.active_ind = request.activeInd;

  const result = await query(LIST_SQL, [JSON.stringify(payload)]);
  return readResponse(result?.rows?.[0]?.response);
}

export async function createInvoice(query, request, tokenHash) {
  const payload = {
    api_endpoint: CREATE_ENDPOINT,
    jwt_token_hash: tokenHash,
    invoice_no: request.invoiceNo,
    customer_id: request.customerId,
    invoice_date: request.invoiceDate,
    currency_code: request.currencyCode,
    invoice_category_code: request.invoiceCategoryCode,
    total_amount: request.totalAmount,
  };
  appendOptionalFields(payload, request);

  const result = await query(CREATE_SQL, [JSON.stringify(payload)]);
  return readResponse(result?.rows?.[0]?.response);
}

export async function updateInvoice(query, request, tokenHash) {
  const payload = {
    api_endpoint: UPDATE_ENDPOINT,
    jwt_token_hash: tokenHash,
    invoice_id: request.invoiceId,
  };
  appendOptionalFields(payload, request);

  const result = await query(UPDATE_SQL, [JSON.stringify(payload)]);
  return readResponse(result?.rows?.[0]?.response);
}

export { enquiryTokenHash };
