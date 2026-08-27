import { describe, expect, it, vi } from "vitest";
import {
  CircuitBreaker,
  CircuitOpenError,
  UnsafeRetryError,
  UpstreamResiliencePolicy,
  UpstreamTimeoutError,
} from "./upstreamResilience.js";

describe("CircuitBreaker", () => {
  it("opens after the configured consecutive failure threshold", () => {
    let now = 1_000;
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 500, now: () => now });
    breaker.recordFailure();
    expect(breaker.state).toBe("closed");
    breaker.recordFailure();
    expect(breaker.state).toBe("open");
    expect(breaker.allowRequest()).toBe(false);
    expect(() => breaker.assertRequestAllowed("rpc")).toThrow(CircuitOpenError);
    now += 500;
    expect(breaker.state).toBe("half_open");
    expect(breaker.allowRequest()).toBe(true);
    breaker.recordSuccess();
    expect(breaker.snapshot()).toEqual({ state: "closed", failureCount: 0 });
  });

  it("resets failures after a successful probe", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    expect(breaker.state).toBe("closed");
    expect(breaker.failureCount).toBe(1);
  });
});

describe("UpstreamResiliencePolicy", () => {
  it("retries transient safe reads with exponential backoff", async () => {
    const sleep = vi.fn(async () => undefined);
    const policy = new UpstreamResiliencePolicy(new CircuitBreaker(), { maxRetries: 2, baseDelayMs: 10, sleep });
    let attempts = 0;
    const result = await policy.execute(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("temporary provider outage");
      return "ok";
    }, { upstream: "provider", safeToRetry: true });
    expect(result).toMatchObject({ value: "ok", attempts: 3 });
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
  });

  it("does not retry transient transaction submissions", async () => {
    const operation = vi.fn(async () => { throw new Error("network timeout"); });
    const policy = new UpstreamResiliencePolicy(new CircuitBreaker(), { sleep: async () => undefined });
    await expect(policy.execute(operation, { upstream: "soroban", safeToRetry: false }))
      .rejects.toBeInstanceOf(UnsafeRetryError);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("converts an abort deadline into a stable timeout error", async () => {
    vi.useFakeTimers();
    try {
      const policy = new UpstreamResiliencePolicy(new CircuitBreaker(), { timeoutMs: 50, maxRetries: 0 });
      const pending = policy.execute((signal) => new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }), { upstream: "rpc", safeToRetry: true });
      const assertion = expect(pending).rejects.toBeInstanceOf(UpstreamTimeoutError);
      await vi.advanceTimersByTimeAsync(50);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails fast while a circuit is open", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    breaker.recordFailure();
    const operation = vi.fn(async () => "never");
    const policy = new UpstreamResiliencePolicy(breaker);
    await expect(policy.execute(operation, { upstream: "rpc", safeToRetry: true }))
      .rejects.toBeInstanceOf(CircuitOpenError);
    expect(operation).not.toHaveBeenCalled();
  });

  it("preserves terminal provider errors", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });
    const policy = new UpstreamResiliencePolicy(breaker, { maxRetries: 2, sleep: async () => undefined });
    const error = new Error("invalid request");
    await expect(policy.execute(async () => { throw error; }, { upstream: "risk", safeToRetry: true }))
      .rejects.toBe(error);
    expect(breaker.state).toBe("closed");
  });

  it("honors a caller cancellation signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const policy = new UpstreamResiliencePolicy(new CircuitBreaker(), { maxRetries: 0 });
    await expect(policy.execute(async (signal) => {
      expect(signal.aborted).toBe(true);
      throw new Error("cancelled");
    }, { upstream: "rpc", safeToRetry: true, signal: controller.signal })).rejects.toThrow();
  });
});
