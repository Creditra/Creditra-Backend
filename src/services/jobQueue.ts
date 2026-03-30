/**
 * Minimal async job queue abstraction.
 *
 * Designed for at-least-once delivery semantics:
 * - Jobs are retried up to `maxAttempts` times with exponential backoff.
 * - Jobs that exceed `maxAttempts` are moved to a dead-letter set and logged
 *   so operators can inspect and replay them.
 * - A `visibilityTimeoutMs` prevents a job from being re-attempted before its
 *   backoff window expires (analogous to SQS visibility timeout).
 *
 * The current implementation is purely in-memory and single-process. The
 * public interface is kept narrow so a Redis or SQS backend can be swapped in
 * without changing call sites.
 */

export interface Job<Data = unknown> {
  /** Stable job identifier (unique within a queue instance). */
  readonly id: string;
  /** Logical job type, used for handler routing. */
  readonly type: string;
  /** Arbitrary JSON-serialisable payload. */
  readonly payload: Data;
  /** Number of times this job has been attempted. */
  attempts: number;
  /** Maximum number of attempts before the job is moved to dead-letter. */
  readonly maxAttempts: number;
  /** Milliseconds since epoch when the job was first enqueued. */
  readonly createdAt: number;
  /** Milliseconds since epoch when the job was last updated. */
  updatedAt: number;
  /** Last error message, if any attempt failed. */
  lastError?: string;
}

export type JobHandler<Data = unknown> = (
  job: Job<Data>,
) => void | Promise<void>;

export interface EnqueueOptions {
  /**
   * Maximum attempts before the job is moved to the dead-letter set.
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
   * Returns the job id that can be used for diagnostics.
   */
  enqueue<Data = unknown>(
    type: string,
    payload: Data,
    options?: EnqueueOptions,
  ): string;

  /**
   * Register a handler for the given job type.
   * Registering a second handler for the same type replaces the first.
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

  /**
   * Read-only snapshot of dead-letter (permanently failed) jobs.
   * Operators can inspect this set to replay or alert on failures.
   */
  getFailedJobs(): readonly Job[];

  /**
   * Process all currently-due jobs immediately, without waiting for the tick
   * interval. Primarily intended for tests and graceful-shutdown hooks.
   */
  drain(): Promise<void>;
}

interface InternalJob<Data = unknown> extends Job<Data> {
  /** Earliest time (ms since epoch) at which the next attempt may run. */
  nextRunAt: number;
}

let nextId = 1;
function generateId(): string {
  return `job-${nextId++}`;
}

/**
 * In-memory, single-process job queue with at-least-once delivery.
 *
 * Scheduling model:
 * - Uses a self-rescheduling `setTimeout` chain rather than `setInterval` so
 *   the timer stops automatically when the queue is idle. This avoids the
 *   "infinite timer" problem with `vi.runAllTimersAsync()` in tests.
 * - After each failed attempt the job's `nextRunAt` is pushed forward by
 *   `retryBackoffMs` (visibility timeout), preventing immediate re-delivery.
 */
export class InMemoryJobQueue implements JobQueue {
  private readonly handlers = new Map<string, JobHandler<any>>();
  private readonly pending: InternalJob<any>[] = [];
  private readonly failed: InternalJob<any>[] = [];

  private running = false;
  private processing = false;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

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
    const now = Date.now();
    const job: InternalJob<Data> = {
      id,
      type,
      payload,
      attempts: 0,
      maxAttempts: options?.maxAttempts ?? 3,
      createdAt: now,
      updatedAt: now,
      nextRunAt: now + (options?.delayMs ?? 0),
    };
    this.pending.push(job);
    // Arm the timer if the queue is running but currently idle.
    this._scheduleIfNeeded();
    return id;
  }

  registerHandler<Data = unknown>(
    type: string,
    handler: JobHandler<Data>,
  ): void {
    this.handlers.set(type, handler as JobHandler<unknown>);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this._scheduleIfNeeded();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
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
    // Process all currently-due jobs without waiting for the tick timer.
    // Loops until no ready jobs remain (handles jobs that become ready after
    // a retry backoff has already elapsed).
    while (await this._processTick()) {
      // keep draining
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Arm a one-shot timeout if the queue is running, not already armed, and
   * there are pending jobs. The timeout fires `_processTick` then re-arms
   * itself — stopping naturally when `pending` is empty or `stop()` is called.
   */
  private _scheduleIfNeeded(): void {
    if (!this.running || this.timeoutHandle !== null || this.pending.length === 0) {
      return;
    }
    this.timeoutHandle = setTimeout(() => {
      this.timeoutHandle = null;
      void this._processTick().then(() => this._scheduleIfNeeded());
    }, this.tickIntervalMs);
  }

  /**
   * Attempt to process all jobs whose `nextRunAt` is in the past.
   * Returns `true` if at least one job was ready (used by `drain()`).
   */
  private async _processTick(): Promise<boolean> {
    if (this.processing) return false;

    const now = Date.now();
    const ready: InternalJob<unknown>[] = [];
    const waiting: InternalJob<unknown>[] = [];

    for (const job of this.pending) {
      (job.nextRunAt <= now ? ready : waiting).push(job);
    }

    if (ready.length === 0) return false;

    this.processing = true;
    this.pending.length = 0;
    this.pending.push(...waiting);

    try {
      for (const job of ready) {
        const handler = this.handlers.get(job.type);

        if (!handler) {
          // No handler registered — dead-letter immediately and alert operator.
          console.error(
            `[JobQueue] No handler for type "${job.type}". Job ${job.id} moved to dead-letter.`,
          );
          this.failed.push(job);
          continue;
        }

        try {
          await handler(job);
          // Success — job is done, do not re-enqueue.
        } catch (err) {
          job.attempts += 1;
          job.updatedAt = Date.now();
          job.lastError = err instanceof Error ? err.message : String(err);

          if (job.attempts < job.maxAttempts) {
            // Visibility timeout: hold the job back for `retryBackoffMs` before
            // the next attempt (at-least-once, not at-most-once).
            job.nextRunAt = job.updatedAt + this.retryBackoffMs;
            this.pending.push(job);
          } else {
            // Exceeded maxAttempts — move to dead-letter set.
            this.failed.push(job);
            console.error(
              `[JobQueue] Job ${job.id} (type "${job.type}") exhausted ${job.attempts} attempts. ` +
              `Last error: ${job.lastError}`,
            );
          }
        }
      }
    } finally {
      this.processing = false;
    }

    return true;
  }
}

/**
 * Shared singleton queue instance for simple use cases.
 * Code that needs more control (e.g. tests, workers) should instantiate its
 * own `InMemoryJobQueue`.
 */
export const defaultJobQueue: JobQueue = new InMemoryJobQueue();
