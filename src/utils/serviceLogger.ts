import { logger } from './logger.js';
import { redactLogValue } from './logRedact.js';

export type ServiceLogContext = Record<string, unknown>;

export interface ServiceLogger {
  info(message: string, context?: ServiceLogContext): void;
  warn(message: string, context?: ServiceLogContext): void;
  error(message: string, context?: ServiceLogContext): void;
}

function redactContext(context: ServiceLogContext | undefined): ServiceLogContext | undefined {
  return context === undefined
    ? undefined
    : redactLogValue(context, false);
}

export function createServiceLogger(service: string): ServiceLogger {
  const child = logger.child({ service });

  return {
    info(message, context) {
      const redacted = redactContext(context);
      if (redacted === undefined) {
        child.info(message);
        return;
      }

      child.info(redacted, message);
    },

    warn(message, context) {
      const redacted = redactContext(context);
      if (redacted === undefined) {
        child.warn(message);
        return;
      }

      child.warn(redacted, message);
    },

    error(message, context) {
      const redacted = redactContext(context);
      if (redacted === undefined) {
        child.error(message);
        return;
      }

      child.error(redacted, message);
    },
  };
}
