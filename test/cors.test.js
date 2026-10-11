import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { flutterWebOrigin } from '../src/middleware/cors.js';

function createTestApp() {
  return createApp({
    query: async () => ({
      rows: [
        {
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Dropdown options loaded',
            data: {
              dropdown_code: 'COUNTRIES',
              cache_ttl_seconds: 3600,
              options: [{ value: '1', label: 'India' }],
            },
          },
        },
      ],
    }),
    checkDatabaseConnection: async () => true,
  });
}

describe('local Flutter Web CORS', () => {
  it('allows POST from http://localhost:8090 and keeps the dropdown JSON', async () => {
    assert.equal(flutterWebOrigin, 'http://localhost:8090');
    const response = await request(createTestApp())
      .post('/api/dropdowns')
      .set('Origin', 'http://localhost:8090')
      .send({ dropdown_code: 'COUNTRIES' });

    assert.equal(response.status, 200);
    assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:8090');
    assert.equal(response.body.status, 'SUCCESS');
    assert.equal(response.body.data.options[0].label, 'India');
  });

  it('does not allow the previous origin http://localhost:8080', async () => {
    const response = await request(createTestApp())
      .post('/api/dropdowns')
      .set('Origin', 'http://localhost:8080')
      .send({ dropdown_code: 'COUNTRIES' });

    assert.equal(response.status, 200);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
    assert.equal(response.body.status, 'SUCCESS');
  });

  it('answers an OPTIONS preflight for POST with Content-Type', async () => {
    const response = await request(createTestApp())
      .options('/api/dropdowns')
      .set('Origin', 'http://localhost:8090')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

    assert.equal(response.status, 204);
    assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:8090');
    assert.match(response.headers['access-control-allow-methods'], /\bPOST\b/);
    assert.match(response.headers['access-control-allow-methods'], /\bOPTIONS\b/);
    assert.match(response.headers['access-control-allow-headers'], /content-type/i);
    assert.equal(response.headers['access-control-allow-origin'].includes('*'), false);
  });
});
