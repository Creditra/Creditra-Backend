import type { Application } from "express";
import { IncomingMessage, ServerResponse } from "node:http";
import { Duplex } from "node:stream";

export interface JsonResponse<T = unknown> {
  status: number;
  headers: Record<string, string | string[]>;
  body: T;
}

/**
 * Minimal HTTP request helper that does not open a network port.
 * This avoids sandbox restrictions around `listen()` while still exercising
 * Express middleware and routing (including express.json()).
 */
export async function requestJson<T = unknown>(
  app: Application,
  opts: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
  },
): Promise<JsonResponse<T>> {
  const socket = new Duplex({
    read() {},
    write(_chunk, _enc, cb) {
      cb();
    },
  });

  const req = new IncomingMessage(socket as any);
  req.method = opts.method;
  req.url = opts.path;
  req.headers = Object.fromEntries(
    Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  ) as any;

  const bodyBuf =
    opts.body !== undefined ? Buffer.from(JSON.stringify(opts.body), "utf8") : null;
  if (bodyBuf) {
    req.headers["content-type"] = req.headers["content-type"] ?? "application/json";
    req.headers["content-length"] = String(bodyBuf.length);
  } else {
    req.headers["content-length"] = req.headers["content-length"] ?? "0";
  }

  const res = new ServerResponse(req);
  (res as any).assignSocket?.(socket);
  (res as any).onSocket?.(socket);

  const bodyChunks: Buffer[] = [];
  const originalWrite = res.write.bind(res);
  res.write = ((chunk: any, ...rest: any[]) => {
    if (chunk !== undefined && chunk !== null && chunk.length !== 0) {
      bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return (originalWrite as any)(chunk, ...rest);
  }) as any;

  const originalEnd = res.end.bind(res);
  res.end = ((chunk: any, ...rest: any[]) => {
    if (chunk !== undefined && chunk !== null && chunk.length !== 0) {
      bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return (originalEnd as any)(chunk, ...rest);
  }) as any;

  const done = new Promise<void>((resolve) => res.once("finish", resolve));
  (app as any).handle(req as any, res as any);

  await new Promise<void>((resolve) => setImmediate(resolve));
  if (bodyBuf) req.emit("data", bodyBuf);
  req.emit("end");
  await done;

  const raw = Buffer.concat(bodyChunks).toString("utf8");
  const headers = Object.fromEntries(
    Object.entries(res.getHeaders()).map(([k, v]) => [
      k,
      Array.isArray(v) ? v.map(String) : v === undefined ? "" : String(v),
    ]),
  );

  const contentType = String(headers["content-type"] ?? "");
  const body = contentType.includes("application/json") && raw.length > 0
    ? JSON.parse(raw)
    : (raw as any);

  return { status: res.statusCode, headers, body: body as T };
}

