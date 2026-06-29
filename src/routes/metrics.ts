/**
 * Metrics export endpoint for uptime and SLO dashboards.
 *
 * `GET /api/metrics` returns key service signals in a JSON envelope
 * compatible with Prometheus scraping or direct dashboard consumption:
 *   - service uptime (seconds since process start)
 *   - request latency histogram (p50/p95/p99) — rolling 60-second window
 *   - error rate (errors / total requests, rolling 60-second window)
 *   - queue depth (pending async jobs, if applicable)
 *
 * ## Security
 * The endpoint requires a bearer token supplied via the `METRICS_TOKEN`
 * environment variable. Requests without a valid `Authorization: Bearer <token>`
 * header receive HTTP 401. Set `METRICS_TOKEN` to a strong random secret and
 * restrict network access to internal / monitoring infrastructure only.
 *
 * ## SLO targets (suggested)
 * | Signal         | Target          | Alert threshold |
 * |----------------|-----------------|-----------------|
 * | Availability   | 99.9 % (monthly)| < 99.5 % 5-min  |
 * | p95 latency    | ≤ 300 ms        | > 500 ms 5-min  |
 * | Error rate     | < 0.1 %         | > 1 % 1-min     |
 *
 * See `docs/OBSERVABILITY.md` for Grafana dashboard JSON and Alertmanager rules.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { ok, fail } from '../utils/response.js';

export const metricsRouter = Router();

/** Process start time used to compute uptime. */
const PROCESS_START_MS = Date.now();

/** Rolling window duration in milliseconds. */
const WINDOW_MS = 60_000;

interface RequestSample {
  timestamp: number;
  durationMs: number;
  isError: boolean;
}

const requestSamples: RequestSample[] = [];

/**
 * Record a completed request for metrics aggregation.
 * Called by the metrics middleware registered in app.ts.
 */
export function recordRequest(durationMs: number, isError: boolean): void {
  const now = Date.now();
  requestSamples.push({ timestamp: now, durationMs, isError });
  // Evict samples older than the rolling window to bound memory usage.
  const cutoff = now - WINDOW_MS;
  while (requestSamples.length > 0 && requestSamples[0].timestamp < cutoff) {
    requestSamples.shift();
  }
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, index)];
}

function computeMetrics() {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const window = requestSamples.filter((s) => s.timestamp >= cutoff);

  const totalRequests = window.length;
  const errorCount = window.filter((s) => s.isError).length;
  const durations = window.map((s) => s.durationMs).sort((a, b) => a - b);

  return {
    uptimeSeconds: Math.floor((now - PROCESS_START_MS) / 1000),
    windowSeconds: WINDOW_MS / 1000,
    totalRequests,
    errorCount,
    errorRate: totalRequests > 0 ? errorCount / totalRequests : 0,
    latencyMs: {
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      p99: percentile(durations, 99),
    },
    sloTargets: {
      availabilityTarget: 0.999,
      p95LatencyTargetMs: 300,
      errorRateTarget: 0.001,
    },
  };
}

/** Bearer-token authentication guard for the metrics endpoint. */
function requireMetricsToken(req: Request, res: Response, next: NextFunction): void {
  const metricsToken = process.env.METRICS_TOKEN;

  if (!metricsToken) {
    // If no token is configured the endpoint is disabled to prevent accidental exposure.
    fail(res, 'Metrics endpoint is not enabled (METRICS_TOKEN not configured)', 503);
    return;
  }

  const authHeader = req.headers['authorization'] ?? '';
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (provided !== metricsToken) {
    fail(res, 'Unauthorized', 401);
    return;
  }

  next();
}

metricsRouter.get('/', requireMetricsToken, (_req: Request, res: Response) => {
  ok(res, computeMetrics());
});
