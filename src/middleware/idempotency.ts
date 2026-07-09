import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type {
  CachedIdempotencyResponse,
  IdempotencyStore,
} from "../services/idempotencyStore.js";

const IDEMPOTENCY_HEADER = "idempotency-key";
const MAX_KEY_LENGTH = 255;

export function createIdempotencyMiddleware(store: IdempotencyStore) {
  return async function idempotencyMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (req.method !== "POST") {
      next();
      return;
    }

    const rawHeader = req.headers[IDEMPOTENCY_HEADER];
    if (rawHeader === undefined) {
      next();
      return;
    }

    if (Array.isArray(rawHeader)) {
      res.status(400).json({ data: null, error: "Only one Idempotency-Key header is allowed" });
      return;
    }

    const idempotencyKey = rawHeader.trim();
    if (!idempotencyKey) {
      res.status(400).json({ data: null, error: "Idempotency-Key must not be empty" });
      return;
    }
    if (idempotencyKey.length > MAX_KEY_LENGTH) {
      res.status(400).json({ data: null, error: "Idempotency-Key is too long" });
      return;
    }

    const begin = await store.begin({
      keyHash: sha256(idempotencyKey),
      scope: `${req.method}:${req.path}`,
      principalHash: sha256(resolvePrincipal(req)),
      requestHash: sha256(stableStringify({
        method: req.method,
        path: req.path,
        query: req.query,
        body: req.body ?? null,
      })),
    });

    if (begin.state === "conflict") {
      res.status(409).json({
        data: null,
        error: "Idempotency-Key was already used for a different request",
      });
      return;
    }

    if (begin.state === "replay") {
      sendCachedResponse(res, begin.response);
      return;
    }

    if (begin.state === "pending") {
      try {
        const response = await begin.response;
        sendCachedResponse(res, response);
      } catch {
        res.status(409).json({
          data: null,
          error: "A matching idempotent request is still being processed",
        });
      }
      return;
    }

    if (begin.state === "inProgress") {
      res.setHeader("Retry-After", "1");
      res.status(409).json({
        data: null,
        error: "A matching idempotent request is still being processed",
      });
      return;
    }

    captureResponse(req, res, store, begin.token);
    next();
  };
}

function captureResponse(
  req: Request,
  res: Response,
  store: IdempotencyStore,
  token: string,
): void {
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  let capturedBody: unknown;

  res.json = ((body: unknown) => {
    capturedBody = body;
    return originalJson(body);
  }) as Response["json"];

  res.send = ((body: unknown) => {
    if (capturedBody === undefined) {
      capturedBody = normalizeSendBody(body);
    }
    return originalSend(body);
  }) as Response["send"];

  res.on("finish", () => {
    const response: CachedIdempotencyResponse = {
      statusCode: res.statusCode,
      body: capturedBody ?? null,
    };

    if (res.statusCode >= 500) {
      void store.fail(token);
      return;
    }

    void store.complete(token, response);
  });

  res.on("close", () => {
    if (!res.writableEnded) {
      void store.fail(token);
    }
  });

  req.on("aborted", () => {
    void store.fail(token);
  });
}

function sendCachedResponse(res: Response, response: CachedIdempotencyResponse): void {
  res.setHeader("Idempotency-Status", "replayed");
  res.status(response.statusCode).json(response.body);
}

function normalizeSendBody(body: unknown): unknown {
  if (Buffer.isBuffer(body)) {
    return body.toString("utf8");
  }

  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }

  return body;
}

function resolvePrincipal(req: Request): string {
  const apiKey = headerValue(req, "x-api-key");
  if (apiKey) return `x-api-key:${sha256(apiKey)}`;

  const adminApiKey = headerValue(req, "x-admin-api-key");
  if (adminApiKey) return `x-admin-api-key:${sha256(adminApiKey)}`;

  const authorization = headerValue(req, "authorization");
  if (authorization) return `authorization:${sha256(authorization)}`;

  const walletAddress = typeof req.body?.walletAddress === "string"
    ? req.body.walletAddress
    : undefined;
  if (walletAddress) return `wallet:${sha256(walletAddress)}`;

  return "anonymous";
}

function headerValue(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
