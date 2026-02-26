// Metrics collector for Prometheus-compatible metrics
// This module provides centralized metrics collection for HTTP requests,
// background jobs, and application errors.

import { Registry } from 'prom-client';

export interface MetricsCollector {
  getRegistry(): Registry;
  recordHttpRequest(params: {
    method: string;
    route: string;
    statusCode: number;
    durationSeconds: number;
  }): void;
  recordJobEnqueued(jobType: string): void;
  recordJobCompleted(jobType: string): void;
  recordJobFailed(jobType: string): void;
  updateQueueGauges(pendingCount: number, failedCount: number): void;
  reset(): void;
}
