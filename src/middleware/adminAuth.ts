import type { Request, Response, NextFunction } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import {
    sendProblem,
    serviceUnavailable,
    unauthorized,
} from "../errors/index.js";

export const ADMIN_KEY_HEADER = "x-admin-api-key" as const;

function timingSafeStringEqual(left: string, right: string): boolean {
    const leftDigest = createHash("sha256").update(left, "utf8").digest();
    const rightDigest = createHash("sha256").update(right, "utf8").digest();

    return timingSafeEqual(leftDigest, rightDigest) && left.length === right.length;
}

export function adminAuth(
    req: Request,
    res: Response,
    next: NextFunction,
): void {
    const expectedKey = process.env["ADMIN_API_KEY"];

    if (!expectedKey) {
        sendProblem(
            res,
            serviceUnavailable(
                "Admin authentication is not configured on this server.",
            ),
        );
        return;
    }

    const providedKey = req.headers[ADMIN_KEY_HEADER];

    if (typeof providedKey !== "string" || !timingSafeStringEqual(providedKey, expectedKey)) {
        sendProblem(
            res,
            unauthorized("Unauthorized: valid X-Admin-Api-Key header is required."),
        );
        return;
    }

    next();
}
