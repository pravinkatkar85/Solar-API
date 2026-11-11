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

describe('POST /api/installations', () => {
  it('lists the session customer sites and ignores a client user id', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app, calls } = appWith(async (text, params) => {
      if (!text.includes('fn_get_site_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.api_endpoint, '/api/installations');
      assert.equal(payload.jwt_token_hash, hashSessionToken(token));
      assert.equal(payload.user_id, undefined);
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Installations loaded',
            data: {
              installations: [{
                site_id: '4',
                site_name: 'Home',
                status_name: 'Commissioned',
              }],
            },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/installations')
      .set('Authorization', `Bearer ${token}`)
      .send({ user_id: '99' });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.installations[0].site_name, 'Home');
    assert.equal(calls.some((call) => call.text.includes('fn_get_site_details')), true);
  });

  it('rejects a list with no bearer token before calling SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app).post('/api/installations').send({});
    assert.equal(response.status, 401);
    assert.equal(calls.some((call) => call.text.includes('fn_get_site_details')), false);
  });
});
