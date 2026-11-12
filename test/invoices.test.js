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

describe('POST /api/admin/invoices/create', () => {
  it('creates an invoice for an authenticated admin and forwards jwt hash only', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '10', TEST_SECRET);
    const { app, calls } = appWith(async (text, params) => {
      if (!text.includes('fn_create_invoice_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.api_endpoint, '/api/admin/invoices/create');
      assert.equal(payload.jwt_token_hash, hashSessionToken(token));
      assert.equal(payload.user_id, undefined);
      assert.equal(payload.role, undefined);
      assert.equal(payload.logged_in_user_id, undefined);
      assert.equal(payload.invoice_no, 'INV-2026-001');
      assert.equal(payload.customer_id, '20');
      assert.equal(payload.invoice_date, '2026-11-12');
      assert.equal(payload.currency_code, 'INR');
      assert.equal(payload.invoice_category_code, 'INV_INSTALL');
      assert.equal(payload.total_amount, '1180.00');
      assert.equal(payload.taxable_amount, '1000.00');
      assert.equal(payload.tax_amount, '180.00');
      assert.equal(payload.paid_amount, undefined);
      assert.equal(payload.balance_amount, undefined);
      assert.equal(payload.lines.length, 1);
      assert.equal(payload.lines[0].line_no, 1);
      assert.equal(payload.tax_snapshots.length, 1);
      assert.equal(payload.tax_snapshots[0].calculation_method, 'PERCENTAGE');
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Invoice created',
            data: {
              invoice_id: '55',
              invoice_no: 'INV-2026-001',
              customer_id: '20',
              invoice_status_code: 'INV_UNPAID',
              currency_code: 'INR',
              taxable_amount: 1000,
              tax_amount: 180,
              total_amount: 1180,
              paid_amount: 0,
              balance_amount: 1180,
              notification_id: '901',
            },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/admin/invoices/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        invoice_no: 'INV-2026-001',
        customer_id: '20',
        invoice_date: '2026-11-12',
        currency_code: 'INR',
        invoice_category_code: 'INV_INSTALL',
        taxable_amount: '1000.00',
        tax_amount: '180.00',
        total_amount: '1180.00',
        paid_amount: '999',
        balance_amount: '1',
        user_id: '99',
        role: 'ROLE_ADMIN',
        lines: [{
          line_no: 1,
          line_desc: 'Solar install',
          quantity: '1',
          unit_rate: '1000.00',
          line_amount: '1000.00',
        }],
        tax_snapshots: [{
          tax_group_code: 'GST',
          tax_component_code: 'CGST',
          tax_display_name: 'CGST 9%',
          calculation_method: 'PERCENTAGE',
          rate_percent: '9',
          taxable_amount: '1000.00',
          tax_amount: '90.00',
          line_no: 1,
        }],
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.invoice_id, '55');
    assert.equal(response.body.data.paid_amount, 0);
    assert.equal(response.body.data.balance_amount, 1180);
    assert.equal(response.body.data.notification_id, '901');
    assert.equal(calls.some((c) => c.text.includes('fn_create_invoice_details')), true);
  });

  it('rejects unauthenticated create before SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app)
      .post('/api/admin/invoices/create')
      .send({
        invoice_no: 'INV-1',
        customer_id: '20',
        invoice_date: '2026-11-12',
        currency_code: 'INR',
        invoice_category_code: 'INV_INSTALL',
        total_amount: '100',
      });
    assert.equal(response.status, 401);
    assert.equal(calls.some((c) => c.text.includes('fn_create_invoice_details')), false);
  });

  it('rejects invalid category before SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '10', TEST_SECRET);
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app)
      .post('/api/admin/invoices/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        invoice_no: 'INV-1',
        customer_id: '20',
        invoice_date: '2026-11-12',
        currency_code: 'INR',
        invoice_category_code: 'INV_UNKNOWN',
        total_amount: '100',
      });
    assert.equal(response.status, 400);
    assert.equal(calls.some((c) => c.text.includes('fn_create_invoice_details')), false);
  });

  it('rejects invalid currency before SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '10', TEST_SECRET);
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app)
      .post('/api/admin/invoices/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        invoice_no: 'INV-1',
        customer_id: '20',
        invoice_date: '2026-11-12',
        currency_code: 'IN',
        invoice_category_code: 'INV_INSTALL',
        total_amount: '100',
      });
    assert.equal(response.status, 400);
    assert.equal(calls.some((c) => c.text.includes('fn_create_invoice_details')), false);
  });

  it('rejects payment-derived status on create before SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '10', TEST_SECRET);
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app)
      .post('/api/admin/invoices/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        invoice_no: 'INV-1',
        customer_id: '20',
        invoice_date: '2026-11-12',
        currency_code: 'INR',
        invoice_category_code: 'INV_INSTALL',
        total_amount: '100',
        invoice_status_code: 'INV_PAID',
      });
    assert.equal(response.status, 400);
    assert.equal(calls.some((c) => c.text.includes('fn_create_invoice_details')), false);
  });

  it('rejects malformed tax snapshot before SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '10', TEST_SECRET);
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app)
      .post('/api/admin/invoices/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        invoice_no: 'INV-1',
        customer_id: '20',
        invoice_date: '2026-11-12',
        currency_code: 'INR',
        invoice_category_code: 'INV_INSTALL',
        total_amount: '100',
        tax_snapshots: [{
          tax_group_code: 'GST',
          tax_component_code: 'CGST',
          tax_display_name: 'CGST',
          calculation_method: 'PERCENTAGE',
          taxable_amount: '100',
          tax_amount: '9',
        }],
      });
    assert.equal(response.status, 400);
    assert.equal(calls.some((c) => c.text.includes('fn_create_invoice_details')), false);
  });

  it('returns SQL customer-create rejection', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app } = appWith(async (text) => {
      if (!text.includes('fn_create_invoice_details')) return { rows: [] };
      return {
        rows: [{
          response: {
            status: 'ERROR',
            code: 403,
            message: 'Only an administrator can create invoices',
            data: null,
          },
        }],
      };
    });
    const response = await request(app)
      .post('/api/admin/invoices/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        invoice_no: 'INV-1',
        customer_id: '20',
        invoice_date: '2026-11-12',
        currency_code: 'INR',
        invoice_category_code: 'INV_INSTALL',
        total_amount: '100',
      });
    assert.equal(response.status, 403);
  });

  it('returns SQL invalid customer rejection', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '10', TEST_SECRET);
    const { app } = appWith(async (text) => {
      if (!text.includes('fn_create_invoice_details')) return { rows: [] };
      return {
        rows: [{
          response: {
            status: 'ERROR',
            code: 404,
            message: 'This customer was not found',
            data: null,
          },
        }],
      };
    });
    const response = await request(app)
      .post('/api/admin/invoices/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        invoice_no: 'INV-1',
        customer_id: '999',
        invoice_date: '2026-11-12',
        currency_code: 'INR',
        invoice_category_code: 'INV_INSTALL',
        total_amount: '100',
      });
    assert.equal(response.status, 404);
  });

  it('returns SQL notification failure as 500', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '10', TEST_SECRET);
    const { app } = appWith(async (text) => {
      if (!text.includes('fn_create_invoice_details')) return { rows: [] };
      return {
        rows: [{
          response: {
            status: 'ERROR',
            code: 500,
            message: 'Invoice could not be created',
            data: null,
          },
        }],
      };
    });
    const response = await request(app)
      .post('/api/admin/invoices/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        invoice_no: 'INV-1',
        customer_id: '20',
        invoice_date: '2026-11-12',
        currency_code: 'INR',
        invoice_category_code: 'INV_INSTALL',
        total_amount: '100',
      });
    assert.equal(response.status, 500);
  });
});

