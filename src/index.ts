import express from "express";
import cors from "cors";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import yaml from "yaml";
import swaggerUi from "swagger-ui-express";

import { creditRouter } from "./routes/credit.js";
import { riskRouter } from "./routes/risk.js";
import { healthRouter } from "./routes/health.js";
import { webhookRouter } from "./routes/webhook.js";
import { reconciliationRouter } from "./routes/reconciliation.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import {
  InMemoryRateLimitStore,
  RedisRateLimitStore,
  createIpKeyGenerator,
  createRateLimitMiddleware,
} from "./middleware/rateLimit.js";
import { loadCorsPolicy, isAllowedCorsOrigin } from "./config/cors.js";
import { loadRateLimitConfig, loadRateLimitStoreConfig } from "./config/rateLimit.js";
import { validateEnv } from "./config/env.js";
import { Container } from "./container/Container.js";
import { initializeWebhooks } from "./services/drawWebhookService.js";
import { logger } from "./utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
const hasRedisRateLimitConfig =
  process.env.RATE_LIMIT_REDIS_URL !== undefined ||
  process.env.RATE_LIMIT_REDIS_FAILURE_MODE !== undefined;

if (isMain && hasRedisRateLimitConfig) {
  validateEnv();
}

const openapiSpec = yaml.parse(
  readFileSync(join(__dirname, "openapi.yaml"), "utf8"),
) as Record<string, unknown>;

export const app = express();

// ✅ Keep strict typing
const port = Number(process.env.PORT ?? 3000);

// ✅ Keep from main
const SHUTDOWN_TIMEOUT_MS = parseInt(
  process.env.SHUTDOWN_TIMEOUT_MS ?? "30000",
  10,
);

const corsPolicy = loadCorsPolicy();
const rateLimitConfig = loadRateLimitConfig();
const rateLimitStoreConfig = loadRateLimitStoreConfig();
const createRateLimitStore = (namespace: string): InMemoryRateLimitStore | RedisRateLimitStore => {
  if (rateLimitStoreConfig.redisUrl) {
    return new RedisRateLimitStore({
      url: rateLimitStoreConfig.redisUrl,
      prefix: `creditra:ratelimit:${namespace}`,
      failureMode: rateLimitStoreConfig.redisFailureMode,
      onError: createRedisRateLimitErrorLogger(namespace),
    });
  }

  return new InMemoryRateLimitStore();
};
const closeRateLimitStore = async (
  store: InMemoryRateLimitStore | RedisRateLimitStore,
): Promise<void> => {
  if (store instanceof RedisRateLimitStore) {
    await store.close();
  }
};
function createRedisRateLimitErrorLogger(namespace: string): (error: unknown) => void {
  let lastLoggedAt = 0;

  return (error: unknown): void => {
    const now = Date.now();
    if (now - lastLoggedAt < 60_000) {
      return;
    }
    lastLoggedAt = now;

    logger.warn(
      {
        namespace,
        failureMode: rateLimitStoreConfig.redisFailureMode,
        error: error instanceof Error ? error.message : "unknown Redis error",
      },
      "Redis rate-limit store unavailable",
    );
  };
}
const appRateLimitConfig =
  process.env.NODE_ENV === "test"
    ? {
        default: { ...rateLimitConfig.default, maxRequests: Number.MAX_SAFE_INTEGER },
        evaluate: { ...rateLimitConfig.evaluate, maxRequests: Number.MAX_SAFE_INTEGER },
      }
    : rateLimitConfig;
const defaultRateLimitStore = createRateLimitStore("default");
const evaluateRateLimitStore = createRateLimitStore("evaluate");
const defaultRateLimit = createRateLimitMiddleware({
  ...appRateLimitConfig.default,
  keyGenerator: createIpKeyGenerator(),
}, defaultRateLimitStore);
const evaluateRateLimit = createRateLimitMiddleware({
  ...appRateLimitConfig.evaluate,
  keyGenerator: createIpKeyGenerator(),
}, evaluateRateLimitStore);

