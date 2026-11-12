import { enquiryTokenHash } from './catalogue.js';

export const CREATE_ENDPOINT = '/api/admin/customers/create';

const CREATE_SQL = 'SELECT solar_app.fn_create_user_details($1::jsonb) AS response';
const ID_PATTERN = /^[0-9]{1,18}$/;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const ORDER_STATUS = new Set(['ORD_INSTALLED', 'ORD_COMMISSIONED']);
const INSTALL_STATUS = new Set(['INST_INSTALLED', 'INST_COMMISSIONED']);
const ALLOWED_CODES = new Set([200, 400, 401, 403, 409, 500]);

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

function optionalId(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: undefined };
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) return { ok: false };
  return { ok: true, value };
}

function optionalNumericString(value, pattern) {
  if (value === undefined || value === null || value === '') return { ok: true, value: undefined };
  if (typeof value !== 'string') return { ok: false };
  const trimmed = value.trim();
  if (!pattern.test(trimmed)) return { ok: false };
  return { ok: true, value: trimmed };
}

function readEquipment(item, index) {
  const record = cleanObject(item);
  if (!record) {
    return { ok: false, message: `equipment[${index}] must be a JSON object` };
  }
  const typeCode = requiredText(record.equipment_type_code, 50);
  if (!typeCode) {
    return { ok: false, message: `equipment_type_code is required for equipment[${index}]` };
  }
  const equipment = { equipment_type_code: typeCode.toUpperCase() };

  const productId = optionalId(record.product_id);
  if (!productId.ok) return { ok: false, message: `product_id is not valid for equipment[${index}]` };
  if (productId.value) equipment.product_id = productId.value;

  const brandId = optionalId(record.brand_ref_data_id);
  if (!brandId.ok) {
    return { ok: false, message: `brand_ref_data_id is not valid for equipment[${index}]` };
  }
  if (brandId.value) equipment.brand_ref_data_id = brandId.value;

  for (const [key, max] of [
    ['model_name', 150],
    ['serial_no', 80],
    ['barcode', 80],
    ['monitoring_dongle_id', 80],
  ]) {
    const text = optionalText(record[key], max);
    if (!text.ok) return { ok: false, message: `${key} is too long for equipment[${index}]` };
    if (text.value) equipment[key] = text.value;
  }

  const quantity = optionalNumericString(record.quantity, /^[0-9]+(\.[0-9]+)?$/);
  if (!quantity.ok) return { ok: false, message: `quantity is not valid for equipment[${index}]` };
  if (quantity.value) equipment.quantity = quantity.value;

  for (const key of ['panel_wattage', 'inverter_capacity_kw', 'battery_capacity_ah']) {
    const numeric = optionalNumericString(record[key], /^[0-9]+(\.[0-9]+)?$/);
    if (!numeric.ok) return { ok: false, message: `${key} is not valid for equipment[${index}]` };
    if (numeric.value) equipment[key] = numeric.value;
  }

  const phaseId = optionalId(record.phase_type_ref_data_id);
  if (!phaseId.ok) {
    return { ok: false, message: `phase_type_ref_data_id is not valid for equipment[${index}]` };
  }
  if (phaseId.value) equipment.phase_type_ref_data_id = phaseId.value;

  const structureId = optionalId(record.structure_type_ref_data_id);
  if (!structureId.ok) {
    return { ok: false, message: `structure_type_ref_data_id is not valid for equipment[${index}]` };
  }
  if (structureId.value) equipment.structure_type_ref_data_id = structureId.value;

  if (record.commissioned_on !== undefined && record.commissioned_on !== null
    && record.commissioned_on !== '') {
    if (typeof record.commissioned_on !== 'string'
      || !DATE_PATTERN.test(record.commissioned_on.trim())) {
      return { ok: false, message: `commissioned_on is not valid for equipment[${index}]` };
    }
    equipment.commissioned_on = record.commissioned_on.trim();
  }

  return { ok: true, equipment };
}

