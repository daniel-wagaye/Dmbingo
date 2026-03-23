import fs from 'fs';
import path from 'path';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { Sql } from 'postgres';
import { config } from '../config';

const caCert = fs.readFileSync(
  path.join(__dirname, '..', '..', 'certs', 'prod-ca-2021.crt'),
  'utf-8'
);

const queryClient: Sql = postgres(config.databaseUrl, {
  max: 23,
  ssl: {
    rejectUnauthorized: true,
    ca: caCert,
  },
  idle_timeout: 30,
  connect_timeout: 30,
  max_lifetime: 60 * 10,
  backoff(retryCount: number) {
    return Math.min(500 * Math.pow(2, retryCount), 30000);
  },
  onnotice() { /* suppress */ },
} as any);
export const db = drizzle(queryClient);
export const sql: Sql = queryClient;