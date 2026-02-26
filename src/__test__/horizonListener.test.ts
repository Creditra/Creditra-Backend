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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Capture console output without cluttering test output. */
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

/** Save and restore env vars. */
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
      if (original[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = original[k];
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  silenceConsole();
  // Ensure clean state before every test.
  if (isRunning()) stop();
  clearEventHandlers();
});

afterEach(() => {
  if (isRunning()) stop();
  clearEventHandlers();
  restoreConsole();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// resolveConfig()
// ---------------------------------------------------------------------------

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
      expect(resolveConfig().horizonUrl).toBe(
        "https://custom-horizon.example.com",
      );
    });
  });

  it("parses a single CONTRACT_ID", async () => {
    await withEnv({ CONTRACT_IDS: "CONTRACT_A" }, () => {
      expect(resolveConfig().contractIds).toEqual(["CONTRACT_A"]);
    });
  });

  it("parses multiple CONTRACT_IDS separated by commas", async () => {
    await withEnv({ CONTRACT_IDS: "CONTRACT_A,CONTRACT_B,CONTRACT_C" }, () => {
      expect(resolveConfig().contractIds).toEqual([
        "CONTRACT_A",
        "CONTRACT_B",
        "CONTRACT_C",
      ]);
    });
  });

  it("trims whitespace from CONTRACT_IDS entries", async () => {
    await withEnv({ CONTRACT_IDS: " CONTRACT_A , CONTRACT_B " }, () => {
      expect(resolveConfig().contractIds).toEqual([
        "CONTRACT_A",
        "CONTRACT_B",
      ]);
    });
  });

  it("returns empty contractIds for an empty CONTRACT_IDS string", async () => {
    await withEnv({ CONTRACT_IDS: "" }, () => {
      expect(resolveConfig().contractIds).toEqual([]);
    });
  });

  it("parses POLL_INTERVAL_MS from env", async () => {
    await withEnv({ POLL_INTERVAL_MS: "2000" }, () => {
      expect(resolveConfig().pollIntervalMs).toBe(2000);
    });
  });

  it("reads HORIZON_START_LEDGER from env", async () => {
    await withEnv({ HORIZON_START_LEDGER: "500" }, () => {
      expect(resolveConfig().startLedger).toBe("500");
    });
  });
});