function readSite(item, index) {
  const record = cleanObject(item);
  if (!record) return { ok: false, message: `sites[${index}] must be a JSON object` };

  const siteName = requiredText(record.site_name, 150);
  if (!siteName) return { ok: false, message: `Enter the site name for sites[${index}]` };
  const address1 = requiredText(record.address_line1, 255);
  if (!address1) return { ok: false, message: `Enter the site address for sites[${index}]` };

  const installStatus = requiredText(record.installation_status_code, 50);
  if (!installStatus || !INSTALL_STATUS.has(installStatus.toUpperCase())) {
    return {
      ok: false,
      message: `installation_status_code must be INST_INSTALLED or INST_COMMISSIONED for sites[${index}]`,
    };
  }
  const commissioningOn = requiredText(record.commissioning_on, 10);
  if (!commissioningOn || !DATE_PATTERN.test(commissioningOn)) {
    return { ok: false, message: `commissioning_on is required for sites[${index}]` };
  }
  if (!Array.isArray(record.equipment) || record.equipment.length < 1) {
    return { ok: false, message: `Add equipment for sites[${index}]` };
  }

  const site = {
    site_name: siteName,
    address_line1: address1,
    installation_status_code: installStatus.toUpperCase(),
    commissioning_on: commissioningOn,
  };

  const address2 = optionalText(record.address_line2, 255);
  if (!address2.ok) return { ok: false, message: `address_line2 is too long for sites[${index}]` };
  if (address2.value) site.address_line2 = address2.value;

  for (const key of ['pincode_id', 'city_id', 'district_id', 'state_id', 'discom_id',
    'connection_type_ref_data_id']) {
    const id = optionalId(record[key]);
    if (!id.ok) return { ok: false, message: `${key} is not valid for sites[${index}]` };
    if (id.value) site[key] = id.value;
  }

  const hasLat = record.latitude !== undefined && record.latitude !== null && record.latitude !== '';
  const hasLon = record.longitude !== undefined && record.longitude !== null && record.longitude !== '';
  if (hasLat !== hasLon) {
    return { ok: false, message: `Enter valid GPS coordinates for sites[${index}]` };
  }
  if (hasLat) {
    if (typeof record.latitude !== 'string' || typeof record.longitude !== 'string') {
      return { ok: false, message: `Enter valid GPS coordinates for sites[${index}]` };
    }
    site.latitude = record.latitude.trim();
    site.longitude = record.longitude.trim();
  }

  const consumer = optionalText(record.consumer_number, 50);
  if (!consumer.ok) return { ok: false, message: `consumer_number is too long for sites[${index}]` };
  if (consumer.value) site.consumer_number = consumer.value;
  const meter = optionalText(record.meter_number, 50);
  if (!meter.ok) return { ok: false, message: `meter_number is too long for sites[${index}]` };
  if (meter.value) site.meter_number = meter.value;

  const load = optionalNumericString(record.sanctioned_load_kw, /^[0-9]+(\.[0-9]+)?$/);
  if (!load.ok) return { ok: false, message: `sanctioned_load_kw is not valid for sites[${index}]` };
  if (load.value) site.sanctioned_load_kw = load.value;

  if (record.is_default === true || record.is_default === false) {
    site.is_default = record.is_default;
  } else if (record.is_default !== undefined && record.is_default !== null
    && record.is_default !== '') {
    return { ok: false, message: `is_default is not valid for sites[${index}]` };
  }

  const equipment = [];
  for (let i = 0; i < record.equipment.length; i += 1) {
    const parsed = readEquipment(record.equipment[i], i);
    if (!parsed.ok) return parsed;
    equipment.push(parsed.equipment);
  }
  site.equipment = equipment;
  return { ok: true, site };
}

