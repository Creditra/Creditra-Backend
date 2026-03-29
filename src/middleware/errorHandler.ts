import type { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger.js";

/**
 * Global error-handling middleware.
 *
 * Catches any unhandled errors thrown (or passed via `next(err)`) from route
 * handlers and returns a consistent JSON error response.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  logger.error({ err }, "unhandled_error");
  res.status(500).json({ error: "Internal server error" });
}
