import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from "vitest";
import {
  InMemoryJobQueue,
  type Job,
  type JobQueue,
} from "../services/jobQueue.js";

function createQueue(): InMemoryJobQueue {
  return new InMemoryJobQueue(10, 20);
}

describe("InMemoryJobQueue", () => {
  let consoleErrorSpy: MockInstance;

  beforeEach(() => {
    vi.useFakeTimers();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Enqueue + basic processing
  // ---------------------------------------------------------------------------

  it("processes an enqueued job when a handler is registered", async () => {
    const queue = createQueue();
    const handler = vi.fn((_job: Job<{ value: number }>) => {});

    queue.registerHandler<{ value: number }>("test", handler);
    queue.start();
    queue.enqueue("test", { value: 42 });

    await vi.runAllTimersAsync();
    await queue.drain();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]?.payload).toEqual({ value: 42 });
    expect(queue.size()).toBe(0);
  });

  it("accepts a caller-supplied job id", () => {
    const queue = createQueue();
    const id = queue.enqueue("noop", null, { id: "my-id" });
    expect(id).toBe("my-id");
  });

  it("supports delayed execution via delayMs", async () => {
    const queue = createQueue();
    const handler = vi.fn((_job: Job<void>) => {});

    queue.registerHandler<void>("delayed", handler);
    queue.start();
    queue.enqueue("delayed", undefined, { delayMs: 1000 });

    await vi.advanceTimersByTimeAsync(500);
    expect(handler).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(600);
    await queue.drain();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Retry / at-least-once delivery
  // ---------------------------------------------------------------------------

  it("retries a failing job up to maxAttempts then succeeds", async () => {
    const queue = createQueue();
    const handler = vi
      .fn<(job: Job<void>) => Promise<void>>()
      .mockRejectedValueOnce(new Error("first failure"))
      .mockRejectedValueOnce(new Error("second failure"))
      .mockResolvedValueOnce(undefined);

    queue.registerHandler<void>("unstable", handler);
    queue.start();
    queue.enqueue("unstable", undefined, { maxAttempts: 3 });

    // Advance past the retry backoff windows (20 ms each in test queue)
    await vi.advanceTimersByTimeAsync(200);
    await queue.drain();

    expect(handler).toHaveBeenCalledTimes(3);
    expect(queue.getFailedJobs()).toHaveLength(0);
    expect(queue.size()).toBe(0);
  });

  it("moves job to dead-letter after exhausting maxAttempts", async () => {
    const queue = createQueue();
    const handler = vi.fn(async (_job: Job<void>) => {
      throw new Error("always fails");
    });

    queue.registerHandler<void>("always-fail", handler);
    queue.start();
    queue.enqueue("always-fail", undefined, { maxAttempts: 2 });

    await vi.advanceTimersByTimeAsync(200);
    await queue.drain();

    expect(handler).toHaveBeenCalledTimes(2);
    const failed = queue.getFailedJobs();
    expect(failed).toHaveLength(1);
    expect(failed[0]?.type).toBe("always-fail");
  });

  it("records lastError on the dead-letter job", async () => {
    const queue = createQueue();
    queue.registerHandler("boom", async () => {
      throw new Error("kaboom");
    });
    queue.start();
    queue.enqueue("boom", null, { maxAttempts: 1 });

    await vi.advanceTimersByTimeAsync(100);
    await queue.drain();

    const failed = queue.getFailedJobs();
    expect(failed[0]?.lastError).toBe("kaboom");
  });

  it("surfaces dead-letter jobs to operators via console.error", async () => {
    const queue = createQueue();
    queue.registerHandler("fail-once", async () => {
      throw new Error("oops");
    });
    queue.start();
    queue.enqueue("fail-once", null, { maxAttempts: 1 });

    await vi.advanceTimersByTimeAsync(100);
    await queue.drain();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("exhausted"),
    );
  });

  // ---------------------------------------------------------------------------
  // Dead-letter: unknown handler
  // ---------------------------------------------------------------------------

  it("drops jobs for unknown types and records them as dead-letter", async () => {
    const queue = createQueue();
    queue.start();
    queue.enqueue("no-handler", { foo: "bar" });

    await vi.advanceTimersByTimeAsync(100);
    await queue.drain();

    expect(queue.getFailedJobs()).toHaveLength(1);
    expect(queue.getFailedJobs()[0]?.type).toBe("no-handler");
    expect(queue.size()).toBe(0);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("No handler"),
    );
  });

  // ---------------------------------------------------------------------------
  // Visibility timeout (retry backoff)
  // ---------------------------------------------------------------------------

  it("does not re-attempt a failed job before the visibility timeout elapses", async () => {
    const queue = createQueue(); // retryBackoffMs = 20
    let calls = 0;
    queue.registerHandler("slow-retry", async () => {
      calls++;
      if (calls === 1) throw new Error("first");
    });
    queue.start();
    queue.enqueue("slow-retry", null, { maxAttempts: 2 });

    // First attempt fires immediately
    await vi.advanceTimersByTimeAsync(15);
    await queue.drain();
    expect(calls).toBe(1);

    // Retry is not yet due (backoff = 20 ms, only 15 ms elapsed since failure)
    await queue.drain();
    expect(calls).toBe(1);

    // Now advance past the backoff window
    await vi.advanceTimersByTimeAsync(30);
    await queue.drain();
    expect(calls).toBe(2);
    expect(queue.getFailedJobs()).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  it("is idempotent when start() or stop() are called multiple times", () => {
    const queue = createQueue();

    expect(queue.isRunning()).toBe(false);
    queue.start();
    expect(queue.isRunning()).toBe(true);
    queue.start(); // no-op
    expect(queue.isRunning()).toBe(true);
    queue.stop();
    expect(queue.isRunning()).toBe(false);
    queue.stop(); // no-op
    expect(queue.isRunning()).toBe(false);
  });

  it("stop() leaves pending jobs in the queue for later resumption", () => {
    const queue = createQueue();
    queue.registerHandler("noop", () => {});
    queue.start();
    queue.enqueue("noop", null);
    queue.stop();

    expect(queue.size()).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // drain()
  // ---------------------------------------------------------------------------

  it("drain() processes ready jobs without waiting for the tick timer", async () => {
    const queue = createQueue();
    const handler = vi.fn((_job: Job<void>) => {});

    queue.registerHandler<void>("immediate", handler);
    queue.start();
    queue.enqueue("immediate", undefined);

    await queue.drain();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(queue.size()).toBe(0);
  });

  it("drain() is a no-op when the queue is empty", async () => {
    const queue = createQueue();
    queue.start();
    await expect(queue.drain()).resolves.toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // getFailedJobs() returns a snapshot (not a live reference)
  // ---------------------------------------------------------------------------

  it("getFailedJobs() returns an immutable snapshot", async () => {
    const queue = createQueue();
    queue.start();
    queue.enqueue("unknown-type", null);
    await queue.drain();

    const snapshot = queue.getFailedJobs();
    expect(snapshot).toHaveLength(1);
    // Mutating the snapshot does not affect the internal set
    (snapshot as Job[]).pop();
    expect(queue.getFailedJobs()).toHaveLength(1);
  });
});
