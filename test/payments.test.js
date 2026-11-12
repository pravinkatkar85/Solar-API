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

describe('POST /api/admin/payments/create', () => {
  it('creates a payment for an authenticated admin and forwards jwt hash only', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '10', TEST_SECRET);
    const { app, calls } = appWith(async (text, params) => {
      if (!text.includes('fn_create_payment_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.api_endpoint, '/api/admin/payments/create');
      assert.equal(payload.jwt_token_hash, hashSessionToken(token));
      assert.equal(payload.user_id, undefined);
      assert.equal(payload.role, undefined);
      assert.equal(payload.invoice_id, '55');
      assert.equal(payload.amount, '500.00');
      assert.equal(payload.payment_method_code, 'PAY_CASH');
      assert.equal(payload.paid_on, '2026-11-12');
      assert.equal(payload.instrument_ref, 'RCPT-1');
      assert.equal(payload.paid_amount, undefined);
      assert.equal(payload.balance_amount, undefined);
      assert.equal(payload.is_offline_ind, undefined);
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Payment recorded',
            data: {
              payment_id: '101',
              invoice_id: '55',
              amount: 500,
              invoice_paid_amount: 500,
              invoice_balance_amount: 0,
              invoice_status_code: 'INV_PAID',
              is_offline_ind: true,
            },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/admin/payments/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        invoice_id: '55',
        amount: '500.00',
        payment_method_code: 'PAY_CASH',
        paid_on: '2026-11-12',
        instrument_ref: 'RCPT-1',
        user_id: '99',
        role: 'ROLE_ADMIN',
        paid_amount: '0',
        balance_amount: '0',
        invoice_status_code: 'INV_UNPAID',
        is_offline_ind: false,
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.payment_id, '101');
    assert.equal(response.body.data.invoice_status_code, 'INV_PAID');
    assert.equal(response.body.data.invoice_paid_amount, 500);
    assert.equal(response.body.data.invoice_balance_amount, 0);
    assert.equal(calls.some((c) => c.text.includes('fn_create_payment_details')), true);
  });

  it('rejects unauthenticated create before SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app)
      .post('/api/admin/payments/create')
      .send({
        invoice_id: '55',
        amount: '10',
        payment_method_code: 'PAY_CASH',
        paid_on: '2026-11-12',
      });
    assert.equal(response.status, 401);
    assert.equal(calls.some((c) => c.text.includes('fn_create_payment_details')), false);
  });

  it('rejects invalid payment method before SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '10', TEST_SECRET);
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app)
      .post('/api/admin/payments/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        invoice_id: '55',
        amount: '10',
        payment_method_code: 'PAY_GATEWAY',
        paid_on: '2026-11-12',
      });
    assert.equal(response.status, 400);
    assert.equal(calls.some((c) => c.text.includes('fn_create_payment_details')), false);
  });

  it('rejects missing invoice_id before SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '10', TEST_SECRET);
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app)
      .post('/api/admin/payments/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        amount: '10',
        payment_method_code: 'PAY_CASH',
        paid_on: '2026-11-12',
      });
    assert.equal(response.status, 400);
    assert.equal(calls.some((c) => c.text.includes('fn_create_payment_details')), false);
  });

  it('returns SQL customer-create rejection', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app } = appWith(async (text) => {
      if (!text.includes('fn_create_payment_details')) return { rows: [] };
      return {
        rows: [{
          response: {
            status: 'ERROR',
            code: 403,
            message: 'Only an administrator can record payments',
            data: null,
          },
        }],
      };
    });
    const response = await request(app)
      .post('/api/admin/payments/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        invoice_id: '55',
        amount: '10',
        payment_method_code: 'PAY_CASH',
        paid_on: '2026-11-12',
      });
    assert.equal(response.status, 403);
  });

  it('returns SQL invalid invoice rejection', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '10', TEST_SECRET);
    const { app } = appWith(async (text) => {
      if (!text.includes('fn_create_payment_details')) return { rows: [] };
      return {
        rows: [{
          response: {
            status: 'ERROR',
            code: 404,
            message: 'This invoice was not found',
            data: null,
          },
        }],
      };
    });
    const response = await request(app)
      .post('/api/admin/payments/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        invoice_id: '999',
        amount: '10',
        payment_method_code: 'PAY_CASH',
        paid_on: '2026-11-12',
      });
    assert.equal(response.status, 404);
  });
});

