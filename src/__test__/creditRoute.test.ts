
import express, { Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetStore, createCreditLine } from "../services/creditService.js";

// Mock adminAuth so we can control auth pass/fail from within tests
vi.mock("../middleware/adminAuth.js", () => ({
  adminAuth: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
  ADMIN_KEY_HEADER: "x-admin-api-key",
}));

import creditRouter from "../routes/credit.js";
import { adminAuth } from "../middleware/adminAuth.js";
import { creditLineRepository } from "../repositories/creditLineRepository.js";

const mockAdminAuth = vi.mocked(adminAuth);

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/credit", creditRouter);
  return app;
}

const VALID_ID = "line-abc";
const MISSING_ID = "does-not-exist";
const ADMIN_KEY = "test-secret";

function allowAdmin() {
  mockAdminAuth.mockImplementation((_req, _res, next) => next());
}

function denyAdmin() {
  mockAdminAuth.mockImplementation((_req, res: any, _next) => {
    res.status(401).json({ error: "Unauthorized: valid X-Admin-Api-Key header is required." });
  });
}


beforeEach(() => {
  _resetStore();
  allowAdmin(); // default to allowing admin access, override in specific tests as needed
});

afterEach(() => {
  mockAdminAuth.mockReset();
  vi.restoreAllMocks();
});


describe("GET /api/credit/lines", () => {
  it("returns 200 with an empty array when store is empty", async () => {
    const res = await request(buildApp()).get("/api/credit/lines");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("returns all credit lines", async () => {
    createCreditLine("a");
    createCreditLine("b");
    const res = await request(buildApp()).get("/api/credit/lines");
    expect(res.body.data).toHaveLength(2);
  });

  it("returns JSON content-type", async () => {
    const res = await request(buildApp()).get("/api/credit/lines");
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});


describe("GET /api/credit/lines/:id", () => {
  it("returns 200 with the full credit line payload for a known id", async () => {
    const created = createCreditLine(VALID_ID);
    const res = await request(buildApp()).get(`/api/credit/lines/${VALID_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(created);
  });

  it("returns 404 with the standardized not-found error format for an unknown id", async () => {
    const res = await request(buildApp()).get(`/api/credit/lines/${MISSING_ID}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: `Credit line "${MISSING_ID}" not found.`,
    });
  });

  it("returns JSON content-type on 404", async () => {
    const res = await request(buildApp()).get(`/api/credit/lines/${MISSING_ID}`);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });

  it("returns 500 with the thrown error message when repository throws an Error", async () => {
    vi.spyOn(creditLineRepository, "getById").mockImplementation(() => {
      throw new Error("Repository unavailable");
    });

    const res = await request(buildApp()).get(`/api/credit/lines/${VALID_ID}`);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Repository unavailable" });
  });

  it("returns 500 with a safe default message when repository throws a non-Error", async () => {
    vi.spyOn(creditLineRepository, "getById").mockImplementation(() => {
      throw "boom";
    });

    const res = await request(buildApp()).get(`/api/credit/lines/${VALID_ID}`);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
  });
});

describe("POST /api/credit/lines/:id/suspend — authorization", () => {
  it("returns 401 when admin auth is denied", async () => {
    denyAdmin();
    createCreditLine(VALID_ID);
    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/suspend`);
    expect(res.status).toBe(401);
  });

  it("does not suspend the line when auth is denied", async () => {
    denyAdmin();
    createCreditLine(VALID_ID);
    await request(buildApp()).post(`/api/credit/lines/${VALID_ID}/suspend`);
    const { _store } = await import("../services/creditService.js");
    expect(_store.get(VALID_ID)?.status).toBe("active");
  });
});

describe("POST /api/credit/lines/:id/suspend — business logic", () => {
  it("returns 200 and suspended line for an active credit line", async () => {
    createCreditLine(VALID_ID);
    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/suspend`)
      .set("x-admin-api-key", ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("suspended");
    expect(res.body.message).toBe("Credit line suspended.");
  });

  it("response includes the full credit line object", async () => {
    createCreditLine(VALID_ID);
    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/suspend`)
      .set("x-admin-api-key", ADMIN_KEY);

    expect(res.body.data).toMatchObject({
      id: VALID_ID,
      status: "suspended",
    });
    expect(res.body.data.events).toBeDefined();
  });

  it("returns 404 when the credit line does not exist", async () => {
    const res = await request(buildApp())
      .post(`/api/credit/lines/${MISSING_ID}/suspend`)
      .set("x-admin-api-key", ADMIN_KEY);

    expect(res.status).toBe(404);
    expect(res.body.error).toContain(MISSING_ID);
  });

  it("returns 409 when the line is already suspended", async () => {
    createCreditLine(VALID_ID, "suspended");
    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/suspend`)
      .set("x-admin-api-key", ADMIN_KEY);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/suspend.*suspended|suspended.*suspend/i);
  });

  it("returns 409 when the line is already closed", async () => {
    createCreditLine(VALID_ID, "closed");
    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/suspend`)
      .set("x-admin-api-key", ADMIN_KEY);

    expect(res.status).toBe(409);
  });
});

describe("POST /api/credit/lines/:id/close — authorization", () => {
  it("returns 401 when admin auth is denied", async () => {
    denyAdmin();
    createCreditLine(VALID_ID);
    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/close`);
    expect(res.status).toBe(401);
  });

  it("does not close the line when auth is denied", async () => {
    denyAdmin();
    createCreditLine(VALID_ID);
    await request(buildApp()).post(`/api/credit/lines/${VALID_ID}/close`);
    const { _store } = await import("../services/creditService.js");
    expect(_store.get(VALID_ID)?.status).toBe("active");
  });
});

describe("POST /api/credit/lines/:id/close — business logic", () => {
  it("returns 200 and closed line for an active credit line", async () => {
    createCreditLine(VALID_ID);
    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/close`)
      .set("x-admin-api-key", ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("closed");
    expect(res.body.message).toBe("Credit line closed.");
  });

  it("returns 200 and closed line for a suspended credit line", async () => {
    createCreditLine(VALID_ID, "suspended");
    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/close`)
      .set("x-admin-api-key", ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("closed");
  });

  it("response includes the full credit line object with events", async () => {
    createCreditLine(VALID_ID);
    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/close`)
      .set("x-admin-api-key", ADMIN_KEY);

    expect(res.body.data.events).toBeDefined();
    expect(res.body.data.events.at(-1).action).toBe("closed");
  });

  it("returns 404 when the credit line does not exist", async () => {
    const res = await request(buildApp())
      .post(`/api/credit/lines/${MISSING_ID}/close`)
      .set("x-admin-api-key", ADMIN_KEY);

    expect(res.status).toBe(404);
    expect(res.body.error).toContain(MISSING_ID);
  });

  it("returns 409 when the line is already closed", async () => {
    createCreditLine(VALID_ID, "closed");
    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/close`)
      .set("x-admin-api-key", ADMIN_KEY);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/close.*closed|closed.*close/i);
  });

  it("full lifecycle: active → suspend → close via HTTP", async () => {
    createCreditLine(VALID_ID);
    const app = buildApp();

    await request(app)
      .post(`/api/credit/lines/${VALID_ID}/suspend`)
      .set("x-admin-api-key", ADMIN_KEY);

    const res = await request(app)
      .post(`/api/credit/lines/${VALID_ID}/close`)
      .set("x-admin-api-key", ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("closed");
    expect(res.body.data.events.map((e: { action: string }) => e.action)).toContain("suspended");
  });
});
