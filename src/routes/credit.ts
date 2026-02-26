import { Router, Request, Response } from 'express';
import { createApiKeyMiddleware } from '../middleware/auth.js';
import { loadApiKeys } from '../config/apiKeys.js';
import { ok, fail } from "../utils/response.js";
import {
  listCreditLines,
  getCreditLine,
  suspendCreditLine,
  closeCreditLine,
  CreditLineNotFoundError,
  InvalidTransitionError,
} from "../services/creditService.js";

export const creditRouter = Router();

// Use a resolver function so API_KEYS is read lazily per-request,
// allowing the env var to be set after module import (e.g. in tests).
const requireApiKey = createApiKeyMiddleware(() => loadApiKeys());

function handleServiceError(err: unknown, res: Response): void {
  if (err instanceof CreditLineNotFoundError) {
    fail(res, err.message, 404);
    return;
  }
  if (err instanceof InvalidTransitionError) {
    fail(res, err.message, 409);
    return;
  }
  fail(res, err, 500);
}

// ---------------------------------------------------------------------------
// Public endpoints – no API key required
// ---------------------------------------------------------------------------

creditRouter.get("/lines", (_req: Request, res: Response): void => {
  ok(res, listCreditLines());
});

creditRouter.get("/lines/:id", (req: Request, res: Response): void => {
  const line = getCreditLine(req.params["id"] as string);
  if (!line) {
    fail(res, `Credit line "${req.params["id"]}" not found.`, 404);
    return;
  }
  ok(res, line);
});

// ---------------------------------------------------------------------------
// Admin endpoints – require a valid API key via `X-API-Key` header
// ---------------------------------------------------------------------------

/**
 * POST /api/credit/lines/:id/suspend
 * Suspend an active credit line.  Requires admin API key.
 */
creditRouter.post(
  "/lines/:id/suspend",
  requireApiKey,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const line = suspendCreditLine(req.params["id"] as string);
      ok(res, { line, message: "Credit line suspended." });
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);

/**
 * POST /api/credit/lines/:id/close
 * Permanently close a credit line.  Requires admin API key.
 */
creditRouter.post(
  "/lines/:id/close",
  requireApiKey,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const line = closeCreditLine(req.params["id"] as string);
      ok(res, { line, message: "Credit line closed." });
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);
