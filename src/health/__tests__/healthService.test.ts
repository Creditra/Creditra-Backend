import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  deriveOverallStatus,
  runHealthChecks,
  type DependencyStatus,
} from "../healthService.js";

// ---------------------------------------------------------------------------
// Mock all four checker modules
// ---------------------------------------------------------------------------
vi.mock("../checks/database.js", () => ({ checkDatabase: vi.fn() }));
vi.mock("../checks/horizon.js", () => ({ checkHorizon: vi.fn() }));
vi.mock("../checks/redis.js", () => ({ checkRedis: vi.fn() }));
vi.mock("../checks/riskEngine.js", () => ({ checkRiskEngine: vi.fn() }));

import { checkDatabase } from "../checks/database.js";
import { checkHorizon } from "../checks/horizon.js";
import { checkRedis } from "../checks/redis.js";
import { checkRiskEngine } from "../checks/riskEngine.js";

const mockCheckDatabase = vi.mocked(checkDatabase);
const mockCheckHorizon = vi.mocked(checkHorizon);
const mockCheckRedis = vi.mocked(checkRedis);
const mockCheckRiskEngine = vi.mocked(checkRiskEngine);

const OK: DependencyStatus = { status: "ok" };
const DEGRADED: DependencyStatus = {
  status: "degraded",
  error: "partially available",
};
const DOWN: DependencyStatus = { status: "down", error: "unreachable" };

// ---------------------------------------------------------------------------
// deriveOverallStatus
// ---------------------------------------------------------------------------
describe("deriveOverallStatus()", () => {
  it("returns ok when all statuses are ok", () => {
    expect(deriveOverallStatus(["ok", "ok", "ok", "ok"])).toBe("ok");
  });

  it("returns degraded when at least one is degraded and none are down", () => {
    expect(deriveOverallStatus(["ok", "degraded", "ok", "ok"])).toBe(
      "degraded",
    );
  });

  it("returns down when at least one is down", () => {
    expect(deriveOverallStatus(["ok", "ok", "down", "ok"])).toBe("down");
  });

  it("returns down when both degraded and down are present (down wins)", () => {
    expect(deriveOverallStatus(["degraded", "down", "ok", "ok"])).toBe("down");
  });

  it("returns ok for an empty array", () => {
    expect(deriveOverallStatus([])).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// runHealthChecks
// ---------------------------------------------------------------------------
describe("runHealthChecks()", () => {
  beforeEach(() => {
    mockCheckDatabase.mockResolvedValue(OK);
    mockCheckHorizon.mockReturnValue(OK);
    mockCheckRedis.mockResolvedValue(OK);
    mockCheckRiskEngine.mockResolvedValue(OK);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok status when all dependencies are healthy", async () => {
    const report = await runHealthChecks();
    expect(report.status).toBe("ok");
    expect(report.service).toBe("creditra-backend");
    expect(report.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.dependencies.database).toEqual(OK);
    expect(report.dependencies.horizon).toEqual(OK);
    expect(report.dependencies.redis).toEqual(OK);
    expect(report.dependencies.riskEngine).toEqual(OK);
  });

  it("returns degraded status when one dependency is degraded", async () => {
    mockCheckHorizon.mockReturnValue(DEGRADED);
    const report = await runHealthChecks();
    expect(report.status).toBe("degraded");
  });

  it("returns down status when one dependency is down", async () => {
    mockCheckDatabase.mockResolvedValue(DOWN);
    const report = await runHealthChecks();
    expect(report.status).toBe("down");
    expect(report.dependencies.database).toEqual(DOWN);
  });

  it("returns down when both degraded and down are present", async () => {
    mockCheckHorizon.mockReturnValue(DEGRADED);
    mockCheckDatabase.mockResolvedValue(DOWN);
    const report = await runHealthChecks();
    expect(report.status).toBe("down");
  });

  it("captures a rejected database check as down without throwing", async () => {
    mockCheckDatabase.mockRejectedValue(new Error("pg connection refused"));
    const report = await runHealthChecks();
    expect(report.status).toBe("down");
    expect(report.dependencies.database.status).toBe("down");
    expect(report.dependencies.database.error).toContain(
      "pg connection refused",
    );
  });

  it("captures a non-Error rejection as down", async () => {
    mockCheckDatabase.mockRejectedValue("string rejection");
    const report = await runHealthChecks();
    expect(report.dependencies.database.status).toBe("down");
    expect(report.dependencies.database.error).toBe(
      "Unknown error during health check",
    );
  });

  it("runs all four checks (all mocks called once)", async () => {
    await runHealthChecks();
    expect(mockCheckDatabase).toHaveBeenCalledOnce();
    expect(mockCheckHorizon).toHaveBeenCalledOnce();
    expect(mockCheckRedis).toHaveBeenCalledOnce();
    expect(mockCheckRiskEngine).toHaveBeenCalledOnce();
  });

  it("includes checkedAt timestamp close to now", async () => {
    const before = Date.now();
    const report = await runHealthChecks();
    const after = Date.now();
    const checkedAtMs = new Date(report.checkedAt).getTime();
    expect(checkedAtMs).toBeGreaterThanOrEqual(before);
    expect(checkedAtMs).toBeLessThanOrEqual(after);
  });
});