// ---------------------------------------------------------------------------
// isRunning() / getConfig()
// ---------------------------------------------------------------------------

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
    expect(getConfig()?.horizonUrl).toBeDefined();
  });

  it("returns false and null config after stop", async () => {
    vi.useFakeTimers();
    await start();
    stop();
    expect(isRunning()).toBe(false);
    expect(getConfig()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// start()
// ---------------------------------------------------------------------------

describe("start()", () => {
  it("sets running to true", async () => {
    vi.useFakeTimers();
    await start();
    expect(isRunning()).toBe(true);
  });

  it("executes an immediate first poll on start", async () => {
    vi.useFakeTimers();
    await withEnv({ CONTRACT_IDS: "MY_CONTRACT" }, async () => {
      const received: HorizonEvent[] = [];
      onEvent((e) => { received.push(e); });
      await start();
      
      expect(received.length).toBe(1);
    });
  });

  it("fires handlers on subsequent interval ticks", async () => {
    vi.useFakeTimers();
    await withEnv({ CONTRACT_IDS: "MY_CONTRACT", POLL_INTERVAL_MS: "100" }, async () => {
      const received: HorizonEvent[] = [];
      onEvent((e) => { received.push(e); });
      await start();

      expect(received.length).toBe(1);

      vi.advanceTimersByTime(100);

      await Promise.resolve();
      expect(received.length).toBe(2);

      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
      expect(received.length).toBe(4);
    });
  });

  it("is a no-op (warns) if called when already running", async () => {
    vi.useFakeTimers();
    await start();
    warnSpy!.mockClear();
    await start(); // second call
    expect(warnSpy!).toHaveBeenCalledWith(
      expect.stringContaining("Already running"),
    );
    expect(isRunning()).toBe(true);
  });

  it("logs startup config information", async () => {
    vi.useFakeTimers();
    await start();
    const calls = logSpy!.mock.calls.flat().join(" ");
    expect(calls).toContain("Starting with config");
  });
});

// ---------------------------------------------------------------------------
// stop()
// ---------------------------------------------------------------------------

describe("stop()", () => {
  it("sets running to false", async () => {
    vi.useFakeTimers();
    await start();
    stop();
    expect(isRunning()).toBe(false);
  });

  it("clears the polling interval so no more events fire", async () => {
    vi.useFakeTimers();
    await withEnv({ CONTRACT_IDS: "MY_CONTRACT", POLL_INTERVAL_MS: "100" }, async () => {
      const received: HorizonEvent[] = [];
      onEvent((e) => { received.push(e); });
      await start();
      stop();
      const countAfterStop = received.length;
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      // No new events after stop
      expect(received.length).toBe(countAfterStop);
    });
  });

  it("is a no-op (warns) if called when not running", () => {
    stop();
    expect(warnSpy!).toHaveBeenCalledWith(
      expect.stringContaining("Not running"),
    );
  });

  it("logs a stopped message", async () => {
    vi.useFakeTimers();
    await start();
    logSpy!.mockClear();
    stop();
    expect(logSpy!.mock.calls.flat().join(" ")).toContain(
      "Stopped",
    );
  });

  it("allows the listener to be restarted after stop", async () => {
    vi.useFakeTimers();
    await start();
    stop();
    expect(isRunning()).toBe(false);
    await start();
    expect(isRunning()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// onEvent() / clearEventHandlers()
// ---------------------------------------------------------------------------

describe("onEvent() / clearEventHandlers()", () => {
  it("registers a handler that receives simulated events", async () => {
    vi.useFakeTimers();
    await withEnv({ CONTRACT_IDS: "MY_CONTRACT" }, async () => {
      const events: HorizonEvent[] = [];
      onEvent((e) => {
        events.push(e);
      });
      await start();
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]!.contractId).toBe("MY_CONTRACT");
    });
  });

  it("supports multiple handlers and invokes all of them", async () => {
    vi.useFakeTimers();
    await withEnv({ CONTRACT_IDS: "MULTI_CONTRACT" }, async () => {
      const calls1: HorizonEvent[] = [];
      const calls2: HorizonEvent[] = [];
      onEvent((e) => {
        calls1.push(e);
      });
      onEvent((e) => {
        calls2.push(e);
      });
      await start();
      expect(calls1.length).toBe(1);
      expect(calls2.length).toBe(1);
    });
  });

  it("clearEventHandlers() removes all registered handlers", async () => {
    vi.useFakeTimers();
    await withEnv({ CONTRACT_IDS: "MY_CONTRACT" }, async () => {
      const events: HorizonEvent[] = [];
      onEvent((e) => {
        events.push(e);
      });
      clearEventHandlers();
      await start();

      expect(events.length).toBe(0);
    });
  });

  it("catches and logs errors thrown by a handler without stopping dispatch", async () => {
    vi.useFakeTimers();
    await withEnv({ CONTRACT_IDS: "ERROR_CONTRACT" }, async () => {
      const goodEvents: HorizonEvent[] = [];
      onEvent(() => { throw new Error("handler boom"); });
      onEvent((e) => {
        goodEvents.push(e);
      });
      await start();

      expect(goodEvents.length).toBe(1);
      expect(errorSpy!.mock.calls.flat().join(" ")).toContain(
        "handler threw an error",
      );
    });
  });

  it("handles async handlers that reject gracefully", async () => {
    vi.useFakeTimers();
    await withEnv({ CONTRACT_IDS: "ASYNC_ERROR_CONTRACT" }, async () => {
      const goodEvents: HorizonEvent[] = [];
      onEvent(async () => { throw new Error("async handler boom"); });
      onEvent((e) => {
        goodEvents.push(e);
      });
      await start();
      expect(goodEvents.length).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// pollOnce()
// ---------------------------------------------------------------------------

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

  it("logs a polling message on every call", async () => {
    logSpy!.mockClear();
    await pollOnce(baseConfig);
    expect(logSpy!).toHaveBeenCalledWith(
      expect.stringContaining("Polling"),
    );
  });

  it("emits a simulated event when contractIds is non-empty", async () => {
    const config: HorizonListenerConfig = {
      ...baseConfig,
      contractIds: ["TEST_CONTRACT"],
    };
    const events: HorizonEvent[] = [];
    onEvent((e) => {
      events.push(e);
    });
    await pollOnce(config);
    expect(events).toHaveLength(1);
    expect(events[0]!.contractId).toBe("TEST_CONTRACT");
    expect(events[0]!.topics).toContain("credit_line_created");
    expect(events[0]!.ledger).toBe(1000);
  });

  it("does not emit events when contractIds is empty", async () => {
    const events: HorizonEvent[] = [];
    onEvent((e) => {
      events.push(e);
    });
    await pollOnce(baseConfig);
    expect(events).toHaveLength(0);
  });

  it("logs 'none' for contracts when contractIds is empty", async () => {
    logSpy!.mockClear();
    await pollOnce(baseConfig);
    expect((logSpy!.mock.calls.flat() as string[]).join(" ")).toContain("none");
  });

  it("includes simulated event data with a walletAddress field", async () => {
    const config: HorizonListenerConfig = {
      ...baseConfig,
      contractIds: ["WALLET_CONTRACT"],
    };
    const events: HorizonEvent[] = [];
    onEvent((e) => {
      events.push(e);
    });
    await pollOnce(config);
    const data = JSON.parse(events[0]!.data) as { walletAddress: string };
    expect(data).toHaveProperty("walletAddress");
  });

  it("sets a valid ISO timestamp on the simulated event", async () => {
    const config: HorizonListenerConfig = {
      ...baseConfig,
      contractIds: ["TS_CONTRACT"],
    };
    const events: HorizonEvent[] = [];
    onEvent((e) => {
      events.push(e);
    });
    await pollOnce(config);
    expect(() => new Date(events[0]!.timestamp)).not.toThrow();
    expect(new Date(events[0]!.timestamp).getTime()).not.toBeNaN();
  });
});