describe('POST /api/admin/invoices/update', () => {
  it('updates an invoice and does not forward paid/balance overrides', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '10', TEST_SECRET);
    const { app, calls } = appWith(async (text, params) => {
      if (!text.includes('fn_update_invoice_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.api_endpoint, '/api/admin/invoices/update');
      assert.equal(payload.invoice_id, '55');
      assert.equal(payload.remarks, 'Updated remark');
      assert.equal(payload.paid_amount, undefined);
      assert.equal(payload.balance_amount, undefined);
      assert.equal(payload.user_id, undefined);
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Invoice updated',
            data: {
              invoice_id: '55',
              paid_amount: 50,
              balance_amount: 1130,
              invoice_status_code: 'INV_UNPAID',
              notification_id: '902',
            },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/admin/invoices/update')
      .set('Authorization', `Bearer ${token}`)
      .send({
        invoice_id: '55',
        remarks: 'Updated remark',
        paid_amount: '0',
        balance_amount: '0',
        user_id: '99',
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.paid_amount, 50);
    assert.equal(response.body.data.balance_amount, 1130);
    assert.equal(calls.some((c) => c.text.includes('fn_update_invoice_details')), true);
  });

  it('forwards replacement lines and tax snapshots', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '10', TEST_SECRET);
    const { app, calls } = appWith(async (text, params) => {
      if (!text.includes('fn_update_invoice_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.lines.length, 2);
      assert.equal(payload.tax_snapshots.length, 1);
      assert.equal(payload.tax_snapshots[0].calculation_method, 'FIXED_AMOUNT');
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Invoice updated',
            data: { invoice_id: '55', total_amount: 200 },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/admin/invoices/update')
      .set('Authorization', `Bearer ${token}`)
      .send({
        invoice_id: '55',
        total_amount: '200.00',
        tax_amount: '20.00',
        lines: [
          { line_no: 1, line_desc: 'A', line_amount: '100.00' },
          { line_no: 2, line_desc: 'B', line_amount: '80.00' },
        ],
        tax_snapshots: [{
          tax_group_code: 'GST',
          tax_component_code: 'CESS',
          tax_display_name: 'Cess',
          calculation_method: 'FIXED_AMOUNT',
          configured_rate_amount: '20.00',
          taxable_amount: '180.00',
          tax_amount: '20.00',
        }],
      });

    assert.equal(response.status, 200);
    assert.equal(calls.some((c) => c.text.includes('fn_update_invoice_details')), true);
  });

  it('rejects INV_PARTIAL status before SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '10', TEST_SECRET);
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app)
      .post('/api/admin/invoices/update')
      .set('Authorization', `Bearer ${token}`)
      .send({ invoice_id: '55', invoice_status_code: 'INV_PARTIAL' });
    assert.equal(response.status, 400);
    assert.equal(calls.some((c) => c.text.includes('fn_update_invoice_details')), false);
  });

  it('rejects customer update via SQL 403', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app } = appWith(async (text) => {
      if (!text.includes('fn_update_invoice_details')) return { rows: [] };
      return {
        rows: [{
          response: {
            status: 'ERROR',
            code: 403,
            message: 'Only an administrator can update invoices',
            data: null,
          },
        }],
      };
    });
    const response = await request(app)
      .post('/api/admin/invoices/update')
      .set('Authorization', `Bearer ${token}`)
      .send({ invoice_id: '55', remarks: 'hack' });
    assert.equal(response.status, 403);
  });

  it('rejects missing invoice_id before SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '10', TEST_SECRET);
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app)
      .post('/api/admin/invoices/update')
      .set('Authorization', `Bearer ${token}`)
      .send({ remarks: 'x' });
    assert.equal(response.status, 400);
    assert.equal(calls.some((c) => c.text.includes('fn_update_invoice_details')), false);
  });
});

