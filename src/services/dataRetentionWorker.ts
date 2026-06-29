/**
 * Data Retention Worker
 *
 * Registers the data-retention job handler with the job queue and provides
 * utilities for starting a scheduled retention sweep. Mirrors the structure
 * of ReconciliationWorker. See docs/DATA_RETENTION.md for the policy.
 */
import type { JobQueue, Job } from './jobQueue.js';
import type { DataRetentionService, DataRetentionConfig } from './dataRetentionService.js';
import { createServiceLogger } from '../utils/serviceLogger.js';

const log = createServiceLogger('DataRetentionWorker');

export interface DataRetentionWorkerConfig {
  /** How often to run the retention sweep (in milliseconds). Default: 24 hours. */
  intervalMs?: number;
  /** Whether to run a sweep immediately on worker start. */
  runImmediately?: boolean;
  /** Retention windows to enforce on each run. */
  retentionConfig: DataRetentionConfig;
}

export class DataRetentionWorker {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private retentionConfig: DataRetentionConfig | null = null;

  constructor(
    private dataRetentionService: DataRetentionService,
    private jobQueue: JobQueue,
  ) {
    this.jobQueue.registerHandler('data-retention-sweep', async (job: Job) => {
      const config = job.payload as DataRetentionConfig;
      log.info('data-retention:job:start', {
        jobId: job.id,
        attempt: job.attempts + 1,
      });

      try {
        const result = await this.dataRetentionService.run(config);

        if (result.errors.length > 0) {
          log.error('data-retention:job:errors', {
            jobId: job.id,
            errors: result.errors,
          });
          throw new Error(`Data retention errors: ${result.errors.join(', ')}`);
        }

        log.info('data-retention:job:complete', {
          jobId: job.id,
          eventsDeleted: result.eventsDeleted,
          riskEvaluationsDeleted: result.riskEvaluationsDeleted,
          borrowersAnonymized: result.borrowersAnonymized,
        });
      } catch (error) {
        log.error('data-retention:job:failed', {
          jobId: job.id,
          error,
        });
        throw error;
      }
    });
  }

  /** Schedule a retention sweep job to run asynchronously. */
  scheduleSweep(config: DataRetentionConfig, delayMs = 0): string {
    return this.jobQueue.enqueue('data-retention-sweep', config, { delayMs, maxAttempts: 3 });
  }

  /** Start the worker with scheduled periodic sweeps. */
  start(config: DataRetentionWorkerConfig): void {
    if (this.running) {
      log.warn('data-retention-worker:already-running');
      return;
    }

    const intervalMs = config.intervalMs ?? 86400000; // Default: 24 hours
    const runImmediately = config.runImmediately ?? true;
    this.retentionConfig = config.retentionConfig;

    this.running = true;
    this.jobQueue.start();

    if (runImmediately) {
      log.info('data-retention:schedule:immediate');
      this.scheduleSweep(this.retentionConfig, 0);
    }

    this.intervalHandle = setInterval(() => {
      log.info('data-retention:schedule:periodic');
      this.scheduleSweep(this.retentionConfig as DataRetentionConfig, 0);
    }, intervalMs);

    log.info('data-retention-worker:started', {
      intervalMs,
      intervalHours: Math.round(intervalMs / 3600000),
      operationalRetentionDays: config.retentionConfig.operationalRetentionDays,
      eventsRetentionDays: config.retentionConfig.eventsRetentionDays,
    });
  }

  /** Stop the worker. */
  stop(): void {
    if (!this.running) {
      log.warn('data-retention-worker:not-running');
      return;
    }

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }

    this.running = false;
    log.info('data-retention-worker:stopped');
  }

  isRunning(): boolean {
    return this.running;
  }
}
