import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminAuth, ADMIN_KEY_HEADER } from "../middleware/adminAuth.js";
import { requestJson } from "./testHttp.js";

const SECRET = "test-admin-secret-key";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.post("/protected", adminAuth, (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

let originalKey: string | undefined;

beforeEach(() => {
  originalKey = process.env["ADMIN_API_KEY"];
  process.env["ADMIN_API_KEY"] = SECRET;
});

afterEach(() => {
  if (originalKey === undefined) {
    delete process.env["ADMIN_API_KEY"];
  } else {
    process.env["ADMIN_API_KEY"] = originalKey;
  }
});

describe("adminAuth middleware", () => {
  describe("when ADMIN_API_KEY env var is configured", () => {
    it("returns 200 when the correct key is supplied", async () => {
      const res = await requestJson(buildApp(), {
        method: "POST",
        path: "/protected",
        headers: { [ADMIN_KEY_HEADER]: SECRET },
        body: {},
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it("returns 401 when the X-Admin-Api-Key header is missing", async () => {
      const res = await requestJson(buildApp(), {
        method: "POST",
        path: "/protected",
        body: {},
      });

      expect(res.status).toBe(401);
      expect((res.body as any).error).toContain("Unauthorized");
    });

    it("returns 401 when the header value is wrong", async () => {
      const res = await requestJson(buildApp(), {
        method: "POST",
        path: "/protected",
        headers: { [ADMIN_KEY_HEADER]: "wrong-key" },
        body: {},
      });

      expect(res.status).toBe(401);
      expect((res.body as any).error).toContain("Unauthorized");
    });

    it("returns JSON content-type on 401", async () => {
      const res = await requestJson(buildApp(), {
        method: "POST",
        path: "/protected",
        body: {},
      });
      expect(res.headers["content-type"]).toMatch(/application\/json/);
    });
  });

  describe("when ADMIN_API_KEY env var is NOT configured", () => {
    beforeEach(() => {
      delete process.env["ADMIN_API_KEY"];
    });

    it("returns 503 regardless of what header is sent", async () => {
      const res = await requestJson(buildApp(), {
        method: "POST",
        path: "/protected",
        headers: { [ADMIN_KEY_HEADER]: "anything" },
        body: {},
      });

      expect(res.status).toBe(503);
    });

    it("body error mentions admin authentication is not configured", async () => {
      const res = await requestJson(buildApp(), {
        method: "POST",
        path: "/protected",
        body: {},
      });
      expect((res.body as any).error).toMatch(/not configured/i);
    });
  });
});
