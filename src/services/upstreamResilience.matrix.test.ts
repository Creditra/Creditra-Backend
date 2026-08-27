import { describe, expect, it, vi } from "vitest";
import {
  CircuitBreaker,
  CircuitOpenError,
  UpstreamResiliencePolicy,
  isTransient,
  nonNegative,
  positive,
} from "./upstreamResilience.js";

describe("upstream failure classification", () => {
  const transientMessages = [
    "request timeout",
    "timed out waiting for provider",
    "temporary gateway failure",
    "network connection reset",
    "ECONNRESET from RPC",
    "ETIMEDOUT",
    "provider returned 429",
    "upstream returned 502",
    "upstream returned 503",
    "upstream returned 504",
    "rate limit exceeded",
  ];

  for (const message of transientMessages) {
    it(`classifies ${message} as transient`, () => {
      expect(isTransient(new Error(message))).toBe(true);
    });
  }

  const terminalMessages = [
    "invalid transaction XDR",
    "contract authorization failed",
    "malformed wallet address",
    "unsupported operation",
  ];

  for (const message of terminalMessages) {
    it(`does not retry ${message}`, () => {
      expect(isTransient(new Error(message))).toBe(false);
    });
  }

  it("treats an abort as transient even when the error has no provider text", () => {
    expect(isTransient(new Error("aborted"), true)).toBe(true);
  });

  it("does not classify non-errors as transient", () => {
    expect(isTransient("network failure")).toBe(false);
    expect(isTransient(undefined)).toBe(false);
    expect(isTransient(null)).toBe(false);
  });
});

describe("upstream policy boundaries", () => {
  it("normalizes invalid positive configuration to safe defaults", () => {
    expect(positive(0, 7)).toBe(7);
    expect(positive(-1, 7)).toBe(7);
    expect(positive(Number.NaN, 7)).toBe(7);
    expect(positive(Number.POSITIVE_INFINITY, 7)).toBe(7);
    expect(positive(8.9, 7)).toBe(8);
  });

  it("normalizes negative retry budgets to zero", () => {
    expect(nonNegative(-10)).toBe(0);
    expect(nonNegative(Number.NaN)).toBe(0);
    expect(nonNegative(2.9)).toBe(2);
  });

  it("caps exponential delays", async () => {
    const waits: number[] = [];
    const policy = new UpstreamResiliencePolicy(new CircuitBreaker(), {
      maxRetries: 4,
      baseDelayMs: 100,
      maxDelayMs: 250,
      sleep: async (ms) => { waits.push(ms); },
    });
    let attempt = 0;
    await policy.execute(async () => {
      attempt += 1;
      if (attempt < 5) throw new Error("temporary failure");
      return true;
    }, { upstream: "provider", safeToRetry: true });
    expect(waits).toEqual([100, 200, 250, 250]);
  });

  it("does not retry a non-transient safe-read failure", async () => {
    const operation = vi.fn(async () => { throw new Error("bad request"); });
    const policy = new UpstreamResiliencePolicy(new CircuitBreaker(), {
      maxRetries: 4,
      sleep: async () => undefined,
    });
    await expect(policy.execute(operation, { upstream: "risk", safeToRetry: true }))
      .rejects.toThrow("bad request");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("does not retry a failed write even if it looks like a timeout", async () => {
    const operation = vi.fn(async () => { throw new Error("request timed out"); });
    const policy = new UpstreamResiliencePolicy(new CircuitBreaker(), {
      maxRetries: 4,
      sleep: async () => undefined,
    });
    await expect(policy.execute(operation, { upstream: "soroban", safeToRetry: false }))
      .rejects.toThrow("retry is disabled");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("returns elapsed time and attempt count for observability", async () => {
    let now = 100;
    const policy = new UpstreamResiliencePolicy(new CircuitBreaker(), { now: () => now });
    const result = await policy.execute(async () => {
      now = 175;
      return { ok: true };
    }, { upstream: "provider", safeToRetry: true });
    expect(result).toEqual({ value: { ok: true }, attempts: 1, elapsedMs: 75 });
  });

  it("opens after retry exhaustion rather than counting every attempt", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2 });
    const policy = new UpstreamResiliencePolicy(breaker, {
      maxRetries: 3,
      sleep: async () => undefined,
    });
    const operation = async () => { throw new Error("temporary outage"); };
    await expect(policy.execute(operation, { upstream: "provider", safeToRetry: true })).rejects.toThrow();
    expect(breaker.failureCount).toBe(1);
    await expect(policy.execute(operation, { upstream: "provider", safeToRetry: true })).rejects.toThrow();
    expect(breaker.state).toBe("open");
  });

  it("allows a half-open probe and reopens when the probe fails", async () => {
    let now = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 10, now: () => now });
    breaker.recordFailure();
    now = 10;
    expect(breaker.state).toBe("half_open");
    const policy = new UpstreamResiliencePolicy(breaker, { maxRetries: 0 });
    await expect(policy.execute(async () => { throw new Error("temporary outage"); }, {
      upstream: "provider", safeToRetry: true,
    })).rejects.toThrow();
    expect(breaker.state).toBe("open");
  });

  it("does not consume the caller signal after a successful request", async () => {
    const caller = new AbortController();
    const policy = new UpstreamResiliencePolicy(new CircuitBreaker());
    await policy.execute(async (signal) => {
      expect(signal.aborted).toBe(false);
      return "ok";
    }, { upstream: "provider", safeToRetry: true, signal: caller.signal });
    caller.abort();
    expect(caller.signal.aborted).toBe(true);
  });
});

describe("circuit snapshots", () => {
  it("omit an opened-at timestamp while closed", () => {
    const breaker = new CircuitBreaker();
    expect(breaker.snapshot()).toEqual({ state: "closed", failureCount: 0 });
  });

  it("retain the opening timestamp for operators", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, now: () => 1234 });
    breaker.recordFailure();
    expect(breaker.snapshot()).toEqual({ state: "open", failureCount: 1, openedAtMs: 1234 });
  });

  it("reset explicitly clears half-open history", () => {
    let now = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1, now: () => now });
    breaker.recordFailure();
    now = 1;
    expect(breaker.state).toBe("half_open");
    breaker.reset();
    expect(breaker.snapshot()).toEqual({ state: "closed", failureCount: 0 });
  });

  it("keeps requests available while below threshold", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 4 });
    for (let i = 0; i < 3; i += 1) {
      breaker.recordFailure();
      expect(breaker.allowRequest()).toBe(true);
    }
  });

  it("rejects calls immediately after threshold is crossed", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    breaker.recordFailure();
    const policy = new UpstreamResiliencePolicy(breaker);
    await expect(policy.execute(async () => "unreachable", {
      upstream: "credit-provider", safeToRetry: true,
    })).rejects.toBeInstanceOf(CircuitOpenError);
  });
});
