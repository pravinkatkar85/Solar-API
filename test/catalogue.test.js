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

function publishedList() {
  return {
    rows: [{
      response: {
        status: 'SUCCESS',
        code: 200,
        message: 'Products loaded',
        data: {
          products: [{
            product_id: '3',
            product_name: 'Rooftop 3kW',
            is_published: true,
          }],
        },
      },
    }],
  };
}

describe('POST /api/catalogue/products', () => {
  it('lists published products without a session', async () => {
    const { app, calls } = appWith(async (text, params) => {
      if (text.includes('fn_get_product_details')) {
        const payload = JSON.parse(params[0]);
        assert.equal(payload.api_endpoint, '/api/catalogue/products');
        assert.equal(payload.jwt_token_hash, undefined);
        assert.equal(payload.product_id, undefined);
        return publishedList();
      }
      return { rows: [] };
    });

    const response = await request(app).post('/api/catalogue/products').send({});
    assert.equal(response.status, 200);
    assert.equal(response.body.data.products[0].product_name, 'Rooftop 3kW');
    assert.equal(calls.some((call) => call.text.includes('fn_get_product_details')), true);
  });

  it('requests one product for the detail view', async () => {
    const { app } = appWith(async (text, params) => {
      if (!text.includes('fn_get_product_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.product_id, '3');
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Product loaded',
            data: {
              product_id: '3',
              product_name: 'Rooftop 3kW',
              long_description: 'Grid-tied system',
              media: [{ product_media_id: '9', media_type: 'PHOTO', caption: 'Roof view' }],
            },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/catalogue/products')
      .send({ product_id: '3' });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.long_description, 'Grid-tied system');
    assert.equal(response.body.data.media[0].caption, 'Roof view');
  });

  it('passes through exclusion of an unpublished product', async () => {
    const { app, calls } = appWith(async (text) => {
      if (!text.includes('fn_get_product_details')) return { rows: [] };
      return {
        rows: [{
          response: {
            status: 'ERROR',
            code: 404,
            message: 'This product is not available',
            data: null,
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/catalogue/products')
      .send({ product_id: '4' });
    assert.equal(response.status, 404);
    assert.equal(response.body.message, 'This product is not available');
    assert.equal(calls.filter((call) => call.text.includes('fn_get_product_details')).length, 1);
  });
});

describe('POST /api/catalogue/enquiries', () => {
  it('creates an enquiry for the verified session and ignores a client user id', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app, calls } = appWith(async (text, params) => {
      if (text.includes('fn_create_product_enquiry_details')) {
        const payload = JSON.parse(params[0]);
        assert.equal(payload.jwt_token_hash, hashSessionToken(token));
        assert.equal(payload.product_id, '3');
        assert.equal(payload.message_text, 'Need a rooftop quote');
        assert.equal(payload.user_id, undefined);
        assert.equal(payload.logged_in_user_id, undefined);
        return {
          rows: [{
            response: {
              status: 'SUCCESS',
              code: 200,
              message: 'Enquiry submitted',
              data: { product_enquiry_id: '15', enquiry_no: 'ENQ-00000015', product_id: '3' },
            },
          }],
        };
      }
      if (text.includes('log_api_execution')) {
        assert.equal(JSON.parse(params[3]).message_text, undefined);
      }
      return { rows: [] };
    });

    const response = await request(app)
      .post('/api/catalogue/enquiries')
      .set('Authorization', `Bearer ${token}`)
      .send({
        product_id: '3',
        message_text: 'Need a rooftop quote',
        user_id: '99',
        role: 'ROLE_ADMIN',
        jwt_token_hash: 'a'.repeat(64),
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.enquiry_no, 'ENQ-00000015');
    assert.equal(calls.some((call) => call.text.includes('fn_create_product_enquiry_details')), true);
  });

  it('rejects an enquiry with no bearer token before calling SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app).post('/api/catalogue/enquiries').send({
      product_id: '3',
      message_text: 'Need a rooftop quote',
    });

    assert.equal(response.status, 401);
    assert.equal(response.body.message, 'Authentication is required');
    assert.equal(calls.some((call) => call.text.includes('fn_create_product_enquiry_details')), false);
  });
});

describe('POST /api/catalogue/enquiries/list', () => {
  it('lists the session user enquiries and ignores a client user id', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app, calls } = appWith(async (text, params) => {
      if (!text.includes('fn_get_product_enquiry_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.api_endpoint, '/api/catalogue/enquiries/list');
      assert.equal(payload.jwt_token_hash, hashSessionToken(token));
      assert.equal(payload.user_id, undefined);
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Enquiries loaded',
            data: {
              enquiries: [{
                enquiry_no: 'ENQ-00000015',
                product_name: 'Rooftop 3kW',
                status_name: 'Open',
              }],
            },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/catalogue/enquiries/list')
      .set('Authorization', `Bearer ${token}`)
      .send({ user_id: '99', role: 'ROLE_ADMIN' });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.enquiries[0].enquiry_no, 'ENQ-00000015');
    assert.equal(calls.some((call) => call.text.includes('fn_get_product_enquiry_details')), true);
  });

  it('rejects a list with no bearer token before calling SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app).post('/api/catalogue/enquiries/list').send({});
    assert.equal(response.status, 401);
    assert.equal(calls.some((call) => call.text.includes('fn_get_product_enquiry_details')), false);
  });
});

describe('POST /api/catalogue/enquiries/action', () => {
  it('cancels the session enquiry and ignores a client user id', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app, calls } = appWith(async (text, params) => {
      if (!text.includes('fn_update_product_enquiry_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.api_endpoint, '/api/catalogue/enquiries/action');
      assert.equal(payload.jwt_token_hash, hashSessionToken(token));
      assert.equal(payload.product_enquiry_id, '15');
      assert.equal(payload.action, 'cancel');
      assert.equal(payload.user_id, undefined);
      assert.equal(payload.note, 'private note');
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Enquiry cancelled',
            data: { enquiry_no: 'ENQ-00000015', status_code: 'ENQ_CLOSED' },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/catalogue/enquiries/action')
      .set('Authorization', `Bearer ${token}`)
      .send({
        product_enquiry_id: '15',
        action: 'cancel',
        user_id: '99',
        note: 'private note',
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.message, 'Enquiry cancelled');
    const audit = calls.find((call) => call.text.includes('log_api_execution'));
    assert.equal(JSON.parse(audit.params[3]).note, undefined);
    assert.equal(calls.some((call) => call.text.includes('fn_update_product_enquiry_details')), true);
  });

  it('rejects an action with no bearer token before calling SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app)
      .post('/api/catalogue/enquiries/action')
      .send({ product_enquiry_id: '15', action: 'cancel' });
    assert.equal(response.status, 401);
    assert.equal(calls.some((call) => call.text.includes('fn_update_product_enquiry_details')), false);
  });
});
