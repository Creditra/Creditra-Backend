
import express, { Express } from "express";
import request from "supertest";
import { vi, describe, it, expect, afterEach, beforeEach } from "vitest";
import { _resetStore, createCreditLine } from "../services/creditService.js";

// Mock adminAuth so we can control auth pass/fail from within tests
vi.mock("../middleware/adminAuth.js", () => ({
  adminAuth: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
  ADMIN_KEY_HEADER: "x-admin-api-key",
}));

import creditRouter from "../routes/credit.js";
import { adminAuth } from "../middleware/adminAuth.js";

const mockAdminAuth = adminAuth as ReturnType<typeof vi.fn>;

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
  vi.resetAllMocks();
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
  it("returns 200 with the credit line for a known id", async () => {
    createCreditLine(VALID_ID);
    const res = await request(buildApp()).get(`/api/credit/lines/${VALID_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(VALID_ID);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await request(buildApp()).get(`/api/credit/lines/${MISSING_ID}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toContain(MISSING_ID);
  });

  it("returns JSON content-type on 404", async () => {
    const res = await request(buildApp()).get(`/api/credit/lines/${MISSING_ID}`);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
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

describe("POST /api/credit/lines/:id/repay — authorization", () => {
  it("returns 401 when admin auth is denied", async () => {
    denyAdmin();
    const line = createCreditLine(VALID_ID);
    line.utilizedAmount = 500;

    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/repay`)
      .send({ amount: 200 });
    expect(res.status).toBe(401);
  });

  it("does not process repayment when auth is denied", async () => {
    denyAdmin();
    const line = createCreditLine(VALID_ID);
    line.utilizedAmount = 500;

    await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/repay`)
      .send({ amount: 200 });

    const { _store } = await import("../services/creditService.js");
    expect(_store.get(VALID_ID)?.utilizedAmount).toBe(500);
  });
});

describe("POST /api/credit/lines/:id/repay — business logic", () => {
  it("returns 200 and processes full repayment correctly", async () => {
    const line = createCreditLine(VALID_ID);
    line.utilizedAmount = 500;

    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/repay`)
      .set("x-admin-api-key", ADMIN_KEY)
      .send({ amount: 500 });

    expect(res.status).toBe(200);
    expect(res.body.data.utilizedAmount).toBe(0);
    expect(res.body.message).toContain("Repayment of 500 processed");
    expect(res.body.message).toContain("New utilized amount: 0");
  });

  it("returns 200 and processes partial repayment correctly", async () => {
    const line = createCreditLine(VALID_ID);
    line.utilizedAmount = 500;

    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/repay`)
      .set("x-admin-api-key", ADMIN_KEY)
      .send({ amount: 200 });

    expect(res.status).toBe(200);
    expect(res.body.data.utilizedAmount).toBe(300);
    expect(res.body.message).toContain("Repayment of 200 processed");
    expect(res.body.message).toContain("New utilized amount: 300");
  });

  it("includes transaction reference in repayment event", async () => {
    const line = createCreditLine(VALID_ID);
    line.utilizedAmount = 500;

    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/repay`)
      .set("x-admin-api-key", ADMIN_KEY)
      .send({
        amount: 200,
        transactionReference: "tx-abc123"
      });

    expect(res.status).toBe(200);
    expect(res.body.data.events).toHaveLength(2);
    expect(res.body.data.events[1].action).toBe("repayment");
    expect(res.body.data.events[1].amount).toBe(200);
    expect(res.body.data.events[1].transactionReference).toBe("tx-abc123");
  });

  it("returns 404 when the credit line does not exist", async () => {
    const res = await request(buildApp())
      .post(`/api/credit/lines/${MISSING_ID}/repay`)
      .set("x-admin-api-key", ADMIN_KEY)
      .send({ amount: 200 });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain(MISSING_ID);
  });

  it("returns 400 when amount is missing", async () => {
    const line = createCreditLine(VALID_ID);
    line.utilizedAmount = 500;

    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/repay`)
      .set("x-admin-api-key", ADMIN_KEY)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Amount is required");
  });

  it("returns 400 when amount is not a number", async () => {
    const line = createCreditLine(VALID_ID);
    line.utilizedAmount = 500;

    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/repay`)
      .set("x-admin-api-key", ADMIN_KEY)
      .send({ amount: "invalid" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("must be a number");
  });

  it("returns 400 when amount is zero", async () => {
    const line = createCreditLine(VALID_ID);
    line.utilizedAmount = 500;

    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/repay`)
      .set("x-admin-api-key", ADMIN_KEY)
      .send({ amount: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("must be positive");
  });

  it("returns 400 when amount is negative", async () => {
    const line = createCreditLine(VALID_ID);
    line.utilizedAmount = 500;

    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/repay`)
      .set("x-admin-api-key", ADMIN_KEY)
      .send({ amount: -100 });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("must be positive");
  });

  it("returns 400 when repayment exceeds utilized amount", async () => {
    const line = createCreditLine(VALID_ID);
    line.utilizedAmount = 300;

    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/repay`)
      .set("x-admin-api-key", ADMIN_KEY)
      .send({ amount: 400 });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("cannot exceed utilized amount");
  });

  it("returns 409 when credit line is suspended", async () => {
    const line = createCreditLine(VALID_ID, "suspended");
    line.utilizedAmount = 500;

    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/repay`)
      .set("x-admin-api-key", ADMIN_KEY)
      .send({ amount: 200 });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/repay.*suspended/);
  });

  it("returns 409 when credit line is closed", async () => {
    const line = createCreditLine(VALID_ID, "closed");
    line.utilizedAmount = 500;

    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/repay`)
      .set("x-admin-api-key", ADMIN_KEY)
      .send({ amount: 200 });

    expect(res.status).toBe(409);
  });

  it("handles multiple sequential repayments", async () => {
    const line = createCreditLine(VALID_ID);
    line.utilizedAmount = 500;
    const app = buildApp();

    const res1 = await request(app)
      .post(`/api/credit/lines/${VALID_ID}/repay`)
      .set("x-admin-api-key", ADMIN_KEY)
      .send({ amount: 200 });

    expect(res1.status).toBe(200);
    expect(res1.body.data.utilizedAmount).toBe(300);

    const res2 = await request(app)
      .post(`/api/credit/lines/${VALID_ID}/repay`)
      .set("x-admin-api-key", ADMIN_KEY)
      .send({ amount: 150 });

    expect(res2.status).toBe(200);
    expect(res2.body.data.utilizedAmount).toBe(150);
    expect(res2.body.data.events).toHaveLength(3); // created + 2 repayments
  });

  it("returns JSON content-type", async () => {
    const line = createCreditLine(VALID_ID);
    line.utilizedAmount = 500;

    const res = await request(buildApp())
      .post(`/api/credit/lines/${VALID_ID}/repay`)
      .set("x-admin-api-key", ADMIN_KEY)
      .send({ amount: 200 });

    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});
