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

describe('POST /api/service-coverage', () => {
  it('lists the session customer coverage and ignores a client user id', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app } = appWith(async (text, params) => {
      if (!text.includes('fn_get_amc_contract_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.api_endpoint, '/api/service-coverage');
      assert.equal(payload.jwt_token_hash, hashSessionToken(token));
      assert.equal(payload.user_id, undefined);
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Service coverage loaded',
            data: {
              contracts: [{ plan_name: 'Basic Cleaning', contract_status: 'ACTIVE', expiry_on: '2027-03-31' }],
              milestones: [{ site_name: 'Home rooftop', status_name: 'Due', due_on: '2026-11-18' }],
            },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/service-coverage')
      .set('Authorization', `Bearer ${token}`)
      .send({ user_id: '99' });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.contracts[0].plan_name, 'Basic Cleaning');
    assert.equal(response.body.data.milestones[0].due_on, '2026-11-18');
  });

  it('rejects a list with no bearer token before calling SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app).post('/api/service-coverage').send({});
    assert.equal(response.status, 401);
    assert.equal(calls.some((call) => call.text.includes('fn_get_amc_contract_details')), false);
  });
});