describe('POST /api/admin/payments/update', () => {
  it('updates a payment and returns SQL-managed invoice balances', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '10', TEST_SECRET);
    const { app, calls } = appWith(async (text, params) => {
      if (!text.includes('fn_update_payment_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.payment_id, '101');
      assert.equal(payload.amount, '250.00');
      assert.equal(payload.payment_method_code, 'PAY_NEFT');
      assert.equal(payload.payment_status_code, undefined);
      assert.equal(payload.user_id, undefined);
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Payment updated',
            data: {
              payment_id: '101',
              amount: 250,
              invoice_paid_amount: 250,
              invoice_balance_amount: 750,
              invoice_status_code: 'INV_PARTIAL',
            },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/admin/payments/update')
      .set('Authorization', `Bearer ${token}`)
      .send({
        payment_id: '101',
        amount: '250.00',
        payment_method_code: 'PAY_NEFT',
        user_id: '99',
        invoice_paid_amount: '0',
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.invoice_status_code, 'INV_PARTIAL');
    assert.equal(response.body.data.invoice_paid_amount, 250);
    assert.equal(calls.some((c) => c.text.includes('fn_update_payment_details')), true);
  });

  it('cancels a payment via payment_status_code', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '10', TEST_SECRET);
    const { app, calls } = appWith(async (text, params) => {
      if (!text.includes('fn_update_payment_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.payment_status_code, 'PAY_CANCELLED');
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Payment updated',
            data: {
              payment_id: '101',
              payment_status_code: 'PAY_CANCELLED',
              invoice_paid_amount: 0,
              invoice_balance_amount: 1000,
              invoice_status_code: 'INV_UNPAID',
            },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/admin/payments/update')
      .set('Authorization', `Bearer ${token}`)
      .send({ payment_id: '101', payment_status_code: 'PAY_CANCELLED' });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.invoice_status_code, 'INV_UNPAID');
    assert.equal(calls.some((c) => c.text.includes('fn_update_payment_details')), true);
  });

  it('rejects customer update via SQL 403', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app } = appWith(async (text) => {
      if (!text.includes('fn_update_payment_details')) return { rows: [] };
      return {
        rows: [{
          response: {
            status: 'ERROR',
            code: 403,
            message: 'Only an administrator can update payments',
            data: null,
          },
        }],
      };
    });
    const response = await request(app)
      .post('/api/admin/payments/update')
      .set('Authorization', `Bearer ${token}`)
      .send({ payment_id: '101', remarks: 'hack' });
    assert.equal(response.status, 403);
  });

  it('rejects missing payment_id before SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '10', TEST_SECRET);
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app)
      .post('/api/admin/payments/update')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: '10' });
    assert.equal(response.status, 400);
    assert.equal(calls.some((c) => c.text.includes('fn_update_payment_details')), false);
  });
});

describe('POST /api/payments', () => {
  it('lists payments for the session and does not trust client user ids', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app, calls } = appWith(async (text, params) => {
      if (!text.includes('fn_get_payment_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.api_endpoint, '/api/payments');
      assert.equal(payload.jwt_token_hash, hashSessionToken(token));
      assert.equal(payload.user_id, undefined);
      assert.equal(payload.role, undefined);
      assert.equal(payload.customer_id, '12');
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Payments retrieved',
            data: {
              payments: [{
                payment_id: '101',
                customer_id: '12',
                amount: 100,
                payment_method_code: 'PAY_CASH',
              }],
            },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ customer_id: '12', user_id: '99', role: 'ROLE_ADMIN' });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.payments.length, 1);
    assert.equal(response.body.data.payments[0].customer_id, '12');
    assert.equal(calls.some((c) => c.text.includes('fn_get_payment_details')), true);
  });

  it('returns payment detail for a payment_id', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '10', TEST_SECRET);
    const { app } = appWith(async (text, params) => {
      if (!text.includes('fn_get_payment_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.payment_id, '101');
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Payment retrieved',
            data: {
              payment: {
                payment_id: '101',
                invoice_id: '55',
                amount: 500,
                payment_status_code: 'PAY_RECORDED',
              },
            },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ payment_id: '101' });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.payment.payment_id, '101');
  });

  it('returns SQL cross-customer rejection', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app } = appWith(async (text) => {
      if (!text.includes('fn_get_payment_details')) return { rows: [] };
      return {
        rows: [{
          response: {
            status: 'ERROR',
            code: 403,
            message: 'You can only view your own payments',
            data: null,
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ customer_id: '99' });

    assert.equal(response.status, 403);
  });

  it('rejects unauthenticated list before SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app).post('/api/payments').send({});
    assert.equal(response.status, 401);
    assert.equal(calls.some((c) => c.text.includes('fn_get_payment_details')), false);
  });

  it('rejects invalid payment_id shape before SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '10', TEST_SECRET);
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ payment_id: 'abc' });
    assert.equal(response.status, 400);
    assert.equal(calls.some((c) => c.text.includes('fn_get_payment_details')), false);
  });

  it('returns SQL not-found for unknown payment', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '10', TEST_SECRET);
    const { app } = appWith(async (text) => {
      if (!text.includes('fn_get_payment_details')) return { rows: [] };
      return {
        rows: [{
          response: {
            status: 'ERROR',
            code: 404,
            message: 'This payment was not found',
            data: null,
          },
        }],
      };
    });
    const response = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ payment_id: '999' });
    assert.equal(response.status, 404);
  });
});
