import fs from 'fs';
import path from 'path';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { Sql } from 'postgres';
import { config } from '../config';

const caCert = fs.readFileSync(
  path.join(__dirname, '..', '..', 'certs', 'prod-ca-2021.crt'),
  'utf-8'
);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableDbError = (error: unknown): boolean => {
  const normalized = error as { code?: string; message?: string; errno?: string };
  const retryableCodes = new Set([
    '40001',
    '40P01',
    '08000',
    '08001',
    '08003',
    '08004',
    '08006',
    '08007',
    '08P01',
    '57P01',
    '57P02',
    '57P03',
    '53300',
    '55000',
    'CONNECT_TIMEOUT',
  ]);
  if (normalized.code && retryableCodes.has(normalized.code)) {
    return true;
  }
  if (normalized.errno && retryableCodes.has(normalized.errno)) {
    return true;
  }
  const message = normalized.message?.toLowerCase() ?? '';
  return (
    message.includes('timeout') ||
    message.includes('connection terminated unexpectedly') ||
    message.includes('terminating connection') ||
    message.includes('could not connect') ||
    message.includes('econnreset') ||
    message.includes('etimedout')
  );
};

export const queryWithRetry = async <T>(operation: () => Promise<T>): Promise<T> => {
  let attempt = 0;
  while (attempt < config.dbQueryMaxRetries) {
    try {
      return await operation();
    } catch (error) {
      const shouldRetry = isRetryableDbError(error) && attempt < config.dbQueryMaxRetries - 1;
      if (!shouldRetry) {
        throw error;
      }
      attempt += 1;
      const delayMs = config.dbRetryBaseDelayMs * attempt;
      await sleep(delayMs);
    }
  }
  throw new Error('Database retry exhausted');
};

const queryClient: Sql = postgres(config.databaseUrl, {
  max: config.dbMaxConnections,
  ssl: {
    rejectUnauthorized: true,
    ca: caCert,
  },
  idle_timeout: config.dbIdleTimeoutSeconds,
  connect_timeout: config.dbConnectTimeoutSeconds,
  max_lifetime: config.dbMaxLifetimeSeconds,
  backoff(retryCount: number) {
    return Math.min(500 * Math.pow(2, retryCount), 30000);
  },
  onnotice() { /* suppress */ },
} as any);
export const db = drizzle(queryClient);
export const sql: Sql = queryClient;
