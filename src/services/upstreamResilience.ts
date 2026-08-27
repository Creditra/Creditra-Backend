/**
 * Shared upstream reliability primitives.
 *
 * The policy deliberately separates a request deadline from a retry budget.
 * A timeout bounds the whole attempt, while retries are allowed only for
 * operations explicitly marked safe. This prevents a transport timeout from
 * turning a non-idempotent transaction submission into a duplicate write.
 */
export type CircuitState = "closed" | "open" | "half_open";

export type UpstreamPolicyOptions = {
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type CircuitBreakerOptions = {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  now?: () => number;
};

export class UpstreamTimeoutError extends Error {
  readonly code = "UPSTREAM_TIMEOUT";
  constructor(public readonly upstream: string, public readonly timeoutMs: number) {
    super(`${upstream} exceeded its ${timeoutMs}ms deadline`);
    this.name = "UpstreamTimeoutError";
  }
}

export class CircuitOpenError extends Error {
  readonly code = "UPSTREAM_CIRCUIT_OPEN";
  constructor(public readonly upstream: string) {
    super(`${upstream} circuit is open`);
    this.name = "CircuitOpenError";
  }
}

export class UnsafeRetryError extends Error {
  readonly code = "UNSAFE_RETRY_BLOCKED";
  constructor(public readonly upstream: string) {
    super(`${upstream} failed; retry is disabled for this operation`);
    this.name = "UnsafeRetryError";
  }
}

export class CircuitBreaker {
  private stateValue: CircuitState = "closed";
  private failures = 0;
  private openedAt: number | undefined;
  private readonly threshold: number;
  private readonly resetTimeout: number;
  private readonly clock: () => number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.threshold = positive(options.failureThreshold ?? 3, 3);
    this.resetTimeout = positive(options.resetTimeoutMs ?? 30_000, 30_000);
    this.clock = options.now ?? Date.now;
  }

  get state(): CircuitState {
    if (this.stateValue === "open" && this.isResetDue()) this.stateValue = "half_open";
    return this.stateValue;
  }

  get failureCount(): number { return this.failures; }
  get openedAtMs(): number | undefined { return this.openedAt; }
  allowRequest(): boolean { return this.state !== "open"; }

  assertRequestAllowed(upstream: string): void {
    if (!this.allowRequest()) throw new CircuitOpenError(upstream);
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = undefined;
    this.stateValue = "closed";
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.stateValue = "open";
      this.openedAt = this.clock();
    }
  }

  reset(): void {
    this.failures = 0;
    this.openedAt = undefined;
    this.stateValue = "closed";
  }

  snapshot(): { state: CircuitState; failureCount: number; openedAtMs?: number } {
    return {
      state: this.state,
      failureCount: this.failures,
      ...(this.openedAt === undefined ? {} : { openedAtMs: this.openedAt }),
    };
  }

  private isResetDue(): boolean {
    return this.openedAt !== undefined && this.clock() - this.openedAt >= this.resetTimeout;
  }
}

export type ExecuteOptions = {
  upstream: string;
  safeToRetry: boolean;
  signal?: AbortSignal;
};

export type UpstreamOutcome<T> = { value: T; attempts: number; elapsedMs: number };

/** Runs one upstream operation under a deadline, retry budget, and breaker. */
export class UpstreamResiliencePolicy {
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly clock: () => number;
  private readonly sleeper: (ms: number) => Promise<void>;

  constructor(private readonly breaker: CircuitBreaker, options: UpstreamPolicyOptions = {}) {
    this.timeoutMs = positive(options.timeoutMs ?? 5_000, 5_000);
    this.maxRetries = nonNegative(options.maxRetries ?? 2);
    this.baseDelayMs = positive(options.baseDelayMs ?? 100, 100);
    this.maxDelayMs = positive(options.maxDelayMs ?? 2_000, 2_000);
    this.clock = options.now ?? Date.now;
    this.sleeper = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async execute<T>(operation: (signal: AbortSignal) => Promise<T>, options: ExecuteOptions): Promise<UpstreamOutcome<T>> {
    this.breaker.assertRequestAllowed(options.upstream);
    const startedAt = this.clock();
    let attempts = 0;
    let lastError: unknown;
    while (attempts <= this.maxRetries) {
      attempts += 1;
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), this.timeoutMs);
      const unlink = linkAbortSignals(options.signal, controller);
      try {
        const value = await operation(controller.signal);
        this.breaker.recordSuccess();
        return { value, attempts, elapsedMs: this.clock() - startedAt };
      } catch (error) {
        lastError = error;
        const timedOut = controller.signal.aborted;
        const retryable = options.safeToRetry && isTransient(error, timedOut);
        if (!retryable || attempts > this.maxRetries) {
          this.breaker.recordFailure();
          if (timedOut) throw new UpstreamTimeoutError(options.upstream, this.timeoutMs);
          if (!options.safeToRetry && isTransient(error)) throw new UnsafeRetryError(options.upstream);
          throw error;
        }
        await this.sleeper(this.delayFor(attempts));
      } finally {
        clearTimeout(abortTimer);
        unlink?.();
      }
    }
    this.breaker.recordFailure();
    throw lastError;
  }

  private delayFor(attempt: number): number {
    return Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** Math.max(0, attempt - 1));
  }
}

export function isTransient(error: unknown, timedOut = false): boolean {
  if (timedOut) return true;
  if (!(error instanceof Error)) return false;
  return /timeout|timed out|network|econn|etimedout|temporar|rate limit|429|502|503|504/i.test(error.message);
}

export function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function nonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function linkAbortSignals(parent: AbortSignal | undefined, controller: AbortController): (() => void) | undefined {
  if (!parent) return undefined;
  const abort = () => controller.abort(parent.reason);
  if (parent.aborted) abort();
  else parent.addEventListener("abort", abort, { once: true });
  return () => parent.removeEventListener("abort", abort);
}
