import pino from "pino";

const isTest = process.env.NODE_ENV === "test";

export const logger = pino({
  level: isTest ? "silent" : "info",
  base: undefined, // removes pid/hostname noise
  timestamp: pino.stdTimeFunctions.isoTime,
});
