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
    return handler(text, params);
  };
  return { app: createApp({ query, checkDatabaseConnection: async () => true }), calls };
}

describe('POST /api/service-requests', () => {
  it('lists the session customer requests and ignores a client user id', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app, calls } = appWith(async (text, params) => {
      if (!text.includes('fn_get_service_request_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.api_endpoint, '/api/service-requests');
      assert.equal(payload.jwt_token_hash, hashSessionToken(token));
      assert.equal(payload.user_id, undefined);
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Service requests loaded',
            data: { service_requests: [{ service_request_no: 'SR-00000003', site_name: 'Home rooftop' }] },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ user_id: '99' });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.service_requests[0].service_request_no, 'SR-00000003');
  });

  it('books a visit for an owned site without a client user id', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app } = appWith(async (text, params) => {
      if (!text.includes('fn_create_service_request_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.site_id, '4');
      assert.equal(payload.service_type_ref_data_id, '76');
      assert.equal(payload.user_id, undefined);
      assert.equal(payload.logged_in_user_id, undefined);
      assert.equal(payload.amc_contract_id, undefined);
      assert.equal(payload.quoted_charge_amount, undefined);
      assert.equal(payload.credit_seq, undefined);
      assert.equal(payload.reservation_status, undefined);
      assert.equal(payload.milestone_id, undefined);
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Service request booked',
            data: { service_request_no: 'SR-00000004', quote_confirmed: false },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/service-requests/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        user_id: '99',
        role: 'ADMIN',
        amc_contract_id: '3',
        quoted_charge_amount: '0',
        credit_seq: '1',
        reservation_status: 'RESERVED',
        site_id: '4',
        service_type_ref_data_id: '76',
        slot_window_ref_data_id: '79',
        preferred_on: '2026-11-02',
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.service_request_no, 'SR-00000004');
    assert.equal(response.body.data.quote_confirmed, false);
  });

  it('forwards an optional milestone id and ignores client fee fields', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app } = appWith(async (text, params) => {
      if (!text.includes('fn_create_service_request_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.milestone_id, '5');
      assert.equal(payload.quoted_charge_amount, undefined);
      assert.equal(payload.amc_contract_id, undefined);
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Service request booked',
            data: { service_request_id: '8', quote_confirmed: true, coverage: 'AMC_CREDIT' },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/service-requests/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        site_id: '4',
        service_type_ref_data_id: '76',
        slot_window_ref_data_id: '79',
        preferred_on: '2025-08-01',
        milestone_id: '5',
        quoted_charge_amount: '125.50',
        amc_contract_id: '3',
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.coverage, 'AMC_CREDIT');
  });

  it('rejects an invalid milestone id before calling SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app)
      .post('/api/service-requests/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        site_id: '4',
        service_type_ref_data_id: '76',
        slot_window_ref_data_id: '79',
        preferred_on: '2025-08-01',
        milestone_id: '5abc',
      });
    assert.equal(response.status, 400);
    assert.equal(response.body.message, 'Choose a service visit');
    assert.equal(calls.some((call) => call.text.includes('fn_create_service_request_details')), false);
  });

  it('rejects a list with no bearer token before calling SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app).post('/api/service-requests').send({});
    assert.equal(response.status, 401);
    assert.equal(calls.some((call) => call.text.includes('fn_get_service_request_details')), false);
  });
});

