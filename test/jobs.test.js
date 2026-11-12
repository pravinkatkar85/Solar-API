import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createSessionToken, hashSessionToken } from '../src/db/auth.js';

const TEST_SECRET = 'test-secret-at-least-32-characters-long';
// Minimal 1x1 PNG
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function appWith(handler) {
  const calls = [];
  const query = async (text, params) => {
    calls.push({ text, params });
    return handler(text, params, calls);
  };
  return { app: createApp({ query, checkDatabaseConnection: async () => true }), calls };
}

describe('POST /api/technician/jobs', () => {
  it('lists jobs for the technician session', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('3', '9', TEST_SECRET);
    const { app, calls } = appWith(async (text, params) => {
      if (!text.includes('fn_get_job_assignment_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.api_endpoint, '/api/technician/jobs');
      assert.equal(payload.jwt_token_hash, hashSessionToken(token));
      assert.equal(payload.technician_id, undefined);
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Jobs loaded',
            data: { technician_id: '8', jobs: [{ job_id: '1', job_status_code: 'JOB_QUEUED' }] },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/technician/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ technician_id: '999' });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.jobs[0].job_id, '1');
    assert.equal(JSON.parse(calls[0].params[0]).technician_id, undefined);
  });

  it('rejects unauthenticated list', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const { app } = appWith(async () => ({ rows: [] }));
    const response = await request(app).post('/api/technician/jobs').send({});
    assert.equal(response.status, 401);
  });

  it('maps ownership 404 from SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('3', '9', TEST_SECRET);
    const { app } = appWith(async (text) => {
      if (!text.includes('fn_get_job_assignment_details')) return { rows: [] };
      return {
        rows: [{
          response: {
            status: 'ERROR',
            code: 404,
            message: 'This job was not found',
            data: null,
          },
        }],
      };
    });
    const response = await request(app)
      .post('/api/technician/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ job_id: '99' });
    assert.equal(response.status, 404);
  });
});

describe('POST /api/technician/jobs/update', () => {
  it('accepts a job', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('3', '9', TEST_SECRET);
    const { app } = appWith(async (text, params) => {
      if (!text.includes('fn_update_job_assignment_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.action, 'ACCEPT');
      assert.equal(payload.job_id, '1');
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Job accepted',
            data: { job_id: '1', job_status_code: 'JOB_ACCEPTED' },
          },
        }],
      };
    });
    const response = await request(app)
      .post('/api/technician/jobs/update')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'ACCEPT', job_id: '1' });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.job_status_code, 'JOB_ACCEPTED');
  });

  it('requires reschedule reason and date', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('3', '9', TEST_SECRET);
    const { app } = appWith(async () => ({ rows: [] }));
    const response = await request(app)
      .post('/api/technician/jobs/update')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'RESCHEDULE', job_id: '1', scheduled_on: '2026-12-01' });
    assert.equal(response.status, 400);
  });

  it('completes with checklist media and signature upload', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('3', '9', TEST_SECRET);
    const { app, calls } = appWith(async (text, params) => {
      if (!text.includes('fn_update_job_assignment_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.action, 'COMPLETE');
      assert.equal(payload.checklist_responses.length, 1);
      assert.equal(payload.media.length, 2);
      assert.match(payload.media[0].file_url, /^\/media\/jobs\//);
      assert.match(payload.signature.signature_url, /^\/media\/jobs\//);
      assert.equal(payload.media[0].file_base64, undefined);
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Job completed',
            data: { job_id: '1', job_status_code: 'JOB_COMPLETED' },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/technician/jobs/update')
      .set('Authorization', `Bearer ${token}`)
      .send({
        action: 'COMPLETE',
        job_id: '1',
        checklist_responses: [
          { checklist_item_id: '1', measured_value: '40.1' },
        ],
        media: [
          { media_purpose: 'BEFORE', file_base64: TINY_PNG_B64, mime_type: 'image/png' },
          { media_purpose: 'AFTER', file_base64: TINY_PNG_B64, mime_type: 'image/png' },
        ],
        signature: {
          signature_base64: TINY_PNG_B64,
          mime_type: 'image/png',
          signer_name: 'Customer',
        },
      });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.job_status_code, 'JOB_COMPLETED');
    assert.equal(calls.some((c) => c.text.includes('fn_update_job_assignment_details')), true);
  });

  it('maps duplicate completion 409', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('3', '9', TEST_SECRET);
    const { app } = appWith(async (text) => {
      if (!text.includes('fn_update_job_assignment_details')) return { rows: [] };
      return {
        rows: [{
          response: {
            status: 'ERROR',
            code: 409,
            message: 'This job is already completed',
            data: null,
          },
        }],
      };
    });
    const response = await request(app)
      .post('/api/technician/jobs/update')
      .set('Authorization', `Bearer ${token}`)
      .send({
        action: 'COMPLETE',
        job_id: '1',
        checklist_responses: [],
        media: [
          { media_purpose: 'BEFORE', file_url: '/media/jobs/a.jpg' },
          { media_purpose: 'AFTER', file_url: '/media/jobs/b.jpg' },
        ],
        signature: { signature_url: '/media/jobs/s.png' },
      });
    assert.equal(response.status, 409);
  });

  it('maps notification failure 500', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('3', '9', TEST_SECRET);
    const { app } = appWith(async (text) => {
      if (!text.includes('fn_update_job_assignment_details')) return { rows: [] };
      return {
        rows: [{
          response: {
            status: 'ERROR',
            code: 500,
            message: 'Job could not be updated',
            data: null,
          },
        }],
      };
    });
    const response = await request(app)
      .post('/api/technician/jobs/update')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'START', job_id: '1' });
    assert.equal(response.status, 500);
  });

  it('rejects admin-role spoofing by omitting role from SQL payload', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('3', '9', TEST_SECRET);
    const { app, calls } = appWith(async (text, params) => {
      if (!text.includes('fn_update_job_assignment_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.role, undefined);
      assert.equal(payload.technician_id, undefined);
      return {
        rows: [{
          response: {
            status: 'ERROR',
            code: 403,
            message: 'Only a technician can update assigned jobs',
            data: null,
          },
        }],
      };
    });
    const response = await request(app)
      .post('/api/technician/jobs/update')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'ACCEPT', job_id: '1', role: 'ROLE_ADMIN', technician_id: '1' });
    assert.equal(response.status, 403);
    assert.equal(JSON.parse(calls[0].params[0]).technician_id, undefined);
  });
});
