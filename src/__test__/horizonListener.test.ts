import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import {
  start,
  stop,
  isRunning,
  getConfig,
  onEvent,
  clearEventHandlers,
  pollOnce,
  resolveConfig,
  type HorizonEvent,
  type HorizonListenerConfig,
} from "../services/horizonListener.js";

type ConsoleSpy = MockInstance<[message?: any, ...optionalParams: any[]], void>;
let logSpy: ConsoleSpy | null = null;
let warnSpy: ConsoleSpy | null = null;
let errorSpy: ConsoleSpy | null = null;

function silenceConsole() {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
}

function restoreConsole() {
  logSpy?.mockRestore();
  warnSpy?.mockRestore();
  errorSpy?.mockRestore();
  logSpy = null;
  warnSpy = null;
  errorSpy = null;
}

async function withEnv(
  vars: Record<string, string>,
  fn: () => void | Promise<void>,
): Promise<void> {
  const original: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    original[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k] of Object.entries(vars)) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  }
}

beforeEach(() => {
  silenceConsole();
  if (isRunning()) stop();
  clearEventHandlers();
});

afterEach(() => {
  if (isRunning()) stop();
  clearEventHandlers();
  restoreConsole();
  vi.useRealTimers();
});

describe("resolveConfig()", () => {
  it("returns sensible defaults when no env vars are set", () => {
    delete process.env["HORIZON_URL"];
    delete process.env["CONTRACT_IDS"];
    delete process.env["POLL_INTERVAL_MS"];
    delete process.env["HORIZON_START_LEDGER"];

    const config = resolveConfig();

    expect(config.horizonUrl).toBe("https://horizon-testnet.stellar.org");
    expect(config.contractIds).toEqual([]);
    expect(config.pollIntervalMs).toBe(5000);
    expect(config.startLedger).toBe("latest");
  });

  it("reads HORIZON_URL from env", async () => {
    await withEnv({ HORIZON_URL: "https://custom-horizon.example.com" }, () => {
      expect(resolveConfig().horizonUrl).toBe("https://custom-horizon.example.com");
    });
  });

  it("parses multiple CONTRACT_IDS separated by commas", async () => {
    await withEnv({ CONTRACT_IDS: "A,B,C" }, () => {
      expect(resolveConfig().contractIds).toEqual(["A", "B", "C"]);
    });
  });
});

describe("isRunning() / getConfig()", () => {
  it("returns false and null config before start", () => {
    expect(isRunning()).toBe(false);
    expect(getConfig()).toBeNull();
  });

  it("returns true and a config object after start", async () => {
    vi.useFakeTimers();
    await start();
    expect(isRunning()).toBe(true);
    expect(getConfig()).not.toBeNull();
  });
});

describe("start()/stop()", () => {
  it("starts and stops cleanly", async () => {
    vi.useFakeTimers();
    await start();
    expect(isRunning()).toBe(true);
    stop();
    expect(isRunning()).toBe(false);
  });
});

describe("onEvent() / clearEventHandlers()", () => {
  it("invokes multiple handlers and isolates failures", async () => {
    vi.useFakeTimers();
    await withEnv({ CONTRACT_IDS: "MY_CONTRACT" }, async () => {
      const received: HorizonEvent[] = [];
      onEvent(() => {
        throw new Error("boom");
      });
      onEvent((e) => {
        received.push(e);
      });
      await start();
      expect(received).toHaveLength(1);
      expect(errorSpy!.mock.calls.flat().join(" ")).toContain("handler threw an error");
    });
  });

  it("clearEventHandlers() removes all registered handlers", async () => {
    vi.useFakeTimers();
    await withEnv({ CONTRACT_IDS: "MY_CONTRACT" }, async () => {
      const received: HorizonEvent[] = [];
      onEvent((e) => {
        received.push(e);
      });
      clearEventHandlers();
      await start();
      expect(received).toHaveLength(0);
    });
  });
});

describe("pollOnce()", () => {
  const baseConfig: HorizonListenerConfig = {
    horizonUrl: "https://horizon-testnet.stellar.org",
    contractIds: [],
    pollIntervalMs: 5000,
    startLedger: "latest",
  };

  it("completes without throwing when contractIds is empty", async () => {
    await expect(pollOnce(baseConfig)).resolves.toBeUndefined();
  });

  it("emits a simulated event when contractIds is non-empty", async () => {
    const events: HorizonEvent[] = [];
    onEvent((e) => {
      events.push(e);
    });
    await pollOnce({ ...baseConfig, contractIds: ["TEST_CONTRACT"] });
    expect(events).toHaveLength(1);
  });
});

