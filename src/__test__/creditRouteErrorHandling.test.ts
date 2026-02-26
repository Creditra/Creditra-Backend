import express, { Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  suspend: vi.fn(),
  close: vi.fn(),
}));

vi.mock("../middleware/adminAuth.js", () => ({
  adminAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../services/creditService.js", () => ({
  listCreditLines: vi.fn(() => []),
  getCreditLine: vi.fn(() => undefined),
  suspendCreditLine: mocks.suspend,
  closeCreditLine: mocks.close,
  CreditLineNotFoundError: class CreditLineNotFoundError extends Error {},
  InvalidTransitionError: class InvalidTransitionError extends Error {},
}));

import creditRouter from "../routes/credit.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/credit", creditRouter);
  return app;
}

describe("Credit route error handling", () => {
  beforeEach(() => {
    mocks.suspend.mockReset();
    mocks.close.mockReset();
  });

  it("returns 500 with error message when suspend throws an unexpected Error", async () => {
    mocks.suspend.mockImplementation(() => {
      throw new Error("Unexpected failure");
    });

    const res = await request(buildApp()).post("/api/credit/lines/line-1/suspend");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Unexpected failure" });
  });

  it("returns 500 with generic message when close throws a non-Error value", async () => {
    mocks.close.mockImplementation(() => {
      throw "boom";
    });

    const res = await request(buildApp()).post("/api/credit/lines/line-1/close");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
  });
});
