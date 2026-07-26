import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { applySecurityPosture } from "../securityHeaders.js";
import { loadSecurityPosture } from "../../config/security.js";

function buildApp(env: NodeJS.ProcessEnv = { NODE_ENV: "test" }) {
  const app = express();
  const posture = applySecurityPosture(app, loadSecurityPosture(env));
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", ip: _req.ip });
  });
  return { app, posture };
}

describe("applySecurityPosture headers", () => {
  it("sets baseline security headers on responses", async () => {
    const { app } = buildApp({ NODE_ENV: "test" });
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);

    // X-Content-Type-Options
    expect(res.headers["x-content-type-options"]).toBe("nosniff");

    // X-Frame-Options
    expect(res.headers["x-frame-options"]).toBe("DENY");

    // HSTS
    expect(res.headers["strict-transport-security"]).toMatch(/max-age=\d+/i);
    expect(res.headers["strict-transport-security"]).toMatch(/includesubdomains/i);

    // CSP present with self default
    expect(res.headers["content-security-policy"]).toMatch(/default-src 'self'/i);
    expect(res.headers["content-security-policy"]).toMatch(/frame-ancestors 'none'/i);

    // Referrer-Policy
    expect(res.headers["referrer-policy"]).toBe("no-referrer");

    // X-DNS-Prefetch-Control
    expect(res.headers["x-dns-prefetch-control"]).toBe("off");

    // X-Powered-By stripped
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("configures trust proxy hop count so req.ip uses X-Forwarded-For", async () => {
    const { app, posture } = buildApp({
      NODE_ENV: "test",
      TRUST_PROXY: "1",
    });
    expect(posture.trustProxy).toBe(1);

    const res = await request(app)
      .get("/health")
      .set("X-Forwarded-For", "203.0.113.9");

    expect(res.status).toBe(200);
    expect(res.body.ip).toBe("203.0.113.9");
  });

  it("ignores spoofed X-Forwarded-For when trust proxy is disabled", async () => {
    const { app, posture } = buildApp({
      NODE_ENV: "test",
      TRUST_PROXY: "false",
    });
    expect(posture.trustProxy).toBe(false);

    const res = await request(app)
      .get("/health")
      .set("X-Forwarded-For", "203.0.113.9");

    expect(res.status).toBe(200);
    // Without trust proxy, Express uses the direct socket address (loopback in tests).
    expect(res.body.ip).not.toBe("203.0.113.9");
  });
});
