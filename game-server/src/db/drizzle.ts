import fs from 'fs';
import path from 'path';
import postgres, { Sql } from 'postgres';
import { config } from '../config';

const caCert = fs.readFileSync(
  path.join(__dirname, '..', '..', 'certs', 'prod-ca-2021.crt'),
  'utf-8'
);

const sslOpts = { rejectUnauthorized: true, ca: caCert };
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

// Legacy alias — points to gameSql for backward compatibility
export const sql: Sql = gameSql;
