import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock db/client so tests never need a real Postgres connection
// ---------------------------------------------------------------------------
vi.mock("../../db/client.js", () => ({
  getConnection: vi.fn(),
}));

import { getConnection } from "../../db/client.js";
import { checkDatabase } from "../checks/database.js";

const mockGetConnection = vi.mocked(getConnection);

function makeMockClient({
  connectError,
  queryError,
  endError,
}: {
  connectError?: Error;
  queryError?: Error;
  endError?: Error;
} = {}) {
  return {
    connect: connectError
      ? vi.fn().mockRejectedValue(connectError)
      : vi.fn().mockResolvedValue(undefined),
    query: queryError
      ? vi.fn().mockRejectedValue(queryError)
      : vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
    end: endError
      ? vi.fn().mockRejectedValue(endError)
      : vi.fn().mockResolvedValue(undefined),
  };
}

describe("checkDatabase()", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it("returns down when DATABASE_URL is not set", async () => {
    delete process.env["DATABASE_URL"];
    const result = await checkDatabase();
    expect(result.status).toBe("down");
    expect(result.error).toContain("DATABASE_URL");
  });

  it("returns ok on a successful ping", async () => {
    process.env["DATABASE_URL"] = "postgres://localhost/creditra_test";
    mockGetConnection.mockReturnValue(makeMockClient());
    const result = await checkDatabase();
    expect(result.status).toBe("ok");
  });

  it("returns down when connect() throws", async () => {
    process.env["DATABASE_URL"] = "postgres://localhost/creditra_test";
    mockGetConnection.mockReturnValue(
      makeMockClient({ connectError: new Error("ECONNREFUSED") }),
    );
    const result = await checkDatabase();
    expect(result.status).toBe("down");
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("returns down when query() throws", async () => {
    process.env["DATABASE_URL"] = "postgres://localhost/creditra_test";
    mockGetConnection.mockReturnValue(
      makeMockClient({ queryError: new Error("query failed") }),
    );
    const result = await checkDatabase();
    expect(result.status).toBe("down");
    expect(result.error).toContain("query failed");
  });

  it("still returns ok when end() throws (cleanup errors ignored)", async () => {
    process.env["DATABASE_URL"] = "postgres://localhost/creditra_test";
    mockGetConnection.mockReturnValue(
      makeMockClient({ endError: new Error("end failed") }),
    );
    const result = await checkDatabase();
    expect(result.status).toBe("ok");
  });

  it("wraps non-Error thrown values gracefully", async () => {
    process.env["DATABASE_URL"] = "postgres://localhost/creditra_test";
    const client = makeMockClient();
    client.query = vi.fn().mockRejectedValue("plain string error");
    mockGetConnection.mockReturnValue(client);
    const result = await checkDatabase();
    expect(result.status).toBe("down");
    expect(result.error).toBe("Unknown database error");
  });

  it("works when client has no connect() method (optional connect)", async () => {
    process.env["DATABASE_URL"] = "postgres://localhost/creditra_test";
    const clientWithoutConnect = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      end: vi.fn().mockResolvedValue(undefined),
    };
    // Type assertion needed because connect is optional
    mockGetConnection.mockReturnValue(
      clientWithoutConnect as ReturnType<typeof getConnection>,
    );
    const result = await checkDatabase();
    expect(result.status).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// checkHorizon
// ---------------------------------------------------------------------------
vi.mock("../../services/horizonListener.js", () => ({
  isRunning: vi.fn(),
  getConfig: vi.fn(),
}));

import { isRunning, getConfig } from "../../services/horizonListener.js";
import { checkHorizon } from "../checks/horizon.js";

const mockIsRunning = vi.mocked(isRunning);
const mockGetConfig = vi.mocked(getConfig);

describe("checkHorizon()", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns ok when listener is running", () => {
    mockIsRunning.mockReturnValue(true);
    const result = checkHorizon();
    expect(result.status).toBe("ok");
  });

  it("returns degraded when not running but config exists", () => {
    mockIsRunning.mockReturnValue(false);
    mockGetConfig.mockReturnValue({
      horizonUrl: "https://horizon-testnet.stellar.org",
      contractIds: [],
      pollIntervalMs: 5000,
      startLedger: "latest",
    });
    const result = checkHorizon();
    expect(result.status).toBe("degraded");
    expect(result.error).toBeDefined();
  });

  it("returns down when not running and no config", () => {
    mockIsRunning.mockReturnValue(false);
    mockGetConfig.mockReturnValue(null);
    const result = checkHorizon();
    expect(result.status).toBe("down");
    expect(result.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// checkRedis
// ---------------------------------------------------------------------------
import { checkRedis } from "../checks/redis.js";

describe("checkRedis()", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns ok with a note when REDIS_URL is not set", async () => {
    delete process.env["REDIS_URL"];
    const result = await checkRedis();
    expect(result.status).toBe("ok");
    expect(result.note).toBeDefined();
  });

  it("returns ok with a note when REDIS_URL is set (stub)", async () => {
    process.env["REDIS_URL"] = "redis://localhost:6379";
    const result = await checkRedis();
    expect(result.status).toBe("ok");
    expect(result.note).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// checkRiskEngine
// ---------------------------------------------------------------------------
import { checkRiskEngine } from "../checks/riskEngine.js";

describe("checkRiskEngine()", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns ok with a note when RISK_ENGINE_URL is not set", async () => {
    delete process.env["RISK_ENGINE_URL"];
    const result = await checkRiskEngine();
    expect(result.status).toBe("ok");
    expect(result.note).toBeDefined();
  });

  it("returns ok with a note when RISK_ENGINE_URL is set (stub)", async () => {
    process.env["RISK_ENGINE_URL"] = "http://risk-engine.local";
    const result = await checkRiskEngine();
    expect(result.status).toBe("ok");
    expect(result.note).toBeDefined();
  });
});
