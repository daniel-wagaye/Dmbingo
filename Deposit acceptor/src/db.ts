import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Env } from './env';

export type RegexRow = {
  id: number;
  bank_name: string;
  regex_json: unknown;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type AtomicInsertResult = { deposit_id: number; inserted: boolean };

type RetryConfig = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryForeverOnNetwork: boolean;
};

export class Database {
  readonly pool: Pool;
  readonly orm: ReturnType<typeof drizzle>;
  private readonly retry: RetryConfig;
  constructor(pool: Pool, retry: RetryConfig) {
    this.pool = pool;
    this.orm = drizzle(pool);
    this.retry = retry;
  }

  private isNetworkError(err: unknown): boolean {
    const code = String((err as any)?.code ?? '');
    const message = String((err as any)?.message ?? '');
    const networkCodes = new Set([
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'EAI_AGAIN',
      'ECONNREFUSED',
      'ENETUNREACH',
      'EHOSTUNREACH',
      '57P01',
      '57P02',
      '57P03',
      '08000',
      '08001',
      '08003',
      '08004',
      '08006',
      '08P01',
    ]);
    if (networkCodes.has(code)) return true;
    return /(connection|network|timeout|socket|econn|server closed|terminating connection)/i.test(message);
  }

  private isRetryable(err: unknown): boolean {
    if (this.isNetworkError(err)) return true;
    const code = String((err as any)?.code ?? '');
    const retryableCodes = new Set(['40001', '40P01', '53300']);
    return retryableCodes.has(code);
  }

  private async wait(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await operation();
      } catch (err) {
        attempt += 1;
        if (!this.isRetryable(err)) {
          throw err;
        }
        const beyondMax = attempt >= this.retry.maxAttempts;
        const canKeepRetrying = this.retry.retryForeverOnNetwork && this.isNetworkError(err);
        if (beyondMax && !canKeepRetrying) {
          throw err;
        }
        const exp = this.retry.baseDelayMs * Math.pow(2, Math.min(attempt - 1, 6));
        const jitter = Math.floor(Math.random() * this.retry.baseDelayMs);
        const delay = Math.min(this.retry.maxDelayMs, exp + jitter);
        await this.wait(delay);
      }
    }
  }

  async fetchActiveRegex(): Promise<RegexRow[]> {
    const result = await this.executeWithRetry(() =>
      this.orm.execute(
        sql`SELECT id, bank_name, regex_json, is_active, created_at, updated_at FROM regex_config WHERE is_active = true`
      )
    );
    return (result as any).rows as RegexRow[];
  }

  async findDepositByTxn(txnRef: string): Promise<number | null> {
    const result = await this.executeWithRetry(() =>
      this.orm.execute(sql`SELECT deposit_id FROM deposits WHERE txn_reference = ${txnRef} LIMIT 1`)
    );
    const row = (result as any).rows?.[0];
    return row?.deposit_id ? Number(row.deposit_id) : null;
  }

  async atomicInsertDeposit(bank: string, amount: number, txnRef: string): Promise<AtomicInsertResult> {
    const result = await this.executeWithRetry(() =>
      this.orm.execute(sql`
        WITH ins AS (
          INSERT INTO deposits (bank, amount, txn_reference)
          VALUES (${bank}, ${amount}, ${txnRef})
          ON CONFLICT (txn_reference) DO NOTHING
          RETURNING deposit_id
        )
        SELECT
          COALESCE(
            (SELECT deposit_id FROM ins),
            (SELECT deposit_id FROM deposits WHERE txn_reference = ${txnRef})
          ) AS deposit_id,
          EXISTS (SELECT 1 FROM ins) AS inserted
        ;
      `)
    );
    const row = (result as any).rows?.[0];
    if (!row) {
      throw new Error('CTE insert returned no rows');
    }
    return { deposit_id: Number(row.deposit_id), inserted: row.inserted === true };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createDatabase(env: Env) {
  const certPath =
    process.env.DATABASE_CA_CERT_PATH && process.env.DATABASE_CA_CERT_PATH.trim().length > 0
      ? path.resolve(process.cwd(), process.env.DATABASE_CA_CERT_PATH)
      : path.resolve(__dirname, '../certs/prod-ca-2021.crt');
  if (!fs.existsSync(certPath)) {
    throw new Error(`Database CA certificate not found at: ${certPath}`);
  }
  const ca = fs.readFileSync(certPath).toString();
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: { ca, rejectUnauthorized: true },
    max: env.DB_MAX_CONNECTIONS,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    maxLifetimeSeconds: 300,
  });
  return new Database(pool, {
    maxAttempts: env.DB_RETRY_MAX_ATTEMPTS,
    baseDelayMs: env.DB_RETRY_BASE_DELAY_MS,
    maxDelayMs: env.DB_RETRY_MAX_DELAY_MS,
    retryForeverOnNetwork: env.DB_RETRY_FOREVER_ON_NETWORK,
  });
}