app.use(cors({
  origin(origin, callback) {
    callback(null, isAllowedCorsOrigin(origin, corsPolicy));
  },
}));

// Reject bodies on mutating requests that don't declare application/json.
app.use((req, res, next) => {
  const methodHasBody = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH';
  const hasBody =
    methodHasBody &&
    (Number(req.headers['content-length']) > 0 || req.headers['transfer-encoding'] != null);
  if (hasBody) {
    const ct = req.headers['content-type'] ?? '';
    if (!ct.includes('application/json')) {
      res.status(415).json({ data: null, error: 'Content-Type must be application/json' });
      return;
    }
  }
  next();
});

// 100 kb hard cap; body-parser emits a 413 that errorHandler converts to a
// structured response.
app.use(express.json({ limit: '100kb' }));

app.use(requestLogger);

app.use("/health", healthRouter);

// ── Docs ────────────────────────────────────────────────────────────────────
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));
app.get("/docs.json", (_req, res) => {
  res.json(openapiSpec);
});

app.use("/api/credit", defaultRateLimit, creditRouter);
app.use("/api/risk/evaluate", evaluateRateLimit);
app.use("/api/risk/wallet", defaultRateLimit);
app.use("/api/risk", riskRouter);
app.use("/api/webhooks", webhookRouter);
app.use("/api/reconciliation", reconciliationRouter);

// Global error handler — must be registered after routes
app.use(errorHandler);

/**
 * Normalised Startup Logic
 */
if (isMain) {
  // Initialize webhooks before starting the server
  initializeWebhooks();

  const server = app.listen(port, () => {
    console.log(`Creditra API listening on http://localhost:${port}`);
    console.log(`Swagger UI available at http://localhost:${port}/docs`);
    
    // Start reconciliation worker
    const container = Container.getInstance();
    const reconciliationInterval = parseInt(
      process.env.RECONCILIATION_INTERVAL_MS ?? "3600000", // Default: 1 hour
      10
    );
    container.reconciliationWorker.start({
      intervalMs: reconciliationInterval,
      runImmediately: process.env.RECONCILIATION_RUN_IMMEDIATELY !== "false",
    });
    console.log(`[ReconciliationWorker] Started with ${reconciliationInterval}ms interval`);

    // Start data retention worker (no-op if running without Postgres)
    if (process.env.DATA_RETENTION_ENABLED !== "false" && container.dataRetentionWorker) {
      const retentionInterval = parseInt(
        process.env.DATA_RETENTION_INTERVAL_MS ?? "86400000", // Default: 24 hours
        10,
      );
      container.dataRetentionWorker.start({
        intervalMs: retentionInterval,
        runImmediately: process.env.DATA_RETENTION_RUN_IMMEDIATELY === "true",
        retentionConfig: {
          operationalRetentionDays: parseInt(
            process.env.DATA_RETENTION_OPERATIONAL_DAYS ?? "90",
            10,
          ),
          eventsRetentionDays: parseInt(
            process.env.DATA_RETENTION_EVENTS_DAYS ?? "365",
            10,
          ),
        },
      });
      console.log(`[DataRetentionWorker] Started with ${retentionInterval}ms interval`);
    }
  });

  // ── Graceful Shutdown ───────────────────────────────────────────────────────
  const gracefulShutdown = async (signal: string) => {
    console.log(`\n[Server] ${signal} received, starting graceful shutdown...`);

    const forceExitTimeout = setTimeout(() => {
      console.error("[Server] Shutdown timeout reached, forcing exit.");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    try {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) return reject(err);
          console.log("[Server] HTTP server closed.");
          resolve();
        });
      });

      const container = Container.getInstance();
      await container.shutdown();
      await Promise.all([
        closeRateLimitStore(defaultRateLimitStore),
        closeRateLimitStore(evaluateRateLimitStore),
      ]);

      clearTimeout(forceExitTimeout);
      console.log("[Server] Shutdown complete. Process exiting.");
      process.exit(0);
    } catch (err) {
      console.error("[Server] Shutdown error:", err);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

export default app;
