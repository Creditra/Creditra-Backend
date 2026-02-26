import { Router, Request, Response, NextFunction } from 'express';
import { ok } from '../utils/response.js';
import { adminAuth } from '../middleware/adminAuth.js';
import {
  listCreditLines,
  getCreditLine,
  suspendCreditLine,
  closeCreditLine,
  CreditLineNotFoundError,
  InvalidTransitionError,
} from '../services/creditService.js';
import { AppError, ErrorCode, notFoundError, validationError } from '../errors/index.js';

export const creditRouter = Router();

/**
 * Maps service-level errors to AppErrors so the global middleware
 * can handle them consistently.
 */
function handleServiceError(err: unknown, next: NextFunction): void {
  if (err instanceof CreditLineNotFoundError) {
    return next(notFoundError('Credit line', (err as any).id));
  }
  if (err instanceof InvalidTransitionError) {
    return next(new AppError(err.message, ErrorCode.VALIDATION_ERROR, undefined, true));
  }
  next(err);
}

creditRouter.get('/lines', (_req: Request, res: Response): void => {
  ok(res, listCreditLines());
});

creditRouter.get('/lines/:id', (req: Request, res: Response, next: NextFunction): void => {
  const line = getCreditLine(req.params.id);
  if (!line) {
    return next(notFoundError('Credit line', req.params.id));
  }
  ok(res, line);
});

creditRouter.post(
  '/lines/:id/suspend',
  adminAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const line = suspendCreditLine(req.params.id);
      ok(res, { line, message: 'Credit line suspended.' });
    } catch (err) {
      handleServiceError(err, next);
    }
  },
);

creditRouter.post(
  '/lines/:id/close',
  adminAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const line = closeCreditLine(req.params.id);
      ok(res, { line, message: 'Credit line closed.' });
    } catch (err) {
      handleServiceError(err, next);
    }
  },
);