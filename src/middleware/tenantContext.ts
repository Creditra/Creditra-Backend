import type { NextFunction, Request, Response } from "express";
import { fail } from "../utils/response.js";

export const TENANT_ID_HEADER = "x-tenant-id" as const;

/**
 * Require tenant context for endpoints that access tenant-scoped data.
 * Stores the tenant id on res.locals.tenantId.
 */
export function requireTenant(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const tenantId = req.header(TENANT_ID_HEADER);
  if (!tenantId) {
    fail(res, `${TENANT_ID_HEADER} header is required`, 400);
    return;
  }

  res.locals.tenantId = tenantId;
  next();
}

export function getTenantId(res: Response): string {
  return String(res.locals.tenantId);
}
