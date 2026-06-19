import { logger } from "./logger.js";
import { redactLogArgs, redactLogValue } from "./logRedact.js";

type LogLevel = "info" | "warn" | "error";

function write(level: LogLevel, args: unknown[]): void {
  const redactedArgs = redactLogArgs(args);

  if (process.env.NODE_ENV === "test") {
    const consoleMethod =
      level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    consoleMethod(...redactedArgs);
    return;
  }

  const [message, meta] = redactedArgs;
  const text = typeof message === "string" ? message : String(message);
  if (meta === undefined) {
    logger[level](text);
    return;
  }

  logger[level](redactLogValue({ details: meta }), text);
}

export const serviceLogger = {
  info: (...args: unknown[]) => write("info", args),
  warn: (...args: unknown[]) => write("warn", args),
  error: (...args: unknown[]) => write("error", args),
};
