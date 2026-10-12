import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';

const TEST_SECRET = 'test-secret-at-least-32-characters-long';

function createQuery(handler) {
  const calls = [];
  const query = async (text, params) => {
    calls.push({ text, params });
    return handler(text, params, calls);
  };
  return { query, calls };
}

function appWith(handler) {
  const database = createQuery(handler);
  const app = createApp({ query: database.query, checkDatabaseConnection: async () => true });
  return { app, calls: database.calls };
}

function successSession() {
  return {
    rows: [{
      response: {
        status: 'SUCCESS',
        code: 200,
        message: 'Signed in',
        data: {
          user_id: '7',
          session_id: '9',
          full_name: 'Asha Nair',
          role_code: 'ROLE_CUSTOMER',
          role_name: 'End Customer',
        },
      },
    }],
  };
}

describe('POST /api/auth/login', () => {
  it('rejects a short PIN before calling the database', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app).post('/api/auth/login').send({
      country_id: '1',
      national_number: '9876543210',
      pin: '12',
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.message, 'PIN must be 4 digits');
    assert.equal(response.body.data, null);
    assert.equal(calls.some((call) => call.text.includes('fn_create_pin_session')), false);
  });

  it('returns the database 401 without an access token', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const { app, calls } = appWith(async (text) => {
      if (text.includes('fn_create_pin_session')) {
        return {
          rows: [{
            response: {
              status: 'ERROR',
              code: 401,
              message: 'The mobile number or PIN is incorrect',
              data: null,
            },
          }],
        };
      }
      return { rows: [] };
    });

    const response = await request(app).post('/api/auth/login').send({
      country_id: '1',
      national_number: '9876543210',
      pin: '0000',
    });

    assert.equal(response.status, 401);
    assert.equal(response.body.message, 'The mobile number or PIN is incorrect');
    assert.equal(response.body.data, null);
    assert.equal(JSON.stringify(response.body).includes('access_token'), false);
    assert.equal(calls.some((call) => call.text.includes('UPDATE solar_app.log_user_sessions')), false);
  });

  it('adds an access token only after the session hash is stored', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const { app, calls } = appWith(async (text) => {
      if (text.includes('fn_create_pin_session')) return successSession();
      if (text.includes('UPDATE solar_app.log_user_sessions')) return { rowCount: 1 };
      return { rows: [] };
    });

    const response = await request(app).post('/api/auth/login').send({
      country_id: '1',
      national_number: '9876543210',
      pin: '1234',
      full_name: 'Ignored',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'SUCCESS');
    assert.equal(typeof response.body.data.access_token, 'string');
    assert.equal(response.body.data.access_token.split('.').length, 3);
    assert.equal(response.body.data.full_name, 'Asha Nair');

    const functionCall = calls.find((call) => call.text.includes('fn_create_pin_session'));
    const sent = JSON.parse(functionCall.params[0]);
    assert.equal(sent.pin, '1234');
    assert.match(sent.jwt_token_hash, /^[a-f0-9]{64}$/);

    const update = calls.find((call) => call.text.includes('UPDATE solar_app.log_user_sessions'));
    assert.equal(update.params[1], '9');
    assert.equal(update.params[2], sent.jwt_token_hash);
    assert.notEqual(update.params[0], sent.jwt_token_hash);

    const audit = calls.find((call) => call.text.includes('log_api_execution'));
    const auditText = JSON.stringify(audit.params);
    assert.equal(auditText.includes('1234'), false);
    assert.equal(auditText.includes(response.body.data.access_token), false);
  });

  it('does not return a token when the session row is not updated', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const { app } = appWith(async (text) => {
      if (text.includes('fn_create_pin_session')) return successSession();
      if (text.includes('UPDATE solar_app.log_user_sessions')) return { rowCount: 0 };
      return { rows: [] };
    });

    const response = await request(app).post('/api/auth/login').send({
      country_id: '1',
      national_number: '9876543210',
      pin: '1234',
    });

    assert.equal(response.status, 500);
    assert.equal(response.body.message, 'Sign-in could not be completed');
    assert.equal(response.body.data, null);
  });

  it('does not sign in when the JWT secret is missing', async () => {
    delete process.env.JWT_SECRET;
    const { app, calls } = appWith(async () => successSession());
    const response = await request(app).post('/api/auth/login').send({
      country_id: '1',
      national_number: '9876543210',
      pin: '1234',
    });

    assert.equal(response.status, 500);
    assert.equal(response.body.data, null);
    assert.equal(calls.some((call) => call.text.includes('fn_create_pin_session')), false);
    process.env.JWT_SECRET = TEST_SECRET;
  });
});

describe('POST /api/auth/register', () => {
  it('rejects a missing name before calling the database', async () => {
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app).post('/api/auth/register').send({
      country_id: '1',
      national_number: '9876543210',
      pin: '1234',
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.message, 'Enter your name');
    assert.equal(calls.some((call) => call.text.includes('fn_create_pin_user')), false);
  });
});
