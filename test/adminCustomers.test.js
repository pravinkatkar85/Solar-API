import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createSessionToken, hashSessionToken } from '../src/db/auth.js';

const TEST_SECRET = 'test-secret-at-least-32-characters-long';

function appWith(handler) {
  const calls = [];
  const query = async (text, params) => {
    calls.push({ text, params });
    return handler(text, params, calls);
  };
  return { app: createApp({ query, checkDatabaseConnection: async () => true }), calls };
}

function validBody(overrides = {}) {
  return {
    country_id: '1',
    national_number: '9900110003',
    full_name: 'Path B Customer',
    customer_code: 'PATHB-CUST-0001',
    order_no: 'PATHB-ORD-0001',
    order_status_code: 'ORD_COMMISSIONED',
    currency_code: 'INR',
    sites: [
      {
        site_name: 'Home',
        address_line1: '1 Test Lane',
        installation_status_code: 'INST_COMMISSIONED',
        commissioning_on: '2026-01-15',
        is_default: true,
        equipment: [
          { equipment_type_code: 'EQ_PANEL', quantity: '8' },
          { equipment_type_code: 'EQ_INVERTER', quantity: '1' },
        ],
      },
      {
        site_name: 'Farm',
        address_line1: '2 Farm Road',
        installation_status_code: 'INST_INSTALLED',
        commissioning_on: '2026-01-20',
        equipment: [{ equipment_type_code: 'EQ_PANEL', quantity: '4' }],
      },
    ],
    order_lines: [
      {
        line_no: '1',
        line_desc: 'Path B kit',
        quantity: '1',
        unit_rate: '0',
        line_amount: '0',
      },
    ],
    ...overrides,
  };
}

describe('POST /api/admin/customers/create', () => {
  it('registers a Path B customer and forwards the full payload with JWT hash only', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app, calls } = appWith(async (text, params) => {
      if (text.includes('log_api_execution')) return { rows: [] };
      if (!text.includes('fn_create_user_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.api_endpoint, '/api/admin/customers/create');
      assert.equal(payload.jwt_token_hash, hashSessionToken(token));
      assert.equal(payload.user_id, undefined);
      assert.equal(payload.role, undefined);
      assert.equal(payload.customer_id, undefined);
      assert.equal(payload.logged_in_user_id, undefined);
      assert.equal(payload.pin, undefined);
      assert.equal(payload.pin_hash, undefined);
      assert.equal(payload.customer_code, 'PATHB-CUST-0001');
      assert.equal(payload.order_no, 'PATHB-ORD-0001');
      assert.equal(payload.order_status_code, 'ORD_COMMISSIONED');
      assert.equal(payload.sites.length, 2);
      assert.equal(payload.sites[0].equipment.length, 2);
      assert.equal(payload.order_lines.length, 1);
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Customer registered',
            data: {
              user_id: '14',
              customer_id: '4',
              customer_code: 'PATHB-CUST-0001',
              order_id: '2',
              order_no: 'PATHB-ORD-0001',
              site_ids: ['6', '7'],
              equipment_ids: ['8', '9', '10'],
              notification_id: '2',
            },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/admin/customers/create')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody({
        role: 'ROLE_ADMIN',
        user_id: '99',
        customer_id: '88',
        logged_in_user_id: '77',
      }));

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'SUCCESS');
    assert.equal(response.body.data.customer_code, 'PATHB-CUST-0001');
    assert.equal(response.body.data.site_ids.length, 2);
    assert.equal(calls.some((call) => call.text.includes('fn_create_user_details')), true);
    const audit = calls.find((call) => call.text.includes('log_api_execution'));
    assert.ok(audit);
    assert.equal(JSON.parse(audit.params[3]).customer_code, 'PATHB-CUST-0001');
    assert.equal(JSON.parse(audit.params[3]).pin, undefined);
  });

  it('rejects missing authentication before calling SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app)
      .post('/api/admin/customers/create')
      .send(validBody());
    assert.equal(response.status, 401);
    assert.equal(response.body.message, 'Authentication is required');
    assert.equal(calls.some((call) => call.text.includes('fn_create_user_details')), false);
  });

  it('maps non-admin SQL rejection to HTTP 403', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app } = appWith(async (text) => {
      if (text.includes('log_api_execution')) return { rows: [] };
      return {
        rows: [{
          response: {
            status: 'ERROR',
            code: 403,
            message: 'Only an administrator can register Path B customers',
            data: null,
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/admin/customers/create')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody());

    assert.equal(response.status, 403);
    assert.equal(response.body.status, 'ERROR');
  });

  it('maps duplicate mobile SQL rejection to HTTP 409', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app } = appWith(async (text) => {
      if (text.includes('log_api_execution')) return { rows: [] };
      return {
        rows: [{
          response: {
            status: 'ERROR',
            code: 409,
            message: 'An account with this mobile number already exists',
            data: null,
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/admin/customers/create')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody());

    assert.equal(response.status, 409);
    assert.match(response.body.message, /mobile number already exists/);
  });

  it('rejects transport validation failures before SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app, calls } = appWith(async () => ({ rows: [] }));

    const missingSites = await request(app)
      .post('/api/admin/customers/create')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody({ sites: [] }));
    assert.equal(missingSites.status, 400);
    assert.match(missingSites.body.message, /site/i);

    const withPin = await request(app)
      .post('/api/admin/customers/create')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody({ pin: '1234' }));
    assert.equal(withPin.status, 400);
    assert.match(withPin.body.message, /PIN/);

    assert.equal(calls.some((call) => call.text.includes('fn_create_user_details')), false);
  });

  it('maps unexpected SQL failure and keeps Path A auth routes unchanged', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app } = appWith(async (text) => {
      if (text.includes('log_api_execution')) return { rows: [] };
      if (text.includes('fn_create_user_details')) {
        const error = new Error('transaction rolled back');
        error.code = 'P0001';
        throw error;
      }
      return { rows: [] };
    });

    const response = await request(app)
      .post('/api/admin/customers/create')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody());
    assert.equal(response.status, 500);
    assert.equal(response.body.status, 'ERROR');
    assert.equal(response.body.message, 'Customer could not be registered');
    assert.equal(response.body.data, null);

    const authProbe = await request(app)
      .post('/api/auth/register')
      .send({});
    assert.notEqual(authProbe.status, 404);
  });

  it('treats malformed SQL envelopes as HTTP 500', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app } = appWith(async (text) => {
      if (text.includes('log_api_execution')) return { rows: [] };
      return { rows: [{ response: { ok: true } }] };
    });

    const response = await request(app)
      .post('/api/admin/customers/create')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody());
    assert.equal(response.status, 500);
    assert.equal(response.body.message, 'Customer could not be registered');
  });
});
