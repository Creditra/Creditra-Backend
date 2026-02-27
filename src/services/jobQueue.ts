/**
 * Minimal async job queue abstraction.
 *
 * This module intentionally keeps the public surface small so it can later be
 * backed by a real queue backend (Redis, SQS, etc.) without changing call
 * sites. The current implementation is purely in-memory and single-process.
 */

export interface Job<Data = unknown> {
  /** Stable job identifier (unique within a queue instance). */
  readonly id: string;
  /** Logical job type, used for handler routing. */
  readonly type: string;
  /** Arbitrary JSON-serialisable payload. */
  readonly payload: Data;
  /** Number of times this job has been attempted. */
  readonly attempts: number;
  /** Maximum number of attempts before the job is considered failed. */
  readonly maxAttempts: number;
  /** Milliseconds since epoch when the job was first enqueued. */
  readonly createdAt: number;
  /** Milliseconds since epoch when the job was last updated. */
  readonly updatedAt: number;
}

export type JobHandler<Data = unknown> = (job: Job<Data>) => void | Promise<void>;

export interface EnqueueOptions {
  /**
   * Maximum attempts before the job is moved to the failed set.
   * Defaults to 3.
   */
  maxAttempts?: number;
  /**
   * Optional delay (in milliseconds) before the first attempt.
   * Defaults to 0 (immediate).
   */
  delayMs?: number;
  /**
   * Optional caller-provided job id. If omitted, an internal id is generated.
   */
  id?: string;
}

export interface JobQueue {
  /**
   * Enqueue a new job for asynchronous processing.
   *
   * Returns the job id that can be used for diagnostics.
   */
  enqueue<Data = unknown>(
    type: string,
    payload: Data,
    options?: EnqueueOptions,
  ): string;

  /**
   * Register a handler for the given job type.
   *
   * Registering multiple handlers for the same type replaces the previous one.
   */
  registerHandler<Data = unknown>(
    type: string,
    handler: JobHandler<Data>,
  ): void;

  /** Start background processing of queued jobs. Idempotent. */
  start(): void;

  /** Stop background processing. Pending jobs remain in the queue. Idempotent. */
  stop(): void;

  /** Whether the queue is currently processing jobs. */
  isRunning(): boolean;

  /** Number of jobs that are scheduled but not yet completed. */
  size(): number;

  /** Read-only snapshot of failed jobs for inspection/metrics. */
  getFailedJobs(): readonly Job[];

  /**
   * Best-effort attempt to process all due jobs immediately.
   *
   * This is primarily intended for tests and shutdown hooks.
   */
  drain(): Promise<void>;
}

interface InternalJob<Data = unknown> extends Job<Data> {
  nextRunAt: number;
}

let nextId = 1;

function generateId(): string {
  return `job-${nextId++}`;
}

/**
 * In-memory, single-process job queue implementation.
 *
 * Concurrency model:
 * - A lightweight timer tick wakes up every `tickIntervalMs` and processes
 *   ready jobs (those with nextRunAt <= now).
 * - Jobs are handled sequentially to keep behaviour deterministic in tests.
 */
export class InMemoryJobQueue implements JobQueue {
  private readonly handlers = new Map<string, JobHandler<any>>();
  private readonly pending: InternalJob<any>[] = [];
  private readonly failed: InternalJob<any>[] = [];

  private running = false;
  private processing = false;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly tickIntervalMs = 50,
    private readonly retryBackoffMs = 500,
  ) {}

  enqueue<Data = unknown>(
    type: string,
    payload: Data,
    options?: EnqueueOptions,
  ): string {
    const id = options?.id ?? generateId();
    const maxAttempts = options?.maxAttempts ?? 3;
    const delayMs = options?.delayMs ?? 0;
    const now = Date.now();

    const job: InternalJob<Data> = {
      id,
      type,
      payload,
      attempts: 0,
      maxAttempts,
      createdAt: now,
      updatedAt: now,
      nextRunAt: now + delayMs,
    };

    this.pending.push(job);
    return id;
  }

  registerHandler<Data = unknown>(
    type: string,
    handler: JobHandler<Data>,
  ): void {
    this.handlers.set(type, handler as JobHandler<any>);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    if (!this.intervalHandle) {
      this.intervalHandle = setInterval(
        () => {
          void this.processTick();
        },
        this.tickIntervalMs,
      );
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  size(): number {
    return this.pending.length;
  }

  getFailedJobs(): readonly Job[] {
    return this.failed.slice();
  }

  async drain(): Promise<void> {
    // Temporarily run a tight loop until no ready jobs remain.
    // This intentionally ignores delayMs/backoff that are still in the future.
    // Callers that rely on timers should combine this with fake timers.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const hadReady = await this.processTick();
      if (!hadReady) break;
    }
  }

  private async processTick(): Promise<boolean> {
    if (!this.running || this.processing) return false;
    const now = Date.now();
    const ready: InternalJob<any>[] = [];
    const waiting: InternalJob<any>[] = [];

    for (const job of this.pending) {
      if (job.nextRunAt <= now) {
        ready.push(job);
      } else {
        waiting.push(job);
      }
    }

    if (ready.length === 0) {
      return false;
    }

    this.processing = true;
    this.pending.length = 0;
    this.pending.push(...waiting);

    try {
      for (const job of ready) {
        const handler = this.handlers.get(job.type);
        if (!handler) {
          // No handler registered – drop the job but log loudly.
          console.error(
            `[JobQueue] No handler registered for job type "${job.type}". Dropping job ${job.id}.`,
          );
          this.failed.push(job);
          // eslint-disable-next-line no-continue
          continue;
        }

        try {
          await handler(job);
        } catch (err) {
          job.attempts += 1;
          job.updatedAt = Date.now();

          if (job.attempts < job.maxAttempts) {
            job.nextRunAt = job.updatedAt + this.retryBackoffMs;
            this.pending.push(job);
          } else {
            this.failed.push(job);
            console.error(
              `[JobQueue] Job ${job.id} of type "${job.type}" failed after ${job.attempts} attempts.`,
              err,
            );
          }
        }
      }
    } finally {
      this.processing = false;
    }

    return ready.length > 0;
  }
}

/**
 * Shared singleton queue instance for simple use cases.
 *
 * Code that needs more control (e.g. tests, workers) can instantiate its own
 * `InMemoryJobQueue` instead of using this default export.
 */
export const defaultJobQueue: JobQueue = new InMemoryJobQueue();