function readOrderLine(item, index) {
  const record = cleanObject(item);
  if (!record) return { ok: false, message: `order_lines[${index}] must be a JSON object` };
  if (typeof record.line_no !== 'string' || !/^[0-9]{1,9}$/.test(record.line_no.trim())
    || Number(record.line_no.trim()) < 1) {
    return { ok: false, message: `line_no is required for order_lines[${index}]` };
  }
  const lineDesc = requiredText(record.line_desc, 255);
  if (!lineDesc) return { ok: false, message: `line_desc is required for order_lines[${index}]` };
  const lineAmount = optionalNumericString(record.line_amount, /^[0-9]+(\.[0-9]+)?$/);
  if (!lineAmount.ok || !lineAmount.value) {
    return { ok: false, message: `line_amount is required for order_lines[${index}]` };
  }
  const line = {
    line_no: record.line_no.trim(),
    line_desc: lineDesc,
    line_amount: lineAmount.value,
  };
  const productId = optionalId(record.product_id);
  if (!productId.ok) return { ok: false, message: `product_id is not valid for order_lines[${index}]` };
  if (productId.value) line.product_id = productId.value;
  const quantity = optionalNumericString(record.quantity, /^[0-9]+(\.[0-9]+)?$/);
  if (!quantity.ok) return { ok: false, message: `quantity is not valid for order_lines[${index}]` };
  if (quantity.value) line.quantity = quantity.value;
  const unitRate = optionalNumericString(record.unit_rate, /^[0-9]+(\.[0-9]+)?$/);
  if (!unitRate.ok) return { ok: false, message: `unit_rate is not valid for order_lines[${index}]` };
  if (unitRate.value) line.unit_rate = unitRate.value;
  const tax = optionalText(record.tax_classification_code, 30);
  if (!tax.ok) {
    return { ok: false, message: `tax_classification_code is too long for order_lines[${index}]` };
  }
  if (tax.value) line.tax_classification_code = tax.value;
  return { ok: true, line };
}

export function validateAdminCustomerCreate(body) {
  const record = cleanObject(body);
  if (!record) return { ok: false, message: 'Payload must be a JSON object' };

  if ((typeof record.pin === 'string' && record.pin.trim())
    || (typeof record.pin_hash === 'string' && record.pin_hash.trim())) {
    return { ok: false, message: 'PIN must not be set for Path B registration' };
  }

  const countryId = optionalId(record.country_id);
  if (!countryId.ok || !countryId.value) {
    return { ok: false, message: 'country_id is not valid' };
  }
  const national = requiredText(record.national_number, 15);
  if (!national || !/^[0-9]+$/.test(national)) {
    return { ok: false, message: 'Enter a valid mobile number' };
  }
  const fullName = requiredText(record.full_name, 150);
  if (!fullName) return { ok: false, message: 'Enter the customer name' };
  const customerCode = requiredText(record.customer_code, 30);
  if (!customerCode) return { ok: false, message: 'Enter a customer code' };
  const orderNo = requiredText(record.order_no, 30);
  if (!orderNo) return { ok: false, message: 'Enter an order number' };
  const orderStatus = requiredText(record.order_status_code, 50);
  if (!orderStatus || !ORDER_STATUS.has(orderStatus.toUpperCase())) {
    return { ok: false, message: 'order_status_code must be ORD_INSTALLED or ORD_COMMISSIONED' };
  }
  const currency = requiredText(record.currency_code, 3);
  if (!currency || !/^[A-Za-z]{3}$/.test(currency)) {
    return { ok: false, message: 'currency_code is required' };
  }
  if (!Array.isArray(record.sites) || record.sites.length < 1) {
    return { ok: false, message: 'Add at least one site' };
  }

  const request = {
    countryId: countryId.value,
    nationalNumber: national,
    fullName,
    customerCode,
    orderNo,
    orderStatusCode: orderStatus.toUpperCase(),
    currencyCode: currency.toUpperCase(),
  };

  const billingName = optionalText(record.billing_name, 150);
  if (!billingName.ok) return { ok: false, message: 'billing_name must be 150 characters or fewer' };
  if (billingName.value) request.billingName = billingName.value;

  const taxNo = optionalText(record.tax_registration_no, 50);
  if (!taxNo.ok) return { ok: false, message: 'tax_registration_no must be 50 characters or fewer' };
  if (taxNo.value) request.taxRegistrationNo = taxNo.value;

  const bill1 = optionalText(record.billing_address_line1, 255);
  if (!bill1.ok) {
    return { ok: false, message: 'billing_address_line1 must be 255 characters or fewer' };
  }
  if (bill1.value) request.billingAddressLine1 = bill1.value;
  const bill2 = optionalText(record.billing_address_line2, 255);
  if (!bill2.ok) {
    return { ok: false, message: 'billing_address_line2 must be 255 characters or fewer' };
  }
  if (bill2.value) request.billingAddressLine2 = bill2.value;

  const billPincode = optionalId(record.billing_pincode_id);
  if (!billPincode.ok) return { ok: false, message: 'billing_pincode_id is not valid' };
  if (billPincode.value) request.billingPincodeId = billPincode.value;

  const gross = optionalNumericString(record.gross_amount, /^[0-9]+(\.[0-9]+)?$/);
  if (!gross.ok) return { ok: false, message: 'gross_amount is not valid' };
  if (gross.value) request.grossAmount = gross.value;

  const remarks = optionalText(record.remarks, 500);
  if (!remarks.ok) return { ok: false, message: 'remarks must be 500 characters or fewer' };
  if (remarks.value) request.remarks = remarks.value;

  const sites = [];
  for (let i = 0; i < record.sites.length; i += 1) {
    const parsed = readSite(record.sites[i], i);
    if (!parsed.ok) return parsed;
    sites.push(parsed.site);
  }
  request.sites = sites;

  if (record.order_lines !== undefined && record.order_lines !== null) {
    if (!Array.isArray(record.order_lines)) {
      return { ok: false, message: 'order_lines must be a JSON array' };
    }
    const lines = [];
    for (let i = 0; i < record.order_lines.length; i += 1) {
      const parsed = readOrderLine(record.order_lines[i], i);
      if (!parsed.ok) return parsed;
      lines.push(parsed.line);
    }
    request.orderLines = lines;
  }

  return { ok: true, request };
}

