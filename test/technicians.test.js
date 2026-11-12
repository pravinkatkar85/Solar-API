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

describe('POST /api/admin/technicians', () => {
  it('lists technicians with session hash and optional filters', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '9', TEST_SECRET);
    const { app, calls } = appWith(async (text, params) => {
      if (!text.includes('fn_get_technician_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.api_endpoint, '/api/admin/technicians');
      assert.equal(payload.jwt_token_hash, hashSessionToken(token));
      assert.equal(payload.active_ind, true);
      assert.equal(payload.is_available, false);
      assert.equal(payload.role, undefined);
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Technicians loaded',
            data: {
              technicians: [{
                technician_id: '11',
                user_id: '22',
                employee_code: 'EMP-1',
                full_name: 'Tech One',
                mobile_e164: '+919900112233',
                active_ind: true,
                is_available: false,
              }],
            },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/admin/technicians')
      .set('Authorization', `Bearer ${token}`)
      .send({ active_ind: true, is_available: false, role: 'ROLE_ADMIN' });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.technicians.length, 1);
    assert.equal(response.body.data.technicians[0].technician_id, '11');
    assert.equal(calls.some((c) => c.text.includes('fn_get_technician_details')), true);
  });

  it('returns empty technician lists unchanged', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '9', TEST_SECRET);
    const { app } = appWith(async (text) => {
      if (!text.includes('fn_get_technician_details')) return { rows: [] };
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'No technicians found',
            data: { technicians: [] },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/admin/technicians')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data.technicians, []);
  });

  it('rejects unauthenticated list', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const { app } = appWith(async () => ({ rows: [] }));
    const response = await request(app).post('/api/admin/technicians').send({});
    assert.equal(response.status, 401);
  });

  it('maps non-admin SQL rejection to HTTP 403', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '9', TEST_SECRET);
    const { app } = appWith(async (text) => {
      if (!text.includes('fn_get_technician_details')) return { rows: [] };
      return {
        rows: [{
          response: {
            status: 'ERROR',
            code: 403,
            message: 'Only an administrator can view technicians',
            data: null,
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/admin/technicians')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    assert.equal(response.status, 403);
  });

  it('rejects invalid filter values before SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '9', TEST_SECRET);
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app)
      .post('/api/admin/technicians')
      .set('Authorization', `Bearer ${token}`)
      .send({ active_ind: 'maybe' });
    assert.equal(response.status, 400);
    assert.equal(calls.some((c) => c.text.includes('fn_get_technician_details')), false);
  });
});

describe('POST /api/admin/technicians/create', () => {
  it('creates a technician with session hash and strips client role', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '9', TEST_SECRET);
    const { app, calls } = appWith(async (text, params) => {
      if (!text.includes('fn_create_technician_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.api_endpoint, '/api/admin/technicians/create');
      assert.equal(payload.jwt_token_hash, hashSessionToken(token));
      assert.equal(payload.role, undefined);
      assert.equal(payload.employee_code, 'EMP-1');
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Technician created',
            data: { technician_id: '11', user_id: '22', role_code: 'ROLE_TECHNICIAN' },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/admin/technicians/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        role: 'ROLE_ADMIN',
        country_id: '1',
        national_number: '9900112233',
        full_name: 'Tech One',
        employee_code: 'EMP-1',
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.technician_id, '11');
    assert.equal(calls.some((c) => c.text.includes('fn_create_technician_details')), true);
  });

  it('rejects unauthenticated create', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const { app } = appWith(async () => ({ rows: [] }));
    const response = await request(app)
      .post('/api/admin/technicians/create')
      .send({
        country_id: '1',
        national_number: '9900112233',
        full_name: 'Tech One',
        employee_code: 'EMP-1',
      });
    assert.equal(response.status, 401);
  });

  it('rejects forbidden PIN', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '9', TEST_SECRET);
    const { app } = appWith(async () => ({ rows: [] }));
    const response = await request(app)
      .post('/api/admin/technicians/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        country_id: '1',
        national_number: '9900112233',
        full_name: 'Tech One',
        employee_code: 'EMP-1',
        pin: '1234',
      });
    assert.equal(response.status, 400);
  });
});

describe('POST /api/admin/technicians/update', () => {
  it('updates availability', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '9', TEST_SECRET);
    const { app } = appWith(async (text, params) => {
      if (!text.includes('fn_update_technician_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.technician_id, '11');
      assert.equal(payload.is_available, false);
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Technician updated',
            data: { technician_id: '11', is_available: false },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/admin/technicians/update')
      .set('Authorization', `Bearer ${token}`)
      .send({ technician_id: '11', is_available: false });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.is_available, false);
  });
});

describe('POST /api/admin/technicians/assign', () => {
  it('assigns a service request job', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '9', TEST_SECRET);
    const { app } = appWith(async (text, params) => {
      if (!text.includes('fn_create_job_assignment_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.job_type, 'SERVICE_REQUEST');
      assert.equal(payload.technician_id, '11');
      assert.equal(payload.service_request_id, '55');
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Job assigned',
            data: { job_id: '77', job_status_code: 'JOB_QUEUED' },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/admin/technicians/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({
        job_type: 'SERVICE_REQUEST',
        technician_id: '11',
        service_request_id: '55',
      });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.job_id, '77');
  });

  it('maps SQL duplicate assignment 409', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('1', '9', TEST_SECRET);
    const { app } = appWith(async (text) => {
      if (!text.includes('fn_create_job_assignment_details')) return { rows: [] };
      return {
        rows: [{
          response: {
            status: 'ERROR',
            code: 409,
            message: 'An active job already exists for this service request',
            data: null,
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/admin/technicians/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({
        job_type: 'SERVICE_REQUEST',
        technician_id: '11',
        service_request_id: '55',
      });
    assert.equal(response.status, 409);
  });
});
