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

describe('POST /api/notifications', () => {
  it('lists notifications for the session user and ignores client recipient ids', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app, calls } = appWith(async (text, params) => {
      if (!text.includes('fn_get_notification_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.api_endpoint, '/api/notifications');
      assert.equal(payload.jwt_token_hash, hashSessionToken(token));
      assert.equal(payload.recipient_user_id, undefined);
      assert.equal(payload.user_id, undefined);
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Notifications loaded',
            data: {
              unread_count: 1,
              notifications: [{
                notification_id: '11',
                notification_type_code: 'NTF_KYC_STATUS',
                title: 'KYC reviewed',
                body: 'Your document was approved.',
                is_read_ind: false,
              }],
            },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/notifications')
      .set('Authorization', `Bearer ${token}`)
      .send({ recipient_user_id: '99', user_id: '99' });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.unread_count, 1);
    assert.equal(response.body.data.notifications[0].notification_type_code, 'NTF_KYC_STATUS');
    assert.equal(JSON.parse(calls[0].params[0]).recipient_user_id, undefined);
  });

  it('rejects an unauthenticated list before calling SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app).post('/api/notifications').send({});
    assert.equal(response.status, 401);
    assert.equal(
      calls.some((call) => call.text.includes('fn_get_notification_details')),
      false,
    );
  });

  it('marks one notification read for the session user', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app, calls } = appWith(async (text, params) => {
      if (!text.includes('fn_update_notification_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.action, 'MARK_READ');
      assert.equal(payload.notification_id, '11');
      assert.equal(payload.recipient_user_id, undefined);
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Notification marked read',
            data: { updated_count: 1, unread_count: 0, notification_id: '11' },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/notifications/update')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'MARK_READ', notification_id: '11', recipient_user_id: '99' });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.unread_count, 0);
    assert.equal(JSON.parse(calls[0].params[0]).recipient_user_id, undefined);
  });

  it('rejects an invalid mark-read action before calling SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app, calls } = appWith(async () => ({ rows: [] }));
    const response = await request(app)
      .post('/api/notifications/update')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'DELETE_ALL' });
    assert.equal(response.status, 400);
    assert.equal(
      calls.some((call) => call.text.includes('fn_update_notification_details')),
      false,
    );
  });

  it('returns database ownership rejection for another customer notification', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app } = appWith(async (text) => {
      if (!text.includes('fn_update_notification_details')) return { rows: [] };
      return {
        rows: [{
          response: {
            status: 'ERROR',
            code: 404,
            message: 'This notification was not found',
            data: null,
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/notifications/update')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'MARK_READ', notification_id: '999' });

    assert.equal(response.status, 404);
    assert.equal(response.body.message, 'This notification was not found');
  });
});
