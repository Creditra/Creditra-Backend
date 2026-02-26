import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import { healthRouter } from "../healthRouter.js";
import type { HealthReport } from "../healthService.js";

// ---------------------------------------------------------------------------
// Mock the health service so route tests don't perform real I/O
// ---------------------------------------------------------------------------
vi.mock("../healthService.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../healthService.js")>();
  return { ...original, runHealthChecks: vi.fn() };
});

import { runHealthChecks } from "../healthService.js";
const mockRunHealthChecks = vi.mocked(runHealthChecks);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/", healthRouter);
  return app;
}

const baseReport: HealthReport = {
  service: "creditra-backend",
  checkedAt: "2026-02-26T12:00:00.000Z",
  status: "ok",
  dependencies: {
    database: { status: "ok" },
    horizon: { status: "ok" },
    redis: { status: "ok", note: "Redis not yet integrated; check skipped." },
    riskEngine: {
      status: "ok",
      note: "Risk engine not yet integrated; check skipped.",
    },
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("GET /health — status ok", () => {
  beforeEach(() => {
    mockRunHealthChecks.mockResolvedValue({ ...baseReport, status: "ok" });
  });

  afterEach(() => vi.clearAllMocks());

  it("returns HTTP 200", async () => {
    const res = await request(buildApp()).get("/health");
    expect(res.status).toBe(200);
  });

  it("returns the standard { data, error } envelope", async () => {
    const res = await request(buildApp()).get("/health");
    expect(res.body).toHaveProperty("data");
    expect(res.body.error).toBeNull();
  });

  it("response data contains status, service, checkedAt, and dependencies", async () => {
    const res = await request(buildApp()).get("/health");
    const { data } = res.body as { data: HealthReport };
    expect(data.status).toBe("ok");
    expect(data.service).toBe("creditra-backend");
    expect(data.checkedAt).toBeDefined();
    expect(data.dependencies).toHaveProperty("database");
    expect(data.dependencies).toHaveProperty("horizon");
    expect(data.dependencies).toHaveProperty("redis");
    expect(data.dependencies).toHaveProperty("riskEngine");
  });

  it("returns application/json content-type", async () => {
    const res = await request(buildApp()).get("/health");
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});

describe("GET /health — status degraded", () => {
  beforeEach(() => {
    mockRunHealthChecks.mockResolvedValue({
      ...baseReport,
      status: "degraded",
      dependencies: {
        ...baseReport.dependencies,
        horizon: {
          status: "degraded",
          error: "Horizon listener is configured but not currently running",
        },
      },
    });
  });

  afterEach(() => vi.clearAllMocks());

  it("returns HTTP 200 (degraded is still operational)", async () => {
    const res = await request(buildApp()).get("/health");
    expect(res.status).toBe(200);
  });

  it("body status is degraded", async () => {
    const res = await request(buildApp()).get("/health");
    expect((res.body as { data: HealthReport }).data.status).toBe("degraded");
  });

  it("the degraded dependency is visible in the response", async () => {
    const res = await request(buildApp()).get("/health");
    const deps = (res.body as { data: HealthReport }).data.dependencies;
    expect(deps.horizon.status).toBe("degraded");
    expect(deps.horizon.error).toBeDefined();
  });
});

describe("GET /health — status down", () => {
  beforeEach(() => {
    mockRunHealthChecks.mockResolvedValue({
      ...baseReport,
      status: "down",
      dependencies: {
        ...baseReport.dependencies,
        database: { status: "down", error: "DATABASE_URL is not configured" },
      },
    });
  });

  afterEach(() => vi.clearAllMocks());

  it("returns HTTP 503", async () => {
    const res = await request(buildApp()).get("/health");
    expect(res.status).toBe(503);
  });

  it("body status is down", async () => {
    const res = await request(buildApp()).get("/health");
    expect((res.body as { data: HealthReport }).data.status).toBe("down");
  });

  it("error field is null even on 503", async () => {
    const res = await request(buildApp()).get("/health");
    expect(res.body.error).toBeNull();
  });

  it("the failing dependency is visible in the response", async () => {
    const res = await request(buildApp()).get("/health");
    const deps = (res.body as { data: HealthReport }).data.dependencies;
    expect(deps.database.status).toBe("down");
    expect(deps.database.error).toBe("DATABASE_URL is not configured");
  });
});
