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

describe('POST /api/kyc', () => {
  it('lists KYC documents for the session customer', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app, calls } = appWith(async (text, params) => {
      if (!text.includes('fn_get_kyc_document_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.api_endpoint, '/api/kyc');
      assert.equal(payload.jwt_token_hash, hashSessionToken(token));
      assert.equal(payload.user_id, undefined);
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'KYC documents loaded',
            data: {
              document_types: [{ document_type_code: 'DOC_AADHAAR' }],
              documents: [{ status_code: 'KYC_PENDING' }],
            },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/kyc')
      .set('Authorization', `Bearer ${token}`)
      .send({ user_id: '99', site_id: '1' });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.documents[0].status_code, 'KYC_PENDING');
    assert.equal(JSON.parse(calls[0].params[0]).site_id, '1');
    assert.equal(JSON.parse(calls[0].params[0]).status_code, undefined);
    assert.equal(JSON.parse(calls[0].params[0]).role, undefined);
    assert.equal(JSON.parse(calls[0].params[0]).customer_id, undefined);
  });

  for (const statusCode of ['KYC_PENDING', 'KYC_APPROVED', 'ACTION_REQUIRED']) {
    it(`forwards status_code=${statusCode} to fn_get_kyc_document_details`, async () => {
      process.env.JWT_SECRET = TEST_SECRET;
      const token = createSessionToken('7', '9', TEST_SECRET);
      const { app, calls } = appWith(async (text, params) => {
        if (!text.includes('fn_get_kyc_document_details')) return { rows: [] };
        const payload = JSON.parse(params[0]);
        assert.equal(payload.status_code, statusCode);
        assert.equal(payload.user_id, undefined);
        assert.equal(payload.role, undefined);
        assert.equal(payload.customer_id, undefined);
        return {
          rows: [{
            response: {
              status: 'SUCCESS',
              code: 200,
              message: 'KYC documents loaded',
              data: {
                document_types: [],
                documents: [
                  { kyc_document_id: '1', status_code: statusCode, customer_code: 'CUST-A' },
                  { kyc_document_id: '2', status_code: statusCode, customer_code: 'CUST-B' },
                ],
              },
            },
          }],
        };
      });

      const response = await request(app)
        .post('/api/kyc')
        .set('Authorization', `Bearer ${token}`)
        .send({ status_code: statusCode.toLowerCase() });

      assert.equal(response.status, 200);
      assert.equal(response.body.status, 'SUCCESS');
      assert.equal(JSON.parse(calls[0].params[0]).status_code, statusCode);
      assert.equal(
        response.body.data.documents.every((doc) => doc.status_code === statusCode),
        true,
      );
    });
  }

  it('rejects an invalid status_code before calling SQL', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app, calls } = appWith(async () => ({ rows: [] }));

    const response = await request(app)
      .post('/api/kyc')
      .set('Authorization', `Bearer ${token}`)
      .send({ status_code: 'NOT_A_STATUS' });

    assert.equal(response.status, 400);
    assert.equal(response.body.status, 'ERROR');
    assert.equal(response.body.code, 400);
    assert.equal(response.body.message, 'Choose a document status');
    assert.equal(response.body.data, null);
    assert.equal(calls.some((call) => call.text.includes('fn_get_kyc')), false);
  });

  it('keeps customer listing ownership-scoped while accepting status_code', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app, calls } = appWith(async (text, params) => {
      if (!text.includes('fn_get_kyc_document_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.status_code, 'KYC_PENDING');
      assert.equal(payload.customer_id, undefined);
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'KYC documents loaded',
            data: {
              documents: [{
                kyc_document_id: '9',
                customer_id: '1',
                status_code: 'KYC_PENDING',
              }],
            },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/kyc')
      .set('Authorization', `Bearer ${token}`)
      .send({ status_code: 'KYC_PENDING', customer_id: '99', role: 'ROLE_ADMIN' });

    assert.equal(response.status, 200);
    assert.equal(JSON.parse(calls[0].params[0]).customer_id, undefined);
    assert.equal(JSON.parse(calls[0].params[0]).role, undefined);
    assert.equal(response.body.data.documents[0].customer_id, '1');
  });

  it('creates a KYC document with file metadata and ignores client status', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app, calls } = appWith(async (text, params) => {
      if (!text.includes('fn_create_kyc_document_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.document_type_ref_data_id, '33');
      assert.equal(payload.file_url, '/media/kyc/demo.jpg');
      assert.equal(payload.file_size_bytes, '1200');
      assert.equal(payload.verification_status_ref_data_id, undefined);
      assert.equal(payload.rejection_comment, undefined);
      assert.equal(payload.user_id, undefined);
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'KYC document uploaded',
            data: { kyc_document_id: '12', status_code: 'KYC_PENDING' },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/kyc/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        user_id: '99',
        document_type_ref_data_id: '33',
        file_url: '/media/kyc/demo.jpg',
        file_size_bytes: '1200',
        mime_type: 'image/jpeg',
        verification_status_ref_data_id: '39',
        rejection_comment: 'should be ignored',
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.status_code, 'KYC_PENDING');
    assert.equal(calls.some((call) => call.text.includes('fn_create_kyc_document_details')), true);
  });

  it('rejects oversized uploads before the database call', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app, calls } = appWith(async () => ({ rows: [] }));

    const response = await request(app)
      .post('/api/kyc/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        document_type_ref_data_id: '33',
        file_url: '/media/kyc/big.jpg',
        file_size_bytes: '3000000',
        mime_type: 'image/jpeg',
      });

    assert.equal(response.status, 400);
    assert.equal(response.body.message, 'Document must be 2 MB or smaller');
    assert.equal(calls.some((call) => call.text.includes('fn_create_kyc')), false);
  });

  it('accepts JPEG uploads from base64 content signatures', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const { app, calls } = appWith(async (text, params) => {
      if (!text.includes('fn_create_kyc_document_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.mime_type, 'image/jpeg');
      assert.match(payload.file_url, /^\/media\/kyc\/.+\.jpg$/);
      assert.equal(payload.file_size_bytes, String(jpeg.length));
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'KYC document uploaded',
            data: { status_code: 'KYC_PENDING', mime_type: 'image/jpeg' },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/kyc/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        document_type_ref_data_id: '33',
        mime_type: 'image/jpeg',
        file_base64: jpeg.toString('base64'),
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'SUCCESS');
    assert.equal(calls.some((call) => call.text.includes('fn_create_kyc_document_details')), true);
  });

  it('accepts PNG uploads from base64 content signatures', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
    ]);
    const { app, calls } = appWith(async (text, params) => {
      if (!text.includes('fn_create_kyc_document_details')) return { rows: [] };
      assert.equal(JSON.parse(params[0]).mime_type, 'image/png');
      return {
        rows: [{
          response: {
            status: 'SUCCESS', code: 200, message: 'KYC document uploaded', data: { status_code: 'KYC_PENDING' },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/kyc/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        document_type_ref_data_id: '33',
        mime_type: 'image/png',
        file_base64: png.toString('base64'),
      });

    assert.equal(response.status, 200);
    assert.equal(calls.some((call) => call.text.includes('fn_create_kyc_document_details')), true);
  });

  it('accepts WebP uploads from base64 content signatures', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const webp = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x0a, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
    ]);
    const { app, calls } = appWith(async (text, params) => {
      if (!text.includes('fn_create_kyc_document_details')) return { rows: [] };
      assert.equal(JSON.parse(params[0]).mime_type, 'image/webp');
      return {
        rows: [{
          response: {
            status: 'SUCCESS', code: 200, message: 'KYC document uploaded', data: { status_code: 'KYC_PENDING' },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/kyc/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        document_type_ref_data_id: '33',
        mime_type: 'image/webp',
        file_base64: webp.toString('base64'),
      });

    assert.equal(response.status, 200);
    assert.equal(calls.some((call) => call.text.includes('fn_create_kyc_document_details')), true);
  });

  it('accepts PDF uploads from base64 content signatures', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const pdf = Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1');
    const { app, calls } = appWith(async (text, params) => {
      if (!text.includes('fn_create_kyc_document_details')) return { rows: [] };
      assert.equal(JSON.parse(params[0]).mime_type, 'application/pdf');
      return {
        rows: [{
          response: {
            status: 'SUCCESS', code: 200, message: 'KYC document uploaded', data: { status_code: 'KYC_PENDING' },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/kyc/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        document_type_ref_data_id: '33',
        mime_type: 'application/pdf',
        file_base64: pdf.toString('base64'),
      });

    assert.equal(response.status, 200);
    assert.equal(calls.some((call) => call.text.includes('fn_create_kyc_document_details')), true);
  });

  it('rejects unsupported MIME types before the database call', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app, calls } = appWith(async () => ({ rows: [] }));

    const response = await request(app)
      .post('/api/kyc/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        document_type_ref_data_id: '33',
        mime_type: 'image/gif',
        file_url: '/media/kyc/demo.gif',
        file_size_bytes: '1200',
      });

    assert.equal(response.status, 400);
    assert.equal(response.body.status, 'ERROR');
    assert.equal(response.body.code, 400);
    assert.equal(response.body.message, 'Unsupported document format');
    assert.equal(response.body.data, null);
    assert.equal(calls.some((call) => call.text.includes('fn_create_kyc')), false);
  });

  it('rejects MIME and content signature mismatches before save', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const { app, calls } = appWith(async () => ({ rows: [] }));

    const response = await request(app)
      .post('/api/kyc/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        document_type_ref_data_id: '33',
        mime_type: 'image/jpeg',
        file_base64: png.toString('base64'),
      });

    assert.equal(response.status, 400);
    assert.equal(response.body.status, 'ERROR');
    assert.equal(response.body.code, 400);
    assert.equal(
      response.body.message,
      'Document content does not match the declared format',
    );
    assert.equal(response.body.data, null);
    assert.equal(calls.some((call) => call.text.includes('fn_create_kyc')), false);
  });

  it('rejects missing upload files before the database call', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app, calls } = appWith(async () => ({ rows: [] }));

    const response = await request(app)
      .post('/api/kyc/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        document_type_ref_data_id: '33',
        mime_type: 'image/jpeg',
      });

    assert.equal(response.status, 400);
    assert.equal(response.body.status, 'ERROR');
    assert.equal(response.body.code, 400);
    assert.equal(response.body.message, 'Upload a document file');
    assert.equal(response.body.data, null);
    assert.equal(calls.some((call) => call.text.includes('fn_create_kyc')), false);
  });

  it('requires a rejection comment for reject', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app, calls } = appWith(async () => ({ rows: [] }));

    const response = await request(app)
      .post('/api/kyc/update')
      .set('Authorization', `Bearer ${token}`)
      .send({ kyc_document_id: '12', action: 'REJECT' });

    assert.equal(response.status, 400);
    assert.equal(response.body.message, 'Enter a rejection comment');
    assert.equal(calls.some((call) => call.text.includes('fn_update_kyc')), false);
  });

  it('forwards admin approve without a comment', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app } = appWith(async (text, params) => {
      if (!text.includes('fn_update_kyc_document_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.action, 'APPROVE');
      assert.equal(payload.rejection_comment, undefined);
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'KYC document approved',
            data: { status_code: 'KYC_APPROVED' },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/kyc/update')
      .set('Authorization', `Bearer ${token}`)
      .send({ kyc_document_id: '12', action: 'APPROVE' });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.status_code, 'KYC_APPROVED');
  });

  it('requires authentication', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const { app } = appWith(async () => ({ rows: [] }));
    const response = await request(app).post('/api/kyc').send({});
    assert.equal(response.status, 401);
  });
});

describe('POST /api/installations/update', () => {
  it('updates site KYC profile fields without trusting client user id', async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const token = createSessionToken('7', '9', TEST_SECRET);
    const { app } = appWith(async (text, params) => {
      if (!text.includes('fn_update_site_details')) return { rows: [] };
      const payload = JSON.parse(params[0]);
      assert.equal(payload.site_id, '1');
      assert.equal(payload.discom_id, '3');
      assert.equal(payload.consumer_number, 'CN-100');
      assert.equal(payload.user_id, undefined);
      return {
        rows: [{
          response: {
            status: 'SUCCESS',
            code: 200,
            message: 'Site profile updated',
            data: { site_id: '1', consumer_number: 'CN-100' },
          },
        }],
      };
    });

    const response = await request(app)
      .post('/api/installations/update')
      .set('Authorization', `Bearer ${token}`)
      .send({
        user_id: '99',
        site_id: '1',
        address_line1: '12 Solar Lane',
        discom_id: '3',
        consumer_number: 'CN-100',
        meter_number: 'M-9',
        sanctioned_load_kw: '5.000',
        latitude: '18.5204000',
        longitude: '73.8567000',
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.consumer_number, 'CN-100');
  });
});
