import express, { type Express } from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import creditRouter from "../routes/credit.js";
import { _resetStore, _store, createCreditLine } from "../services/creditService.js";
import { requestJson } from "./testHttp.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/credit", creditRouter);
  return app;
}

const VALID_ID = "line-abc";
const MISSING_ID = "does-not-exist";
const ADMIN_KEY = "test-secret";

let originalKey: string | undefined;

beforeEach(() => {
  originalKey = process.env["ADMIN_API_KEY"];
  process.env["ADMIN_API_KEY"] = ADMIN_KEY;
  _resetStore();
});

afterEach(() => {
  if (originalKey === undefined) delete process.env["ADMIN_API_KEY"];
  else process.env["ADMIN_API_KEY"] = originalKey;
});

describe("GET /api/credit/lines", () => {
  it("returns 200 with an empty array when store is empty", async () => {
    const res = await requestJson(buildApp(), { method: "GET", path: "/api/credit/lines" });
    expect(res.status).toBe(200);
    expect((res.body as any).data).toEqual([]);
  });

  it("returns all credit lines", async () => {
    createCreditLine("a");
    createCreditLine("b");
    const res = await requestJson(buildApp(), { method: "GET", path: "/api/credit/lines" });
    expect((res.body as any).data).toHaveLength(2);
  });

  it("returns JSON content-type", async () => {
    const res = await requestJson(buildApp(), { method: "GET", path: "/api/credit/lines" });
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});

describe("GET /api/credit/lines/:id", () => {
  it("returns 200 with the credit line for a known id", async () => {
    createCreditLine(VALID_ID);
    const res = await requestJson(buildApp(), { method: "GET", path: `/api/credit/lines/${VALID_ID}` });
    expect(res.status).toBe(200);
    expect((res.body as any).data.id).toBe(VALID_ID);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await requestJson(buildApp(), { method: "GET", path: `/api/credit/lines/${MISSING_ID}` });
    expect(res.status).toBe(404);
    expect((res.body as any).error).toContain(MISSING_ID);
  });
});

describe("POST /api/credit/lines/:id/suspend — authorization", () => {
  it("returns 401 when admin key is missing", async () => {
    createCreditLine(VALID_ID);
    const res = await requestJson(buildApp(), {
      method: "POST",
      path: `/api/credit/lines/${VALID_ID}/suspend`,
      body: {},
    });
    expect(res.status).toBe(401);
  });

  it("does not suspend the line when auth is denied", async () => {
    createCreditLine(VALID_ID);
    await requestJson(buildApp(), {
      method: "POST",
      path: `/api/credit/lines/${VALID_ID}/suspend`,
      body: {},
    });
    expect(_store.get(VALID_ID)?.status).toBe("active");
  });
});

describe("POST /api/credit/lines/:id/suspend — business logic", () => {
  it("returns 200 and suspended line for an active credit line", async () => {
    createCreditLine(VALID_ID);
    const res = await requestJson(buildApp(), {
      method: "POST",
      path: `/api/credit/lines/${VALID_ID}/suspend`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      body: {},
    });

    expect(res.status).toBe(200);
    expect((res.body as any).data.status).toBe("suspended");
    expect((res.body as any).message).toBe("Credit line suspended.");
  });

  it("returns 404 when the credit line does not exist", async () => {
    const res = await requestJson(buildApp(), {
      method: "POST",
      path: `/api/credit/lines/${MISSING_ID}/suspend`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      body: {},
    });

    expect(res.status).toBe(404);
    expect((res.body as any).error).toContain(MISSING_ID);
  });
});

describe("POST /api/credit/lines/:id/close — authorization", () => {
  it("returns 401 when admin key is missing", async () => {
    createCreditLine(VALID_ID);
    const res = await requestJson(buildApp(), {
      method: "POST",
      path: `/api/credit/lines/${VALID_ID}/close`,
      body: {},
    });
    expect(res.status).toBe(401);
  });
});
