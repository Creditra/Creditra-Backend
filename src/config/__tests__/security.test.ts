import { afterEach, describe, expect, it } from "vitest";
import {
  loadCookieDefaults,
  loadHelmetOptions,
  loadSecurityPosture,
  loadTrustProxy,
} from "../security.js";

describe("loadTrustProxy", () => {
  it("defaults to false when unset", () => {
    expect(loadTrustProxy({})).toBe(false);
    expect(loadTrustProxy({ TRUST_PROXY: "" })).toBe(false);
    expect(loadTrustProxy({ TRUST_PROXY: "   " })).toBe(false);
  });

  it("parses boolean-ish values", () => {
    expect(loadTrustProxy({ TRUST_PROXY: "true" })).toBe(true);
    expect(loadTrustProxy({ TRUST_PROXY: "YES" })).toBe(true);
    expect(loadTrustProxy({ TRUST_PROXY: "1" })).toBe(1); // hop count, not bool
    expect(loadTrustProxy({ TRUST_PROXY: "false" })).toBe(false);
    expect(loadTrustProxy({ TRUST_PROXY: "off" })).toBe(false);
  });

  it("parses hop counts and named presets", () => {
    expect(loadTrustProxy({ TRUST_PROXY: "2" })).toBe(2);
    expect(loadTrustProxy({ TRUST_PROXY: "loopback" })).toBe("loopback");
    expect(loadTrustProxy({ TRUST_PROXY: "10.0.0.0/8" })).toBe("10.0.0.0/8");
  });
});

describe("loadHelmetOptions", () => {
  it("enables HSTS with a positive maxAge", () => {
    const opts = loadHelmetOptions({ NODE_ENV: "production" });
    expect(opts.hsts).toMatchObject({
      maxAge: 15_552_000,
      includeSubDomains: true,
    });
  });

  it("honours HSTS_MAX_AGE and HSTS_PRELOAD", () => {
    const opts = loadHelmetOptions({
      HSTS_MAX_AGE: "31536000",
      HSTS_PRELOAD: "true",
    });
    expect(opts.hsts).toMatchObject({
      maxAge: 31_536_000,
      preload: true,
    });
  });

  it("denies framing and enables nosniff", () => {
    const opts = loadHelmetOptions({});
    expect(opts.frameguard).toEqual({ action: "deny" });
    expect(opts.noSniff).toBe(true);
    expect(opts.hidePoweredBy).toBe(true);
  });

  it("keeps COEP off so Swagger UI assets load", () => {
    const opts = loadHelmetOptions({});
    expect(opts.crossOriginEmbedderPolicy).toBe(false);
  });
});

describe("loadCookieDefaults", () => {
  it("uses httpOnly + Secure in production", () => {
    expect(loadCookieDefaults({ NODE_ENV: "production" })).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
  });

  it("allows COOKIE_SECURE override in non-production", () => {
    expect(
      loadCookieDefaults({ NODE_ENV: "development", COOKIE_SECURE: "true" }),
    ).toMatchObject({ secure: true, httpOnly: true });
  });
});

describe("loadSecurityPosture", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it("aggregates trust proxy, helmet, and cookie defaults", () => {
    const posture = loadSecurityPosture({
      TRUST_PROXY: "1",
      NODE_ENV: "test",
    });
    expect(posture.trustProxy).toBe(1);
    expect(posture.helmet.frameguard).toEqual({ action: "deny" });
    expect(posture.cookieDefaults.httpOnly).toBe(true);
  });
});
