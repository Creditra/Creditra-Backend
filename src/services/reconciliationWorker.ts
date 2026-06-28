/**
 * Reconciliation Worker
 * 
 * Registers the credit reconciliation job handler with the job queue
 * and provides utilities for starting scheduled reconciliation.
 */

import type { JobQueue, Job } from './jobQueue.js';
import type { ReconciliationService } from './reconciliationService.js';
import { sanitizeJsonForStellarDiagnostics, sanitizeStellarDiagnostic } from './stellarDiagnostics.js';
import { createServiceLogger } from '../utils/serviceLogger.js';

const log = createServiceLogger('ReconciliationWorker');

export interface ReconciliationWorkerConfig {
  /** How often to run reconciliation (in milliseconds). Default: 1 hour */
  intervalMs?: number;
  /** Whether to start reconciliation immediately on worker start */
  runImmediately?: boolean;
}

export class ReconciliationWorker {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private reconciliationService: ReconciliationService,
    private jobQueue: JobQueue,
  ) {
    // Register the job handler
    this.jobQueue.registerHandler('credit-reconciliation', async (job: Job) => {
      log.info('reconciliation-worker:job:start', {
        jobId: job.id,
        attempt: job.attempts + 1,
      });
      
      try {
        const result = await this.reconciliationService.reconcile();
        
        // Alert on persistent mismatches
        if (result.mismatches.length > 0) {
          const criticalCount = result.mismatches.filter(m => m.severity === 'critical').length;
          const warningCount = result.mismatches.filter(m => m.severity === 'warning').length;
          
          log.error('reconciliation-worker:mismatches-alert', {
            mismatchCount: result.mismatches.length,
            criticalCount,
            warningCount,
          });
          
          // In production, send alerts via email, Slack, PagerDuty, etc.
          // For now, log to console and dead-letter queue via job failure
          if (criticalCount > 0) {
            throw new Error(
              `Critical reconciliation mismatches detected: ${criticalCount} critical issues found`
            );
          }
        }
        
        if (result.errors.length > 0) {
          const sanitizedErrors = result.errors.map(sanitizeStellarDiagnostic);
          log.error('reconciliation-worker:errors', {
            errors: sanitizeJsonForStellarDiagnostics(sanitizedErrors),
          });
          throw new Error(`Reconciliation errors: ${sanitizedErrors.join(', ')}`);
        }
        
        log.info('reconciliation-worker:job:complete', {
          jobId: job.id,
          totalChecked: result.totalChecked,
        });
      } catch (error) {
        log.error('reconciliation-worker:job:failed', {
          jobId: job.id,
          error: sanitizeStellarDiagnostic(error),
        });
        throw error; // Re-throw to trigger job retry logic
      }
    });
  }

  /**
   * Start the reconciliation worker with scheduled runs.
   */
  start(config: ReconciliationWorkerConfig = {}): void {
    if (this.running) {
      log.warn('reconciliation-worker:already-running');
      return;
    }

    const intervalMs = config.intervalMs ?? 3600000; // Default: 1 hour
    const runImmediately = config.runImmediately ?? true;

    this.running = true;
    this.jobQueue.start();

    if (runImmediately) {
      log.info('reconciliation-worker:schedule:immediate');
      this.reconciliationService.scheduleReconciliation(0);
    }

    this.intervalHandle = setInterval(() => {
      log.info('reconciliation-worker:schedule:periodic');
      this.reconciliationService.scheduleReconciliation(0);
    }, intervalMs);

    log.info('reconciliation-worker:started', {
      intervalMs,
      intervalMinutes: Math.round(intervalMs / 60000),
    });
  }

  /**
   * Stop the reconciliation worker.
   */
  stop(): void {
    if (!this.running) {
      log.warn('reconciliation-worker:not-running');
      return;
    }

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }

    this.running = false;
    log.info('reconciliation-worker:stopped');
  }

  isRunning(): boolean {
    return this.running;
  }
}
