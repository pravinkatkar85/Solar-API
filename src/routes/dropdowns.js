import { Router } from 'express';
import {
  queryDropdown,
  validateDropdownRequest,
  writeApiAudit,
} from '../db/dropdowns.js';

function clientAddress(req) {
  const address = req.socket?.remoteAddress ?? '';
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

export function createDropdownRouter({ query }) {
  const router = Router();

  router.post('/', async (req, res) => {
    const started = Date.now();
    const validation = validateDropdownRequest(req.body);
    let httpStatus = 500;
    let response = {
      status: 'ERROR',
      code: 500,
      message: 'Dropdown options could not be loaded',
      data: null,
    };

    try {
      if (!validation.ok) {
        httpStatus = 400;
        response = {
          status: 'ERROR',
          code: 400,
          message: validation.message,
          data: null,
        };
      } else {
        const functionResponse = await queryDropdown(query, validation.request);
        if (!functionResponse) {
          httpStatus = 500;
        } else {
          httpStatus = functionResponse.code;
          response = functionResponse;
        }
      }
    } catch (error) {
      console.error('Dropdown query failed', { code: error?.code ?? 'UNKNOWN' });
      httpStatus = 500;
    }

    try {
      await writeApiAudit(query, {
        body: req.body,
        response,
        httpStatus,
        elapsedMs: Date.now() - started,
        clientIp: clientAddress(req),
      });
    } catch (error) {
      console.error('API audit failed', { code: error?.code ?? 'UNKNOWN' });
    }

    res.status(httpStatus).json(response);
  });

  return router;
}
