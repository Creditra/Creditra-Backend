import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";

export const ADMIN_KEY_HEADER = "x-admin-api-key" as const;

function timingSafeStringEqual(left: string, right: string): boolean {
    const leftBytes = Buffer.from(left, "utf8");
    const rightBytes = Buffer.from(right, "utf8");

    return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

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

    if (typeof providedKey !== "string" || !timingSafeStringEqual(providedKey, expectedKey)) {
        res.status(401).json({
        error: "Unauthorized: valid X-Admin-Api-Key header is required.",
        });
        return;
    }

    next();
}
