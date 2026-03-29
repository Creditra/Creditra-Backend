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

function createQueue(): JobQueue {
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

  it("processes an enqueued job when a handler is registered", async () => {
    const queue = createQueue();
    const handler = vi.fn((_job: Job<{ value: number }>) => {});

    queue.registerHandler<{ value: number }>("test", handler);
    queue.start();

    queue.enqueue("test", { value: 42 });

    await vi.runAllTimersAsync();

    expect(handler).toHaveBeenCalledTimes(1);
    const jobArg = handler.mock.calls[0]?.[0];
    expect(jobArg).toBeDefined();
    expect(jobArg?.type).toBe("test");
    expect(jobArg?.payload).toEqual({ value: 42 });
    expect(queue.size()).toBe(0);
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
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("retries a failing job up to maxAttempts then moves it to failed jobs", async () => {
    const queue = createQueue();
    const handler = vi
      .fn(async (_job: Job<void>) => {})
      .mockRejectedValueOnce(new Error("first failure"))
      .mockRejectedValueOnce(new Error("second failure"))
      .mockResolvedValueOnce(undefined);

    queue.registerHandler<void>("unstable", handler);
    queue.start();

    queue.enqueue("unstable", undefined, { maxAttempts: 3 });

    await vi.runAllTimersAsync();

    expect(handler).toHaveBeenCalledTimes(3);
    expect(queue.getFailedJobs()).toHaveLength(0);
    expect(queue.size()).toBe(0);
  });

  it("moves job to failed set after exceeding maxAttempts", async () => {
    const queue = createQueue();
    const handler = vi.fn(async (_job: Job<void>) => {
      throw new Error("always fails");
    });

    queue.registerHandler<void>("always-fail", handler);
    queue.start();

    queue.enqueue("always-fail", undefined, { maxAttempts: 2 });

    await vi.runAllTimersAsync();

    expect(handler).toHaveBeenCalledTimes(2);
    const failed = queue.getFailedJobs();
    expect(failed).toHaveLength(1);
    expect(failed[0]?.type).toBe("always-fail");
  });

  it("drops jobs for unknown types and records them as failed", async () => {
    const queue = createQueue();
    queue.start();

    queue.enqueue("no-handler", { foo: "bar" });

    await vi.runAllTimersAsync();

    expect(queue.getFailedJobs()).toHaveLength(1);
    expect(queue.getFailedJobs()[0]?.type).toBe("no-handler");
    expect(queue.size()).toBe(0);
    expect(console.error).toHaveBeenCalled();
  });

  it("is idempotent when start() or stop() are called multiple times", () => {
    const queue = createQueue();

    expect(queue.isRunning()).toBe(false);
    queue.start();
    expect(queue.isRunning()).toBe(true);
    queue.start();
    expect(queue.isRunning()).toBe(true);
    queue.stop();
    expect(queue.isRunning()).toBe(false);
    queue.stop();
    expect(queue.isRunning()).toBe(false);
  });

  it("drain() processes ready jobs even without timers", async () => {
    const queue = createQueue();
    const handler = vi.fn((_job: Job<void>) => {});

    queue.registerHandler<void>("immediate", handler);
    queue.start();

    queue.enqueue("immediate", undefined);

    await queue.drain();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(queue.size()).toBe(0);
  });
});
