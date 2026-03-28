import { Router } from 'express';
import { ok } from '../utils/response.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
     return ok(res, {
          status: 'ok',
          service: 'creditra-backend',
     });
});