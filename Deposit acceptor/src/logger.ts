import pino from 'pino';
import { Env } from './env';

export function createLogger(env: Env) {
  return pino({
    level: env.LOG_LEVEL,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type Logger = ReturnType<typeof createLogger>;
