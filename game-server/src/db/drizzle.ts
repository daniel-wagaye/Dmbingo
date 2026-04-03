import postgres, { Sql } from 'postgres';
import { config } from '../config';

const sslOpts = { rejectUnauthorized: false };
const baseOpts = {
  ssl: sslOpts,
  idle_timeout: config.dbIdleTimeoutSeconds,
  connect_timeout: config.dbConnectTimeoutSeconds,
  max_lifetime: config.dbMaxLifetimeSeconds,
  backoff(retryCount: number) { return Math.min(500 * Math.pow(2, retryCount), 30000); },
  onnotice() { /* suppress */ },
} as any;

// ── Game pool (10) — picks, claims, phase transitions ──
export const gameSql: Sql = postgres(config.databaseUrl, { ...baseOpts, max: 10 });

// ── User pool (8) — registration, profile, deposits, withdrawals, transfers, history ──
export const userSql: Sql = postgres(config.databaseUrl, { ...baseOpts, max: 8 });

// ── Coupon pool (2) — coupon redemption only ──
export const couponSql: Sql = postgres(config.databaseUrl, { ...baseOpts, max: 2 });

// ── Dedicated caller connection (1) — number calling loop only ──
export const callerSql: Sql = postgres(config.databaseUrl, { ...baseOpts, max: 1 });

// Legacy alias
export const sql: Sql = gameSql;

// ── Retry helper for DB operations ──
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

const isRetryableDbError = (err: unknown): boolean => {
  const e = err as { code?: string; errno?: string; message?: string };
  // PG application-level RAISE errors are NOT retryable
  if (e.code === 'P0001') return false;
  const retryableCodes = new Set([
    '08000', '08001', '08003', '08004', '08006', '08007', '08P01',
    '57P01', '57P02', '57P03', '53300', '55000',
    '40001', '40P01',
    'CONNECT_TIMEOUT',
  ]);
  if (e.code && retryableCodes.has(e.code)) return true;
  if (e.errno && retryableCodes.has(e.errno)) return true;
  const msg = (e.message ?? '').toLowerCase();
  return msg.includes('timeout') || msg.includes('connection terminated') ||
    msg.includes('terminating connection') || msg.includes('could not connect') ||
    msg.includes('econnreset') || msg.includes('etimedout') || msg.includes('econnrefused') ||
    msg.includes('connection refused') || msg.includes('fetch failed');
};

/**
 * Retry a DB operation with configurable backoff.
 * @param flatDelay - if true, delay is constant (baseDelayMs every retry). If false, linear: baseDelayMs * attempt.
 * Non-retryable errors (like PG RAISE P0001) fail immediately.
 */
export async function queryWithRetry<T>(
  operation: () => Promise<T>,
  label = 'db',
  maxRetries = 30,
  baseDelayMs = 300,
  flatDelay = false,
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      if (!isRetryableDbError(err) || attempt >= maxRetries) {
        if (!isRetryableDbError(err)) {
          console.error(`[${label}] Non-retryable error on attempt ${attempt}. Giving up.`);
        } else {
          console.error(`[${label}] All ${maxRetries} retries exhausted. Giving up.`);
        }
        throw err;
      }
      const delayMs = flatDelay ? baseDelayMs : baseDelayMs * attempt;
      console.warn(`[${label}] Attempt ${attempt}/${maxRetries} failed. Retrying in ${delayMs}ms...`);
      await sleep(delayMs);
    }
  }
  throw new Error(`[${label}] unreachable`);
}
