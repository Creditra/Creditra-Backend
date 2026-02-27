import { Router } from 'express';
import { ok } from '../utils/response.js';
import { listCreditLines } from '../services/creditService.js';

export const creditRouter = Router();

creditRouter.get('/lines', (_req, res) => {
  ok(res, listCreditLines());
});

export default creditRouter;
