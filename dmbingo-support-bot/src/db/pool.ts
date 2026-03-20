import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { config } from '../config/env';

const certPath = path.isAbsolute(config.supabaseCaCertPath)
  ? config.supabaseCaCertPath
  : path.resolve(process.cwd(), config.supabaseCaCertPath);

const supabaseCa = fs.readFileSync(certPath, 'utf8');

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: {
    rejectUnauthorized: true,
    ca: supabaseCa,
  },
  max: config.dbPoolMax,
  idleTimeoutMillis: config.dbPoolIdleTimeoutMs,
  connectionTimeoutMillis: config.dbPoolConnectionTimeoutMs,
  statement_timeout: config.dbStatementTimeoutMs,
  query_timeout: config.dbQueryTimeoutMs,
  idle_in_transaction_session_timeout: config.dbIdleInTransactionTimeoutMs,
});
