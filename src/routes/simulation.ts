/**
 * Simulation endpoints — preflight validation without side effects.
 *
 * POST /api/credit/lines/:id/draw/simulate
 * POST /api/credit/lines/:id/repay/simulate
 *
 * Returns what WOULD happen if the real operation were called:
 * fee breakdown, new balance, validation errors — without touching state.
 */

import { Router, type Request, type Response } from 'express';
import { validateBody } from '../middleware/validate.js';
import { drawSchema, repaySchema } from '../schemas/index.js';
import type { DrawBody, RepayBody } from '../schemas/index.js';
import { ok, fail } from '../utils/response.js';
import { Container } from '../container/Container.js';
import { CreditLineNotFoundError } from '../services/creditService.js';

export const simulationRouter = Router();
const container = Container.getInstance();

const INTEREST_RATE_DIVISOR = 10_000; // bps denominator

simulationRouter.post(
  '/lines/:id/draw/simulate',
  validateBody(drawSchema),
  async (req: Request, res: Response, next) => {
    try {
      const line = await container.creditLineService.getCreditLine(req.params.id);
      if (!line) throw new CreditLineNotFoundError(req.params.id);

      const { amount } = req.body as DrawBody;
      const drawAmount = Number(amount);
      const availableCredit = Number(line.creditLimit) - Number(line.balance ?? 0);
      const valid = drawAmount > 0 && drawAmount <= availableCredit;
      const interestBps: number = (line as unknown as Record<string, unknown>)['interestRateBps'] as number ?? 0;
      const estimatedFee = Math.ceil(drawAmount * interestBps / INTEREST_RATE_DIVISOR);

      return ok(res, {
        simulation: 'draw',
        valid,
        issues: valid ? [] : [
          drawAmount <= 0 ? 'amount must be positive' : null,
          drawAmount > availableCredit ? `amount ${drawAmount} exceeds available credit ${availableCredit}` : null,
        ].filter(Boolean),
        preview: {
          requestedAmount: drawAmount,
          estimatedFee,
          newBalance: valid ? Number(line.balance ?? 0) + drawAmount : null,
          remainingCredit: valid ? availableCredit - drawAmount : availableCredit,
        },
      });
    } catch (err) {
      if (err instanceof CreditLineNotFoundError) return fail(res, err.message, 404);
      next(err);
    }
  },
);

simulationRouter.post(
  '/lines/:id/repay/simulate',
  validateBody(repaySchema),
  async (req: Request, res: Response, next) => {
    try {
      const line = await container.creditLineService.getCreditLine(req.params.id);
      if (!line) throw new CreditLineNotFoundError(req.params.id);

      const { amount } = req.body as RepayBody;
      const repayAmount = Number(amount);
      const currentBalance = Number(line.balance ?? 0);
      const effectiveRepay = Math.min(repayAmount, currentBalance);
      const valid = repayAmount > 0;

      return ok(res, {
        simulation: 'repay',
        valid,
        issues: valid ? [] : ['amount must be positive'],
        preview: {
          requestedAmount: repayAmount,
          effectiveRepayAmount: effectiveRepay,
          overpaymentReturned: repayAmount > currentBalance ? repayAmount - currentBalance : 0,
          newBalance: valid ? currentBalance - effectiveRepay : currentBalance,
        },
      });
    } catch (err) {
      if (err instanceof CreditLineNotFoundError) return fail(res, err.message, 404);
      next(err);
    }
  },
);

export default simulationRouter;
