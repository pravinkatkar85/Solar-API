import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { readDatabaseConfig } from '../src/config.js';
import { DROPDOWN_SQL } from '../src/db/dropdowns.js';
import { createApp } from '../src/app.js';

function createQuery(handler) {
  const calls = [];
  const query = async (text, params) => {
    calls.push({ text, params });
    return handler(text, params);
  };
  return { query, calls };
}

function functionResult(body) {
  return { rows: [{ response: body }] };
}

function appWith(handler) {
  const database = createQuery(handler);
  const app = createApp({ query: database.query, checkDatabaseConnection: async () => true });
  return { app, calls: database.calls };
}

describe('POST /api/dropdowns', () => {
  it('rejects a missing dropdown code before calling the database function', async () => {
    const { app, calls } = appWith(async () => functionResult({}));
    const response = await request(app).post('/api/dropdowns').send({});

    assert.equal(response.status, 400);
    assert.deepEqual(response.body, {
      status: 'ERROR',
      code: 400,
      message: 'dropdown_code is required',
      data: null,
    });
    assert.equal(calls.some((call) => call.text === DROPDOWN_SQL), false);
  });

  it('rejects SQL-injection-style dropdown codes before calling the function', async () => {
    const { app, calls } = appWith(async () => functionResult({}));
    const response = await request(app).post('/api/dropdowns').send({
      dropdown_code: "COUNTRIES'; DROP TABLE solar_app.ref_countries; --",
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.message, 'dropdown_code is not valid');
    assert.equal(calls.some((call) => call.text.includes(response.body.message) || call.text.includes('DROP TABLE')), false);
    assert.equal(calls.some((call) => call.text === DROPDOWN_SQL), false);
  });

  it('calls the function with a parameterized payload and returns its JSON', async () => {
    const functionBody = {
      status: 'SUCCESS',
      code: 200,
      message: 'Dropdown options loaded',
      data: {
        dropdown_code: 'COUNTRIES',
        cache_ttl_seconds: 3600,
        options: [{ value: '1', label: 'India' }],
      },
    };
    const { app, calls } = appWith(async (text) => {
      if (text === DROPDOWN_SQL) {
        return functionResult(functionBody);
      }
      return { rows: [] };
    });

    const response = await request(app).post('/api/dropdowns').send({
      dropdown_code: ' COUNTRIES ',
      logged_in_user_id: 'rahul',
      password: 'should-not-be-forwarded',
    });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, functionBody);
    const functionCall = calls.find((call) => call.text === DROPDOWN_SQL);
    assert.ok(functionCall);
    assert.equal(functionCall.text.includes('COUNTRIES'), false);
    assert.deepEqual(JSON.parse(functionCall.params[0]), {
      api_endpoint: '/api/dropdowns',
      dropdown_code: 'COUNTRIES',
    });
    const auditCall = calls.find((call) => call.text.includes('log_api_execution'));
    assert.ok(auditCall);
    assert.equal(JSON.stringify(auditCall.params).includes('should-not-be-forwarded'), false);
    assert.equal(JSON.stringify(auditCall.params).includes('rahul'), false);
  });

  it('forwards an optional parent value without applying dropdown business rules', async () => {
    const functionBody = {
      status: 'ERROR',
      code: 400,
      message: 'parent_value is not valid',
      data: null,
    };
    const { app, calls } = appWith(async (text) => {
      if (text === DROPDOWN_SQL) {
        return functionResult(functionBody);
      }
      return { rows: [] };
    });

    const response = await request(app).post('/api/dropdowns').send({
      dropdown_code: 'STATES',
      parent_value: '1 OR 1=1',
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.message, 'parent_value is not valid');
    const payload = JSON.parse(calls.find((call) => call.text === DROPDOWN_SQL).params[0]);
    assert.equal(payload.parent_value, '1 OR 1=1');
    assert.equal(Object.hasOwn(payload, 'logged_in_user_id'), false);
  });

  it('rejects a parent value that is not a string or number', async () => {
    const { app, calls } = appWith(async () => functionResult({}));
    const response = await request(app).post('/api/dropdowns').send({
      dropdown_code: 'STATES',
      parent_value: { country_id: 1 },
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.message, 'parent_value must be a string or number');
    assert.equal(calls.some((call) => call.text === DROPDOWN_SQL), false);
  });

  it('returns the function not-found response', async () => {
    const functionBody = {
      status: 'ERROR',
      code: 404,
      message: 'Dropdown was not found',
      data: null,
    };
    const { app } = appWith(async (text) => (text === DROPDOWN_SQL ? functionResult(functionBody) : { rows: [] }));
    const response = await request(app).post('/api/dropdowns').send({ dropdown_code: 'NOT_A_REAL_DROPDOWN' });

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, functionBody);
  });

  it('returns a safe response when the database call fails', async () => {
    const { app } = appWith(async (text) => {
      if (text === DROPDOWN_SQL) {
        const error = new Error('password=secret syntax error at solar_app.fn_get_dropdown_data');
        error.code = '42601';
        throw error;
      }
      return { rows: [] };
    });

    const response = await request(app).post('/api/dropdowns').send({ dropdown_code: 'COUNTRIES' });
    assert.equal(response.status, 500);
    assert.equal(response.body.message, 'Dropdown options could not be loaded');
    assert.equal(JSON.stringify(response.body).includes('secret'), false);
    assert.equal(JSON.stringify(response.body).includes('syntax'), false);
  });

  it('still returns the function response when the audit insert fails', async () => {
    const functionBody = {
      status: 'SUCCESS',
      code: 200,
      message: 'No dropdown options found',
      data: { dropdown_code: 'AMC_PLANS', cache_ttl_seconds: 3600, options: [] },
    };
    const { app } = appWith(async (text) => {
      if (text === DROPDOWN_SQL) {
        return functionResult(functionBody);
      }
      throw new Error('audit table unavailable');
    });

    const response = await request(app).post('/api/dropdowns').send({ dropdown_code: 'AMC_PLANS' });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, functionBody);
  });

  it('rejects invalid JSON and a non-object body', async () => {
    const { app, calls } = appWith(async () => functionResult({}));
    const invalid = await request(app)
      .post('/api/dropdowns')
      .set('Content-Type', 'application/json')
      .send('{"dropdown_code":');
    const arrayBody = await request(app).post('/api/dropdowns').send([1, 2]);

    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.message, 'Request body must be valid JSON');
    assert.equal(arrayBody.status, 400);
    assert.equal(arrayBody.body.message, 'Request body must be a JSON object');
    assert.equal(calls.some((call) => call.text === DROPDOWN_SQL), false);
  });
});

describe('GET /health', () => {
  it('reports the process and database as up without connection details', async () => {
    const app = createApp({
      checkDatabaseConnection: async () => true,
      query: async () => ({ rows: [] }),
    });
    const response = await request(app).get('/health');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: 'UP', database: 'UP' });
    assert.equal(Object.hasOwn(response.body, 'host'), false);
    assert.equal(response.headers['x-powered-by'], undefined);
  });

  it('reports the process as up when the database is unreachable', async () => {
    const app = createApp({
      checkDatabaseConnection: async () => false,
      query: async () => {
        throw new Error('database host secret.example');
      },
    });
    const response = await request(app).get('/health');

    assert.equal(response.status, 503);
    assert.deepEqual(response.body, { status: 'UP', database: 'DOWN' });
    assert.equal(JSON.stringify(response.body).includes('secret'), false);
  });
});

describe('database configuration', () => {
  it('requires database settings and does not include their values in the error', () => {
    assert.throws(
      () => readDatabaseConfig({ PGHOST: '127.0.0.1', PGPASSWORD: '' }),
      (error) => {
        assert.match(error.message, /Missing database configuration/);
        assert.equal(error.message.includes('127.0.0.1'), false);
        return true;
      },
    );
  });
});