describe('POST /api/service-requests/update', () => {
  it('requires authentication before calling the update function', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app)
      .post('/api/service-requests/update')
      .send({ action: 'CANCEL', service_request_id: '4' });
    assert.equal(response.status, 401);
    assert.equal(response.body.message, 'Authentication is required');
    assert.equal(calls.some((call) => call.text.includes('fn_update_service_request_details')), false);
  });

  it('rejects an unknown action before calling SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app)
      .post('/api/service-requests/update')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'COMPLETE', service_request_id: '4' });
    assert.equal(response.status, 400);
    assert.equal(response.body.message, 'Choose cancel, lapse, or reschedule');
    assert.equal(calls.some((call) => call.text.includes('fn_update_service_request_details')), false);
  });

  it('rejects a reschedule that confirms only part of the fee', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app)
      .post('/api/service-requests/update')
      .set('Authorization', `Bearer ${token}`)
      .send({
        action: 'RESCHEDULE',
        service_request_id: '4',
        preferred_on: '2026-11-18',
        confirmed_charge_amount: '750',
        user_id: '99',
      });
    assert.equal(response.status, 400);
    assert.equal(response.body.message, 'Confirm the new visit fee');
    assert.equal(calls.some((call) => call.text.includes('fn_update_service_request_details')), false);
  });

  it('returns a fee preview without treating it as a reschedule', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app } = appWith(async (text, params) => {
      if (!text.includes('fn_update_service_request_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.api_endpoint, '/api/service-requests/update');
      assert.equal(payload.jwt_token_hash, hashSessionToken(token));
      assert.equal(payload.action, 'RESCHEDULE');
      assert.equal(payload.service_request_id, '4');
      assert.equal(payload.preferred_on, '2026-11-18');
      assert.equal(payload.confirmed_charge_amount, undefined);
      assert.equal(payload.confirmed_currency_code, undefined);
      assert.equal(payload.confirmed_visit_charge_slab_id, undefined);
      assert.equal(payload.user_id, undefined);
      assert.equal(payload.amc_contract_id, undefined);
      assert.equal(payload.reservation_status, undefined);
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Confirm the new visit fee',
            data: {
              confirmation_required: true,
              service_request_id: '4',
              quoted_charge_amount: 750,
              quoted_currency_code: 'INR',
              visit_charge_slab_id: '12',
              coverage: 'PAID_SLAB',
            },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/service-requests/update')
      .set('Authorization', `Bearer ${token}`)
      .send({
        action: 'reschedule',
        service_request_id: '4',
        preferred_on: '2026-11-18',
        user_id: '99',
        amc_contract_id: '3',
        quoted_charge_amount: '1',
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'SUCCESS');
    assert.equal(response.body.message, 'Confirm the new visit fee');
    assert.notEqual(response.body.message, 'Service request rescheduled');
    assert.equal(response.body.data.confirmation_required, true);
    assert.equal(response.body.data.quoted_charge_amount, 750);
    assert.equal(response.body.data.visit_charge_slab_id, '12');
  });

  it('forwards a full confirmation and returns the function result', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app } = appWith(async (text, params) => {
      if (!text.includes('fn_update_service_request_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.action, 'RESCHEDULE');
      assert.equal(payload.confirmed_charge_amount, '0');
      assert.equal(payload.confirmed_currency_code, 'inr');
      assert.equal(payload.confirmed_visit_charge_slab_id, '12');
      assert.equal(payload.user_id, undefined);
      assert.equal(payload.logged_in_user_id, undefined);
      assert.equal(payload.credit_seq, undefined);
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Service request rescheduled',
            data: {
              confirmation_required: false,
              service_request_id: '4',
              quoted_charge_amount: 0,
              visit_charge_slab_id: '12',
              coverage: 'AMC_CREDIT',
            },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/service-requests/update')
      .set('Authorization', `Bearer ${token}`)
      .send({
        action: 'RESCHEDULE',
        service_request_id: '4',
        preferred_on: '2026-11-18',
        confirmed_charge_amount: '0',
        confirmed_currency_code: 'inr',
        confirmed_visit_charge_slab_id: '12',
        user_id: '99',
        credit_seq: '1',
        reservation_status: 'RESERVED',
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.message, 'Service request rescheduled');
    assert.equal(response.body.data.confirmation_required, false);
    assert.equal(response.body.data.coverage, 'AMC_CREDIT');
  });

  it('cancels with only the action and request id', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app } = appWith(async (text, params) => {
      if (!text.includes('fn_update_service_request_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.deepEqual(Object.keys(payload).sort(), ['action', 'api_endpoint', 'jwt_token_hash', 'service_request_id']);
      assert.equal(payload.action, 'CANCEL');
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Service request cancelled',
            data: { service_request_id: '4', status_code: 'SR_CANCELLED', credit_released: true },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/service-requests/update')
      .set('Authorization', `Bearer ${token}`)
      .send({
        action: 'CANCEL',
        service_request_id: '4',
        preferred_on: '2026-11-18',
        confirmed_charge_amount: '750',
        user_id: '99',
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.status_code, 'SR_CANCELLED');
    assert.equal(response.body.data.credit_released, true);
  });

  it('lapses with only the action and request id', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app } = appWith(async (text, params) => {
      if (!text.includes('fn_update_service_request_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.deepEqual(Object.keys(payload).sort(), ['action', 'api_endpoint', 'jwt_token_hash', 'service_request_id']);
      assert.equal(payload.action, 'LAPSE');
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Service request lapsed',
            data: { service_request_id: '4', status_code: 'SR_LAPSED', credit_released: true },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/service-requests/update')
      .set('Authorization', `Bearer ${token}`)
      .send({
        action: 'lapse',
        service_request_id: '4',
        confirmed_charge_amount: '0',
        reservation_status: 'RELEASED',
        user_id: '99',
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.status_code, 'SR_LAPSED');
  });

  it('keeps a confirmation mismatch as HTTP 400 with confirmation_required', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app } = appWith(async (text, params) => {
      if (!text.includes('fn_update_service_request_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.confirmed_charge_amount, '10');
      assert.equal(payload.confirmed_currency_code, 'INR');
      assert.equal(payload.confirmed_visit_charge_slab_id, '12');
      return {
        rows: [{
          response: {
            status: 'ERROR',
            code: 400,
            message: 'Confirm the new visit fee',
            data: {
              confirmation_required: true,
              service_request_id: '4',
              quoted_charge_amount: 0,
              quoted_currency_code: 'INR',
              visit_charge_slab_id: '12',
            },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/service-requests/update')
      .set('Authorization', `Bearer ${token}`)
      .send({
        action: 'RESCHEDULE',
        service_request_id: '4',
        preferred_on: '2026-11-18',
        confirmed_charge_amount: '10',
        confirmed_currency_code: 'INR',
        confirmed_visit_charge_slab_id: '12',
      });

    assert.equal(response.status, 400);
    assert.equal(response.body.status, 'ERROR');
    assert.equal(response.body.data.confirmation_required, true);
    assert.equal(response.body.data.quoted_charge_amount, 0);
  });
});

describe('POST /api/service-requests/complete', () => {
  it('requires authentication before completing a visit', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app)
      .post('/api/service-requests/complete')
      .send({ service_request_id: '4' });
    assert.equal(response.status, 401);
    assert.equal(calls.some((call) => call.text.includes('fn_update_site_visit_details')), false);
  });

  it('completes from the request id and ignores client fee fields', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app } = appWith(async (text, params) => {
      if (!text.includes('fn_update_site_visit_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.api_endpoint, '/api/service-requests/complete');
      assert.equal(payload.jwt_token_hash, hashSessionToken(token));
      assert.deepEqual(Object.keys(payload).sort(), ['api_endpoint', 'jwt_token_hash', 'service_request_id']);
      assert.equal(payload.service_request_id, '4');
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Site visit completed',
            data: { service_request_id: '4', visit_no: 'SV-00000004', coverage: 'AMC_CREDIT' },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/service-requests/complete')
      .set('Authorization', `Bearer ${token}`)
      .send({
        service_request_id: '4',
        user_id: '99',
        role: 'TECHNICIAN',
        amc_contract_id: '3',
        reservation_status: 'CONSUMED',
        charge_amount: '0',
        quoted_charge_amount: '0',
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.message, 'Site visit completed');
    assert.equal(response.body.data.visit_no, 'SV-00000004');
    assert.equal(response.body.data.coverage, 'AMC_CREDIT');
  });

  it('rejects a missing service request id before calling SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app)
      .post('/api/service-requests/complete')
      .set('Authorization', `Bearer ${token}`)
      .send({ charge_amount: '0' });
    assert.equal(response.status, 400);
    assert.equal(response.body.message, 'Choose a service request');
    assert.equal(calls.some((call) => call.text.includes('fn_update_site_visit_details')), false);
  });

  it('returns a database completion rejection unchanged', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app } = appWith(async (text) => {
      if (!text.includes('fn_update_site_visit_details')) return { rows: [] };
      return {
        rows: [{
          response: {
            status: 'ERROR',
            code: 400,
            message: 'This visit is already completed',
            data: null,
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/service-requests/complete')
      .set('Authorization', `Bearer ${token}`)
      .send({ service_request_id: '4' });

    assert.equal(response.status, 400);
    assert.equal(response.body.status, 'ERROR');
    assert.equal(response.body.message, 'This visit is already completed');
    assert.equal(response.body.data, null);
  });
});
