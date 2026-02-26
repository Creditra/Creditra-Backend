import express, { type Express } from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import creditRouter from "../routes/credit.js";
import { _resetStore, createCreditLine } from "../services/creditService.js";
import { requestJson } from "./testHttp.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/credit", creditRouter);
  return app;
}

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const ADMIN_KEY = "test-admin-key";

let originalAdminKey: string | undefined;

beforeEach(() => {
  _resetStore();
  originalAdminKey = process.env["ADMIN_API_KEY"];
  process.env["ADMIN_API_KEY"] = ADMIN_KEY;
});

afterEach(() => {
  if (originalAdminKey === undefined) delete process.env["ADMIN_API_KEY"];
  else process.env["ADMIN_API_KEY"] = originalAdminKey;
});

describe("tenant context", () => {
  it("returns 400 when x-tenant-id is missing", async () => {
    const res = await requestJson(buildApp(), {
      method: "GET",
      path: "/api/credit/lines",
    });
    expect(res.status).toBe(400);
    expect((res.body as any).error).toContain("x-tenant-id");
  });
});

describe("GET /api/credit/lines", () => {
  it("returns only lines for the current tenant", async () => {
    createCreditLine(TENANT_A, "a1");
    createCreditLine(TENANT_B, "b1");

    const resA = await requestJson(buildApp(), {
      method: "GET",
      path: "/api/credit/lines",
      headers: { "x-tenant-id": TENANT_A },
    });
    expect(resA.status).toBe(200);
    expect((resA.body as any).data.map((l: any) => l.id)).toEqual(["a1"]);

    const resB = await requestJson(buildApp(), {
      method: "GET",
      path: "/api/credit/lines",
      headers: { "x-tenant-id": TENANT_B },
    });
    expect((resB.body as any).data.map((l: any) => l.id)).toEqual(["b1"]);
  });
});

describe("GET /api/credit/lines/:id", () => {
  it("returns 404 when id exists in another tenant", async () => {
    createCreditLine(TENANT_A, "shared");
    const res = await requestJson(buildApp(), {
      method: "GET",
      path: "/api/credit/lines/shared",
      headers: { "x-tenant-id": TENANT_B },
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/credit/lines/:id/suspend", () => {
  it("returns 401 without admin key", async () => {
    createCreditLine(TENANT_A, "line-1");
    const res = await requestJson(buildApp(), {
      method: "POST",
      path: "/api/credit/lines/line-1/suspend",
      headers: { "x-tenant-id": TENANT_A },
      body: {},
    });
    expect(res.status).toBe(401);
  });

  it("suspends within the current tenant", async () => {
    createCreditLine(TENANT_A, "line-1");
    const res = await requestJson(buildApp(), {
      method: "POST",
      path: "/api/credit/lines/line-1/suspend",
      headers: { "x-tenant-id": TENANT_A, "x-admin-api-key": ADMIN_KEY },
      body: {},
    });
    expect(res.status).toBe(200);
    expect((res.body as any).data.line.status).toBe("suspended");
  });
});
