import { drizzle } from 'drizzle-orm/node-postgres';
import type { QueryResult, QueryResultRow } from 'pg';
import type { PoolClient } from 'pg';
import { Pool } from 'pg';
import { config } from '../config';

if (!config.databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableDbError = (error: unknown): boolean => {
  const normalized = error as {
    code?: string;
    message?: string;
  };
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
  ]);
  if (normalized.code && retryableCodes.has(normalized.code)) {
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

const withDbRetry = async <T>(operation: () => Promise<T>): Promise<T> => {
  let attempt = 0;
  while (attempt < config.dbQueryMaxRetries) {
    try {
      return await operation();
    } catch (error) {
      const isRetryable = isRetryableDbError(error);
      if (!isRetryable || attempt >= config.dbQueryMaxRetries - 1) {
        throw error;
      }
      const delayMs = config.dbRetryBaseDelayMs * (attempt + 1);
      await sleep(delayMs);
      attempt += 1;
    }
  }
  throw new Error('Database retry exhausted');
};

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.dbMaxConnections,
  min: 0,
  idleTimeoutMillis: config.dbIdleTimeoutMs,
  connectionTimeoutMillis: config.dbConnectionTimeoutMs,
  allowExitOnIdle: true,
  ssl: {
    rejectUnauthorized: false,
  },
});

export const queryWithRetry = async <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> => {
  return withDbRetry(() => pool.query<T>(text, params));
};

export const withTransactionRetry = async <T>(
  handler: (client: PoolClient) => Promise<T>
): Promise<T> => {
  let attempt = 0;
  while (attempt < config.dbQueryMaxRetries) {
    const client = await withDbRetry(() => pool.connect());
    try {
      await client.query('BEGIN');
      const result = await handler(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        void rollbackError;
      }
      const shouldRetry = isRetryableDbError(error) && attempt < config.dbQueryMaxRetries - 1;
      if (!shouldRetry) {
        throw error;
      }
      attempt += 1;
      const delayMs = config.dbRetryBaseDelayMs * attempt;
      await sleep(delayMs);
    } finally {
      client.release();
    }
  }
  throw new Error('Database transaction retry exhausted');
};

export const db = drizzle(pool);