describe('POST /api/invoices', () => {
  it('lists invoices for the session and does not trust client user ids', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app, calls } = appWith(async (text, params) => {
      if (!text.includes('fn_get_invoice_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.api_endpoint, '/api/invoices');
      assert.equal(payload.jwt_token_hash, hashSessionToken(token));
      assert.equal(payload.user_id, undefined);
      assert.equal(payload.role, undefined);
      assert.equal(payload.customer_id, '12');
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Invoices retrieved',
            data: {
              invoices: [{
                invoice_id: '55',
                customer_id: '12',
                invoice_no: 'INV-1',
                paid_amount: 0,
                balance_amount: 100,
                lines: [],
                tax_snapshots: [],
              }],
            },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ customer_id: '12', user_id: '99', role: 'ROLE_ADMIN' });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.invoices.length, 1);
    assert.equal(response.body.data.invoices[0].customer_id, '12');
    assert.equal(calls.some((c) => c.text.includes('fn_get_invoice_details')), true);
  });

  it('returns invoice detail for an invoice_id', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '10', TEST_SECRET);
    const { app } = appWith(async (text, params) => {
      if (!text.includes('fn_get_invoice_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.invoice_id, '55');
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Invoice retrieved',
            data: {
              invoice: {
                invoice_id: '55',
                invoice_no: 'INV-1',
                total_amount: 1180,
                paid_amount: 0,
                balance_amount: 1180,
                lines: [{ line_no: 1, line_desc: 'Install', line_amount: 1000 }],
                tax_snapshots: [{ tax_component_code: 'CGST', tax_amount: 90 }],
              },
            },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ invoice_id: '55' });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.invoice.invoice_id, '55');
    assert.equal(response.body.data.invoice.lines.length, 1);
    assert.equal(response.body.data.invoice.tax_snapshots.length, 1);
  });

  it('returns SQL cross-customer rejection', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app } = appWith(async (text) => {
      if (!text.includes('fn_get_invoice_details')) return { rows: [] };
      return {
        rows: [{
          response: {
            status: 'ERROR',
            code: 403,
            message: 'You can only view your own invoices',
            data: null,
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ customer_id: '99' });

    assert.equal(response.status, 403);
  });

  it('rejects unauthenticated list before SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app).post('/api/invoices').send({});
    assert.equal(response.status, 401);
    assert.equal(calls.some((c) => c.text.includes('fn_get_invoice_details')), false);
  });

  it('rejects invalid invoice_id shape before SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '10', TEST_SECRET);
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ invoice_id: 'abc' });
    assert.equal(response.status, 400);
    assert.equal(calls.some((c) => c.text.includes('fn_get_invoice_details')), false);
  });

  it('returns SQL not-found for unknown invoice', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '10', TEST_SECRET);
    const { app } = appWith(async (text) => {
      if (!text.includes('fn_get_invoice_details')) return { rows: [] };
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
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ invoice_id: '999' });
    assert.equal(response.status, 404);
  });
});
