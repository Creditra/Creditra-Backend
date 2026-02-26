import { type Request, type Response, type NextFunction } from "express";

export const ADMIN_KEY_HEADER = "x-admin-api-key" as const;

export function adminAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expectedKey = process.env["ADMIN_API_KEY"];

  if (!expectedKey) {
    res.status(503).json({
      error: "Admin authentication is not configured on this server.",
    });
    return;
  }

  const providedKey = req.headers[ADMIN_KEY_HEADER];
  const providedKeyStr = typeof providedKey === "string" ? providedKey : "";

  if (!providedKeyStr || providedKeyStr !== expectedKey) {
    res.status(401).json({
      error: "Unauthorized: valid X-Admin-Api-Key header is required.",
    });
    return;
  }

  next();
}