export function adminCustomerAuditPayload(body) {
  const record = cleanObject(body) ?? {};
  const payload = {};
  if (typeof record.country_id === 'string') payload.country_id = record.country_id.slice(0, 18);
  if (typeof record.customer_code === 'string') {
    payload.customer_code = record.customer_code.trim().slice(0, 30);
  }
  if (typeof record.order_no === 'string') payload.order_no = record.order_no.trim().slice(0, 30);
  if (typeof record.order_status_code === 'string') {
    payload.order_status_code = record.order_status_code.trim().slice(0, 50);
  }
  if (Array.isArray(record.sites)) payload.site_count = record.sites.length;
  return payload;
}

export function readAdminCustomerResponse(value) {
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

export async function createAdminCustomer(query, request, tokenHash) {
  const payload = {
    api_endpoint: CREATE_ENDPOINT,
    jwt_token_hash: tokenHash,
    country_id: request.countryId,
    national_number: request.nationalNumber,
    full_name: request.fullName,
    customer_code: request.customerCode,
    order_no: request.orderNo,
    order_status_code: request.orderStatusCode,
    currency_code: request.currencyCode,
    sites: request.sites,
  };
  if (request.billingName) payload.billing_name = request.billingName;
  if (request.taxRegistrationNo) payload.tax_registration_no = request.taxRegistrationNo;
  if (request.billingAddressLine1) payload.billing_address_line1 = request.billingAddressLine1;
  if (request.billingAddressLine2) payload.billing_address_line2 = request.billingAddressLine2;
  if (request.billingPincodeId) payload.billing_pincode_id = request.billingPincodeId;
  if (request.grossAmount) payload.gross_amount = request.grossAmount;
  if (request.remarks) payload.remarks = request.remarks;
  if (request.orderLines) payload.order_lines = request.orderLines;

  const result = await query(CREATE_SQL, [JSON.stringify(payload)]);
  return readAdminCustomerResponse(result?.rows?.[0]?.response);
}

export { enquiryTokenHash };
