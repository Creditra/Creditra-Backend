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
import { errorHandler } from "./middleware/errorHandler.js";
import { Container } from "./container/Container.js";
import { validateEnv } from "./config/env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
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

app.use(cors());
app.use(express.json());

app.use("/health", healthRouter);

// ── Docs ────────────────────────────────────────────────────────────────────
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));
app.get("/docs.json", (_req, res) => {
  res.json(openapiSpec);
});

app.use("/api/credit", creditRouter);
app.use("/api/risk", riskRouter);

// Global error handler — must be registered after routes
app.use(errorHandler);

/**
 * Normalised Startup Logic
 */
const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  validateEnv();

  const server = app.listen(port, () => {
    console.log(`Creditra API listening on http://localhost:${port}`);
    console.log(`Swagger UI available at http://localhost:${port}/docs`);
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
