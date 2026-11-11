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

describe('POST /api/account', () => {
  it('loads the session profile and ignores a client user id', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app, calls } = appWith(async (text, params) => {
      if (text.includes('log_api_execution')) {
        const logged = JSON.parse(params[4]);
        assert.equal(logged.data.email, null);
        assert.equal(logged.data.mobile_e164, null);
        return { rows: [] };
      }
      if (!text.includes('fn_get_user_profile')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.api_endpoint, '/api/account');
      assert.equal(payload.jwt_token_hash, hashSessionToken(token));
      assert.equal(payload.user_id, undefined);
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Account loaded',
            data: {
              full_name: 'Asha Patil',
              mobile_e164: '+919800000001',
              email: 'asha@example.com',
              role_name: 'Customer',
              push_notifications_enabled: true,
            },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ user_id: '99' });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.full_name, 'Asha Patil');
    assert.equal(calls.some((call) => String(call.params?.[3] ?? '').includes('asha@example.com')), false);
  });

  it('rejects a profile read with no bearer token before calling SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app).post('/api/account').send({});
    assert.equal(response.status, 401);
    assert.equal(calls.some((call) => call.text.includes('fn_get_user_profile')), false);
  });

  it('updates communication fields and leaves the login mobile unchanged in the payload', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app } = appWith(async (text, params) => {
      if (!text.includes('fn_update_user_profile')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.email, 'asha@example.com');
      assert.equal(payload.secondary_national_number, '9800000002');
      assert.equal(payload.mobile_e164, undefined);
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Account updated',
            data: { full_name: 'Asha Patil', email: 'asha@example.com', secondary_national_number: '9800000002' },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/account/update')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'asha@example.com',
        secondary_national_number: '9800000002',
        mobile_e164: '+910000000000',
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.secondary_national_number, '9800000002');
  });
});
